import { db, runInTransaction } from '../database/config/connection';
import { randomUUID } from 'crypto';
import { StockLedgerService } from '../services/StockLedgerService';

export interface PurchaseOrder {
  id: string;
  order_number: string;
  supplier_id: string;
  supplier_name?: string;
  date: string;
  expected_date: string | null;
  status: 'DRAFT' | 'CONFIRMED' | 'RECEIVED' | 'CANCELLED';
  total: number;
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
  INSERT INTO purchase_orders (id, order_number, supplier_id, date, expected_date, status, total, notes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const stmtInsertItem = db.prepare(`
  INSERT INTO purchase_order_items (id, purchase_order_id, product_id, quantity, unit_price, received_qty, total)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const stmtUpdateOrder = db.prepare(`
  UPDATE purchase_orders SET status = ?, total = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
`);

const stmtUpdateItemReceived = db.prepare(`
  UPDATE purchase_order_items SET received_qty = ? WHERE id = ?
`);

const stmtUpdateStatus = db.prepare(`
  UPDATE purchase_orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
`);

const stmtDeleteOrder = db.prepare('DELETE FROM purchase_orders WHERE id = ?');

const stmtGetNextNumber = db.prepare(`
  SELECT COUNT(*) as cnt FROM purchase_orders WHERE strftime('%Y', date) = ?
`);

// ─── Repository ──────────────────────────────────────────────────────────────

export const PurchaseOrderRepository = {
  generateNumber(): string {
    const year = new Date().getFullYear().toString();
    const result = stmtGetNextNumber.get(year) as { cnt: number };
    const seq = String(result.cnt + 1).padStart(5, '0');
    return `PA-${year}-${seq}`;
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
    const date = new Date().toISOString();

    let total = 0;
    for (const item of data.items) {
      const qty = Number(item.quantity);
      if (!Number.isFinite(qty) || qty <= 0) throw new Error('Quantité de commande invalide.');
      if (Number(item.unit_price) < 0) throw new Error('Prix unitaire invalide.');
      total += qty * Number(item.unit_price);
    }

    const insertAll = db.transaction(() => {
      stmtInsertOrder.run(
        id, order_number, data.supplier_id, date,
        data.expected_date ?? null, 'DRAFT', total, data.notes ?? null
      );

      for (const item of data.items) {
        const itemTotal = Number(item.quantity) * Number(item.unit_price);
        stmtInsertItem.run(
          randomUUID(), id, item.product_id,
          Number(item.quantity), Number(item.unit_price), 0, itemTotal
        );
      }
    });

    insertAll();
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

      // Recalculer le total réceptionné
      const updatedItems = stmtGetItems.all(id) as PurchaseOrderItem[];
      let receivedTotal = 0;
      for (const item of updatedItems) {
        receivedTotal += item.received_qty * item.unit_price;
      }

      // Statut : RECEIVED si tout est reçu, sinon CONFIRMED (réception partielle)
      const allReceived = updatedItems.every(i => i.received_qty >= i.quantity);
      const newStatus = allReceived ? 'RECEIVED' : 'CONFIRMED';
      stmtUpdateOrder.run(newStatus, receivedTotal, id);

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
    if (order.status !== 'DRAFT') throw new Error('Seules les commandes en brouillon peuvent être supprimées.');
    const movements = db.prepare('SELECT COUNT(*) AS cnt FROM stock_movements WHERE document_id = ?').get(id) as { cnt: number };
    if (movements.cnt > 0) {
      throw new Error('Impossible de supprimer : la commande possède un historique de réception de stock.');
    }
    stmtDeleteOrder.run(id);
  }
};
