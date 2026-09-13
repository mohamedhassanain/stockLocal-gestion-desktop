import { db, runInTransaction } from '../database/config/connection';
import { randomUUID } from 'crypto';
import { StockLedgerService } from '../services/StockLedgerService';
import { nextSequence } from '../services/DocumentSequenceService';
// §Phase 2 — dates « calendaires » : jamais de conversion UTC sur une date métier.
import { toLocalDateString, toDateOnly } from '../utils/date';
// §TVA — taux applicable à chaque ligne d'achat (résolution produit → catégorie
// → défaut société, règle unique portée par TaxService).
import { TaxService } from '../services/TaxService';
import { addMoney, calculateLineAmounts, roundMoney } from '../utils/money';

export interface PurchaseOrder {
  id: string;
  order_number: string;
  supplier_id: string;
  supplier_name?: string;
  date: string;
  expected_date: string | null;
  status: 'DRAFT' | 'CONFIRMED' | 'RECEIVED' | 'CANCELLED';
  /** Total HORS TAXE (compatibilité : c'était déjà la somme qté × prix). */
  total: number;
  /** §TVA — base hors taxe (identique à `total` ; explicite pour la lecture). */
  total_excl_tax: number;
  /** §TVA — TVA sur achats (TVA DÉDUCTIBLE). */
  total_tax: number;
  /** §TVA — total toutes taxes comprises. */
  total_incl_tax: number;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
  items?: PurchaseOrderItem[];
}

export interface PurchaseOrderItem {
  id: string;
  purchase_order_id: string;
  product_id: string;
  product_ref?: string;
  product_name?: string;
  quantity: number;
  unit_price: number;
  received_qty: number;
  total: number;
  /** §TVA — taux FIGÉ au moment de la commande. */
  vat_rate: number;
}

// ─── Prepared Statements ──────────────────────────────────────────────────────

const stmtGetAll = db.prepare(`
  SELECT po.*, s.name AS supplier_name
  FROM purchase_orders po
  LEFT JOIN suppliers s ON s.id = po.supplier_id
  ORDER BY po.date DESC
  LIMIT 500
`);

const stmtSearch = db.prepare(`
  SELECT po.*, s.name AS supplier_name
  FROM purchase_orders po
  LEFT JOIN suppliers s ON s.id = po.supplier_id
  WHERE po.order_number LIKE ? OR s.name LIKE ?
  ORDER BY po.date DESC
  LIMIT 200
`);

const stmtGetBySupplier = db.prepare(`
  SELECT po.*, s.name AS supplier_name
  FROM purchase_orders po
  LEFT JOIN suppliers s ON s.id = po.supplier_id
  WHERE po.supplier_id = ?
  ORDER BY po.date DESC
  LIMIT 200
`);

const stmtGetById = db.prepare(`
  SELECT po.*, s.name AS supplier_name
  FROM purchase_orders po
  LEFT JOIN suppliers s ON s.id = po.supplier_id
  WHERE po.id = ?
`);

const stmtGetItems = db.prepare(`
  SELECT poi.*, p.reference AS product_ref, p.designation AS product_name
  FROM purchase_order_items poi
  LEFT JOIN products p ON p.id = poi.product_id
  WHERE poi.purchase_order_id = ?
`);

const stmtInsertOrder = db.prepare(`
  INSERT INTO purchase_orders (id, order_number, supplier_id, date, expected_date, status, total, total_excl_tax, total_tax, total_incl_tax, notes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const stmtInsertItem = db.prepare(`
  INSERT INTO purchase_order_items (id, purchase_order_id, product_id, quantity, unit_price, received_qty, total, vat_rate)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

// §TVA — `total` reste le HT (compatibilité) et les trois colonnes suivantes
// portent la décomposition fiscale, recalculée à chaque réception.
const stmtUpdateOrder = db.prepare(`
  UPDATE purchase_orders
  SET status = ?, total = ?, total_excl_tax = ?, total_tax = ?, total_incl_tax = ?,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);

const stmtUpdateItemReceived = db.prepare(`
  UPDATE purchase_order_items SET received_qty = ? WHERE id = ?
`);

const stmtUpdateStatus = db.prepare(`
  UPDATE purchase_orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
`);

const stmtDeleteOrder = db.prepare('DELETE FROM purchase_orders WHERE id = ?');
const stmtUpdateOrderFull = db.prepare(`
  UPDATE purchase_orders
  SET supplier_id = ?, date = ?, expected_date = ?, status = ?,
      total = ?, total_excl_tax = ?, total_tax = ?, total_incl_tax = ?,
      notes = ?, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);
const stmtDeleteItems = db.prepare('DELETE FROM purchase_order_items WHERE purchase_order_id = ?');
const stmtProductStock = db.prepare(`
  SELECT COALESCE(SUM(
    CASE WHEN movement_type IN ('PURCHASE_IN','ADJUSTMENT_IN','RETURN_IN','OPENING_BALANCE','TRANSFER_IN') THEN quantity
         ELSE -quantity END
  ), 0) AS stock
  FROM stock_movements WHERE product_id = ?
`);

// ─── §TVA — Calcul des lignes d'achat ────────────────────────────────────────

/** Ligne d'achat calculée (HT de la ligne + taux FIGÉ). */
interface ComputedPurchaseLine {
  product_id: string;
  quantity: number;
  unit_price: number;
  /** Total hors taxe de la ligne. */
  total: number;
  /** Taux de TVA figé au moment de la commande. */
  vat_rate: number;
}

/**
 * Calcule les lignes d'une commande d'achat et la décomposition de l'entête.
 *
 * Le taux est résolu par la règle UNIQUE (`TaxService.resolveRate` :
 * produit → catégorie → défaut société) puis FIGÉ : modifier la TVA d'un
 * produit demain ne réécrit pas une commande passée. La TVA est calculée avec
 * le MÊME moteur monétaire que la vente (`money.calculateLineAmounts`), donc
 * les arrondis sont cohérents entre achats et ventes.
 */
function computePurchaseLines(items: Array<{ product_id: string; quantity: number; unit_price: number }>): {
  lines: ComputedPurchaseLine[];
  totalExclTax: number;
  totalTax: number;
  totalInclTax: number;
} {
  const lines: ComputedPurchaseLine[] = [];
  let exclTaxSum = 0;
  let taxSum = 0;

  for (const item of items) {
    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Quantité de commande invalide.');
    const unitPrice = Number(item.unit_price);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error('Prix unitaire invalide.');

    const vatRate = TaxService.resolveRate(item.product_id);
    const amounts = calculateLineAmounts({ quantity, unitPrice, discountPct: 0, vatRate });

    exclTaxSum += amounts.exclTax;
    taxSum += amounts.tax;
    lines.push({
      product_id: item.product_id,
      quantity,
      unit_price: unitPrice,
      total: amounts.exclTax,
      vat_rate: vatRate,
    });
  }

  const totalExclTax = roundMoney(exclTaxSum);
  const totalTax = roundMoney(taxSum);
  return { lines, totalExclTax, totalTax, totalInclTax: addMoney(totalExclTax, totalTax) };
}

// ─── Repository ──────────────────────────────────────────────────────────────

export const PurchaseOrderRepository = {
  /**
   * §20 — numérotation transactionnelle (table document_sequences).
   * Format conservé : PA-AAAA-#####. Aucun chevauchement après rollback
   * ou suppression (l'ancien COUNT(*) + 1 est abandonné).
   */
  generateNumber(): string {
    const year = new Date().getFullYear();
    const seq = nextSequence('PURCHASE_ORDER', year);
    return `PA-${year}-${String(seq).padStart(5, '0')}`;
  },

  getAll(): PurchaseOrder[] {
    return stmtGetAll.all() as PurchaseOrder[];
  },

  /** Réceptions (commandes au statut CONFIRMED/RECEIVED avec quantités reçues). */
  getReceivings(): PurchaseOrder[] {
    const orders = db.prepare(`
      SELECT po.*, s.name AS supplier_name
      FROM purchase_orders po
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.status IN ('CONFIRMED', 'RECEIVED')
      ORDER BY po.date DESC
      LIMIT 300
    `).all() as PurchaseOrder[];
    for (const order of orders) {
      order.items = stmtGetItems.all(order.id) as PurchaseOrderItem[];
    }
    return orders;
  },

  /** Commandes d'achat d'un fournisseur précis (SQL ciblé, jamais tout chargé). */
  getBySupplier(supplierId: string): PurchaseOrder[] {
    return stmtGetBySupplier.all(supplierId) as PurchaseOrder[];
  },

  search(query: string): PurchaseOrder[] {
    const q = `%${query}%`;
    return stmtSearch.all(q, q) as PurchaseOrder[];
  },

  getById(id: string): PurchaseOrder | undefined {
    const order = stmtGetById.get(id) as PurchaseOrder | undefined;
    if (order) {
      order.items = stmtGetItems.all(id) as PurchaseOrderItem[];
    }
    return order;
  },

  /**
   * Crée une commande d'achat avec ses lignes dans une transaction atomique.
   */
  create(data: {
    supplier_id: string;
    expected_date?: string;
    notes?: string;
    items: Array<{ product_id: string; quantity: number; unit_price: number }>;
  }): PurchaseOrder {
    const id = randomUUID();
    const order_number = this.generateNumber();
    const date = toLocalDateString();

    const { lines, totalExclTax, totalTax, totalInclTax } = computePurchaseLines(data.items);

    const insertAll = db.transaction(() => {
      stmtInsertOrder.run(
        id, order_number, data.supplier_id, date,
        data.expected_date ?? null, 'DRAFT',
        totalExclTax, totalExclTax, totalTax, totalInclTax,
        data.notes ?? null
      );

      for (const line of lines) {
        stmtInsertItem.run(
          randomUUID(), id, line.product_id,
          line.quantity, line.unit_price, 0, line.total, line.vat_rate
        );
      }
    });

    insertAll();
    return this.getById(id)!;
  },

  /**
   * Met à jour une commande (DRAFT uniquement) : fournisseur, échéance, notes et lignes,
   * dans une transaction atomique. Le numéro de commande est conservé.
   */
  update(id: string, data: {
    supplier_id: string;
    date?: string;
    expected_date?: string | null;
    notes?: string | null;
    items: Array<{ product_id: string; quantity: number; unit_price: number }>;
  }): PurchaseOrder {
    const order = this.getById(id);
    if (!order) throw new Error('Commande introuvable.');
    if (order.status !== 'DRAFT') throw new Error('Seules les commandes en brouillon peuvent être modifiées.');

    const { lines, totalExclTax, totalTax, totalInclTax } = computePurchaseLines(data.items);

    // §Phase 2.2 — on stocke la date métier telle quelle (YYYY-MM-DD) : aucune
    // conversion UTC qui pourrait décaler d'un jour selon le fuseau.
    const date = data.date ? (toDateOnly(data.date) ?? order.date) : order.date;

    const updateAll = db.transaction(() => {
      stmtUpdateOrderFull.run(
        data.supplier_id, date, data.expected_date ?? null, 'DRAFT',
        totalExclTax, totalExclTax, totalTax, totalInclTax,
        data.notes ?? null, id
      );
      stmtDeleteItems.run(id);
      for (const line of lines) {
        stmtInsertItem.run(
          randomUUID(), id, line.product_id,
          line.quantity, line.unit_price, 0, line.total, line.vat_rate
        );
      }
    });
    updateAll();
    return this.getById(id)!;
  },

  /**
   * Passe une commande de DRAFT → CONFIRMED.
   */
  confirm(id: string): PurchaseOrder {
    const order = this.getById(id);
    if (!order) throw new Error('Commande introuvable.');
    if (order.status !== 'DRAFT') throw new Error('Seules les commandes en brouillon peuvent être confirmées.');
    stmtUpdateStatus.run('CONFIRMED', id);
    return this.getById(id)!;
  },

  /**
   * Réceptionne (partiellement ou totalement) une commande confirmée.
   *
   * Workflow :
   *   Commande = 100
   *   Réception 1 = 60 → PURCHASE_IN 60 → statut CONFIRMED (partielle)
   *   Réception 2 = 40 → PURCHASE_IN 40 → statut RECEIVED (complète)
   *
   * Chaque réception crée un mouvement de stock PURCHASE_IN via le StockLedgerService.
   * La quantité reçue est cumulative (réceptions multiples autorisées).
   */
  receive(id: string, receivedItems?: Array<{ item_id: string; received_qty: number }>): PurchaseOrder {
    return runInTransaction(() => {
      const order = this.getById(id);
      if (!order) throw new Error('Commande introuvable.');
      if (order.status !== 'CONFIRMED') throw new Error('Seules les commandes confirmées peuvent être réceptionnées.');

      const items = order.items ?? [];
      if (items.length === 0) throw new Error('Cette commande ne contient aucune ligne.');

      // Si receivedItems est fourni, valider qu'il couvre toutes les lignes
      if (receivedItems && receivedItems.length > 0) {
        for (const ri of receivedItems) {
          if (!Number.isFinite(ri.received_qty) || ri.received_qty < 0) {
            throw new Error('Quantité reçue invalide.');
          }
        }
      }

      for (const item of items) {
        const received = receivedItems?.find(ri => ri.item_id === item.id);
        const qtyToReceive = received ? Number(received.received_qty) : item.quantity;

        if (qtyToReceive > 0) {
          // La quantité reçue est cumulative
          const newReceivedQty = item.received_qty + qtyToReceive;
          if (newReceivedQty > item.quantity) {
            throw new Error(
              `Réception refusée : la quantité reçue (${newReceivedQty}) dépasse la quantité commandée (${item.quantity}) ` +
              `pour "${item.product_ref} ${item.product_name}".`
            );
          }

          stmtUpdateItemReceived.run(newReceivedQty, item.id);

          // Créer l'entrée de stock pour CETTE réception (PURCHASE_IN)
          StockLedgerService.recordMovement({
            product_id: item.product_id,
            movement_type: 'PURCHASE_IN',
            quantity: qtyToReceive,
            unit_price: item.unit_price,
            reference_doc: order.order_number,
            document_id: order.id,
            supplier_id: order.supplier_id,
            notes: `Réception commande ${order.order_number} (partiel ${newReceivedQty}/${item.quantity})`,
          });
        }
      }

      // Recalculer les totaux (HT / TVA / TTC) réellement RÉCEPTIONNÉS, avec le
      // taux figé de chaque ligne : la TVA déductible ne doit porter que sur ce
      // qui a effectivement été reçu, jamais sur le reste en attente.
      const updatedItems = stmtGetItems.all(id) as PurchaseOrderItem[];
      let receivedExclTax = 0;
      let receivedTax = 0;
      for (const item of updatedItems) {
        const lineTotal = item.received_qty * item.unit_price;
        receivedExclTax += lineTotal;
        receivedTax += lineTotal * (Number(item.vat_rate ?? 0) / 100);
      }
      const receivedExclTaxRounded = roundMoney(receivedExclTax);
      const receivedTaxRounded = roundMoney(receivedTax);
      const receivedInclTaxRounded = addMoney(receivedExclTaxRounded, receivedTaxRounded);

      // Statut : RECEIVED si tout est reçu, sinon CONFIRMED (réception partielle)
      const allReceived = updatedItems.every(i => i.received_qty >= i.quantity);
      const newStatus = allReceived ? 'RECEIVED' : 'CONFIRMED';
      stmtUpdateOrder.run(
        newStatus,
        receivedExclTaxRounded, receivedExclTaxRounded,
        receivedTaxRounded, receivedInclTaxRounded,
        id
      );

      return this.getById(id)!;
    });
  },

  /**
   * Annule une commande.
   */
  cancel(id: string): PurchaseOrder {
    const order = this.getById(id);
    if (!order) throw new Error('Commande introuvable.');
    if (order.status === 'CANCELLED') throw new Error('Cette commande est déjà annulée.');
    if (order.status === 'RECEIVED') throw new Error('Une commande déjà réceptionnée ne peut pas être annulée.');
    stmtUpdateStatus.run('CANCELLED', id);
    return this.getById(id)!;
  },

  remove(id: string): void {
    const order = this.getById(id);
    if (!order) throw new Error('Commande introuvable.');

    // Réceptions liées à cette commande (PURCHASE_IN) — à inverser avant suppression.
    const movements = db.prepare(`
      SELECT product_id, quantity FROM stock_movements
      WHERE document_id = ? AND movement_type = 'PURCHASE_IN'
    `).all(id) as Array<{ product_id: string; quantity: number }>;

    const removeAll = db.transaction(() => {
      // Inverser chaque réception (ADJUSTMENT_OUT) pour remettre le stock
      // dans son état d'avant réception, sans casser le journal.
      for (const m of movements) {
        const qty = Number(m.quantity);
        if (qty <= 0) continue;
        const stock = (stmtProductStock.get(m.product_id) as { stock: number })?.stock ?? 0;
        if (stock < qty) {
          throw new Error(
            `Impossible de supprimer : le stock de ce produit (${stock}) est inférieur à la quantité reçue (${qty}) — il a été vendu ou consommé.`
          );
        }
        StockLedgerService.recordMovement({
          product_id: m.product_id,
          movement_type: 'ADJUSTMENT_OUT',
          quantity: qty,
          unit_price: 0,
          reference_doc: order.order_number,
          document_id: order.id,
          supplier_id: order.supplier_id,
          notes: `Annulation commande ${order.order_number} (inversion réception)`,
        });
      }
      stmtDeleteItems.run(id);
      stmtDeleteOrder.run(id);
    });
    removeAll();
  }
};
