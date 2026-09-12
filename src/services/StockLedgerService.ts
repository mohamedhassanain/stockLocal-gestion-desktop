import { db, runInTransaction } from '../database/config/connection';
import { ProductBatchRepository, type FefoAllocation } from '../repositories/ProductBatchRepository';
import { randomUUID } from 'crypto';

/**
 * ─── StockLedgerService (multi-dépôts) ─────────────────────────────────────────
 * Moteur central et unique de toutes les opérations de stock.
 *
 * Chaque mouvement appartient à UN dépôt (`warehouse_id`) :
 *   - les écritures SANS dépôt explicite vont au DÉPÔT ACTIF (paramètre local
 *     `active_warehouse_id`), avec repli sur le dépôt par défaut. Ainsi, un
 *     utilisateur mono-dépôt — ou tout code existant qui n'indique pas de dépôt —
 *     se comporte EXACTEMENT comme avant.
 *   - les lectures SANS dépôt sont CONSOLIDÉES (somme de tous les dépôts), ce qui
 *     donne aussi exactement l'ancien résultat pour un utilisateur mono-dépôt.
 *
 * `inventory_balances` est maintenu par (product_id, warehouse_id) dans la même
 * transaction que le mouvement (impossible d'avoir un mouvement sans solde).
 *
 * Types de mouvements : PURCHASE_IN, SALE_OUT, RETURN_IN/OUT, ADJUSTMENT_IN/OUT,
 * TRANSFER_IN/OUT, DAMAGE_OUT, LOSS_OUT, OPENING_BALANCE (ou type personnalisé).
 * ───────────────────────────────────────────────────────────────────────────────
 */

export type MovementType =
  | 'PURCHASE_IN'
  | 'SALE_OUT'
  | 'RETURN_IN'
  | 'RETURN_OUT'
  | 'ADJUSTMENT_IN'
  | 'ADJUSTMENT_OUT'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'DAMAGE_OUT'
  | 'LOSS_OUT'
  | 'OPENING_BALANCE'
  // Types personnalisés définis par l'utilisateur (ex : DON, CADEAU…).
  | (string & {});

export type MovementDirection = 'IN' | 'OUT';

export interface StockMovementRow {
  id: string;
  product_id: string;
  // Toujours présent en base (NOT NULL) ; optionnel au niveau type pour rester
  // compatible avec les signatures Omit<StockMovementRow, …> des appelants.
  warehouse_id?: string;
  type: MovementDirection;
  movement_type: MovementType;
  quantity: number;
  unit_price: number;
  date?: string;
  reference_doc?: string;
  document_id?: string;
  supplier_id?: string;
  notes?: string;
  /**
   * §Phase 13 — Lots réellement prélevés (FEFO) pour cette sortie.
   * Information de traçabilité : NON persistée dans `stock_movements`, elle est
   * renvoyée par `recordMovement` pour l'affichage et l'audit.
   */
  batch_allocations?: FefoAllocation[];
}

interface MovementInput {
  product_id: string;
  movement_type: MovementType;
  quantity: number; // toujours positive
  /** Dépôt concerné. Absent → dépôt ACTIF (repli : dépôt par défaut). */
  warehouse_id?: string;
  /** Direction physique. Dérivée automatiquement du movement_type si absente. */
  direction?: MovementDirection;
  unit_price?: number;
  date?: string;
  reference_doc?: string;
  document_id?: string;
  supplier_id?: string;
  notes?: string;
}

const MOVEMENT_DIRECTION: Record<MovementType, MovementDirection> = {
  PURCHASE_IN: 'IN',
  SALE_OUT: 'OUT',
  RETURN_IN: 'IN',
  RETURN_OUT: 'OUT',
  ADJUSTMENT_IN: 'IN',
  ADJUSTMENT_OUT: 'OUT',
  TRANSFER_IN: 'IN',
  TRANSFER_OUT: 'OUT',
  DAMAGE_OUT: 'OUT',
  LOSS_OUT: 'OUT',
  OPENING_BALANCE: 'IN',
};

// ─── Requêtes préparées ───────────────────────────────────────────────────────

const stmtInsert = db.prepare(`
  INSERT INTO stock_movements
    (id, product_id, warehouse_id, type, movement_type, quantity, unit_price, date, reference_doc, document_id, supplier_id, notes)
  VALUES
    (@id, @product_id, @warehouse_id, @type, @movement_type, @quantity, @unit_price, @date, @reference_doc, @document_id, @supplier_id, @notes)
`);

// Solde par (produit, dépôt) — upsert atomique.
const stmtUpsertBalance = db.prepare(`
  INSERT INTO inventory_balances (product_id, warehouse_id, quantity, total_in_qty, total_in_value, average_cost, updated_at)
  VALUES (@product_id, @warehouse_id, @quantity, @total_in_qty, @total_in_value, @average_cost, CURRENT_TIMESTAMP)
  ON CONFLICT(product_id, warehouse_id) DO UPDATE SET
    quantity = excluded.quantity,
    total_in_qty = excluded.total_in_qty,
    total_in_value = excluded.total_in_value,
    average_cost = excluded.average_cost,
    updated_at = CURRENT_TIMESTAMP
`);

const stmtGetBalanceAt = db.prepare(`
  SELECT quantity, total_in_qty, total_in_value, average_cost
  FROM inventory_balances WHERE product_id = ? AND warehouse_id = ?
`);

const stmtGetBalanceConsolidated = db.prepare(`
  SELECT
    COALESCE(SUM(quantity), 0) AS quantity,
    COALESCE(SUM(total_in_qty), 0) AS total_in_qty,
    COALESCE(SUM(total_in_value), 0) AS total_in_value
  FROM inventory_balances WHERE product_id = ?
`);

const stmtGetProduct = db.prepare('SELECT reference, designation, purchase_price FROM products WHERE id = ?');

const stmtGetDefaultWarehouse = db.prepare('SELECT id FROM warehouses WHERE is_default = 1 LIMIT 1');
const stmtGetAnyWarehouse = db.prepare('SELECT id FROM warehouses ORDER BY created_at ASC LIMIT 1');
const stmtGetWarehouseById = db.prepare('SELECT id FROM warehouses WHERE id = ?');
const stmtInsertWarehouse = db.prepare('INSERT INTO warehouses (id, name, address, is_default) VALUES (?, ?, NULL, 1)');
const stmtGetSetting = db.prepare('SELECT value FROM global_settings WHERE key = ?');
const stmtInsertTransfer = db.prepare(`
  INSERT INTO stock_transfers (id, product_id, from_warehouse_id, to_warehouse_id, quantity, date, notes)
  VALUES (@id, @product_id, @from_warehouse_id, @to_warehouse_id, @quantity, @date, @notes)
`);

/** Une incohérence détectée entre le stock stocké et le stock attendu. */
export interface StockDiscrepancy {
  product_id: string;
  warehouse_id: string;
  product_ref?: string;
  product_name?: string;
  warehouse_name?: string;
  stored_qty: number;
  expected_qty: number;
  stored_in_qty: number;
  expected_in_qty: number;
  stored_in_value: number;
  expected_in_value: number;
  /** stored_qty − expected_qty. */
  difference: number;
}

/** Résultat d'un audit de stock (lecture seule). */
export interface StockAuditResult {
  /** Nombre de couples (produit, dépôt) examinés. */
  checked: number;
  /** Nombre d'écarts détectés. */
  discrepancyCount: number;
  discrepancies: StockDiscrepancy[];
}

/** Détail d'une ligne réparée. */
export interface StockRepairDetail {
  product_id: string;
  warehouse_id: string;
  before_qty: number;
  after_qty: number;
}

/** Résultat d'une réparation de stock. */
export interface StockRepairResult {
  repaired: number;
  details: StockRepairDetail[];
}

export interface WarehouseTransferRow {
  id: string;
  product_id: string;
  from_warehouse_id: string;
  to_warehouse_id: string;
  quantity: number;
  date?: string;
  notes?: string;
}

export const StockLedgerService = {
  /** Dépôt par défaut (le crée si aucun dépôt n'existe). Ne lève jamais. */
  getDefaultWarehouseId(): string {
    const def = stmtGetDefaultWarehouse.get() as { id: string } | undefined;
    if (def?.id) return def.id;
    const any = stmtGetAnyWarehouse.get() as { id: string } | undefined;
    if (any?.id) {
      db.prepare('UPDATE warehouses SET is_default = 1 WHERE id = ?').run(any.id);
      return any.id;
    }
    const id = randomUUID();
    stmtInsertWarehouse.run(id, 'Dépôt principal');
    return id;
  },

  /**
   * Dépôt ACTIF : le dépôt choisi par l'utilisateur (paramètre local
   * `active_warehouse_id`) s'il existe encore, sinon le dépôt par défaut.
   */
  getActiveWarehouseId(): string {
    const row = stmtGetSetting.get('active_warehouse_id') as { value: string } | undefined;
    const active = row?.value;
    if (active) {
      const exists = stmtGetWarehouseById.get(active) as { id: string } | undefined;
      if (exists?.id) return exists.id;
    }
    return this.getDefaultWarehouseId();
  },

  /** Résout le dépôt d'une écriture : explicite, sinon dépôt actif. */
  resolveWarehouseId(explicit?: string): string {
    if (explicit) {
      const exists = stmtGetWarehouseById.get(explicit) as { id: string } | undefined;
      if (exists?.id) return exists.id;
    }
    return this.getActiveWarehouseId();
  },

  /**
   * Niveau de stock d'un produit.
   * @param warehouseId Dépôt précis ; absent → CONSOLIDÉ (somme des dépôts).
   */
  getStockLevel(productId: string, warehouseId?: string): number {
    if (warehouseId) {
      const row = stmtGetBalanceAt.get(productId, warehouseId) as { quantity: number } | undefined;
      return Number(row?.quantity ?? 0);
    }
    const row = stmtGetBalanceConsolidated.get(productId) as { quantity: number } | undefined;
    return Number(row?.quantity ?? 0);
  },

  /** Solde détaillé par dépôt (pour l'affichage multi-dépôts). */
  getWarehouseStock(productId: string): Array<{ warehouse_id: string; quantity: number }> {
    return db.prepare(`
      SELECT bc.warehouse_id, bc.quantity
      FROM inventory_balances bc
      WHERE bc.product_id = ? AND bc.quantity <> 0
      ORDER BY bc.warehouse_id
    `).all(productId) as Array<{ warehouse_id: string; quantity: number }>;
  },

  /**
   * Répartition du stock d'un produit PAR dépôt, avec le nom du dépôt.
   * Tous les dépôts sont listés (quantité 0 incluse) pour afficher clairement
   * où se trouve le stock.
   */
  getWarehouseBreakdown(productId: string): Array<{ warehouse_id: string; warehouse_name: string; quantity: number }> {
    return db.prepare(`
      SELECT w.id AS warehouse_id, w.name AS warehouse_name, COALESCE(ib.quantity, 0) AS quantity
      FROM warehouses w
      LEFT JOIN inventory_balances ib ON ib.warehouse_id = w.id AND ib.product_id = ?
      ORDER BY w.name ASC
    `).all(productId) as Array<{ warehouse_id: string; warehouse_name: string; quantity: number }>;
  },

  /**
   * Coût moyen pondéré (CMUP) d'un produit. Entrées valorisantes uniquement.
   * @param warehouseId Dépôt précis ; absent → consolidé.
   */
  getAverageCost(productId: string, warehouseId?: string): number {
    const row = (warehouseId
      ? stmtGetBalanceAt.get(productId, warehouseId)
      : stmtGetBalanceConsolidated.get(productId)) as { total_in_qty: number; total_in_value: number } | undefined;
    const value = Number(row?.total_in_value ?? 0);
    const qty = Number(row?.total_in_qty ?? 0);
    if (qty > 0) return value / qty;
    const fallback = db.prepare('SELECT purchase_price FROM products WHERE id = ?').get(productId) as { purchase_price: number } | undefined;
    return Number(fallback?.purchase_price ?? 0);
  },

  /**
   * Valorisation du stock (Σ stock × CMUP) sur les produits actifs.
   * @param warehouseId Dépôt précis ; absent → consolidé (tous dépôts).
   */
  getStockValue(warehouseId?: string): number {
    if (warehouseId) {
      const row = db.prepare(`
        SELECT COALESCE(SUM(ib.quantity * ib.average_cost), 0) AS total
        FROM products p
        JOIN inventory_balances ib ON ib.product_id = p.id
        WHERE p.status = 'ACTIVE' AND ib.quantity > 0 AND ib.warehouse_id = ?
      `).get(warehouseId) as { total: number };
      return Number(row.total ?? 0);
    }
    const row = db.prepare(`
      SELECT COALESCE(SUM(ib.quantity * ib.average_cost), 0) AS total
      FROM products p
      JOIN inventory_balances ib ON ib.product_id = p.id
      WHERE p.status = 'ACTIVE' AND ib.quantity > 0
    `).get() as { total: number };
    return Number(row.total ?? 0);
  },

  /** Historique des mouvements d'un produit (tous dépôts). */
  getHistory(productId: string, limit = 200, offset = 0): StockMovementRow[] {
    return db.prepare(`
      SELECT * FROM stock_movements
      WHERE product_id = ?
      ORDER BY date DESC
      LIMIT ? OFFSET ?
    `).all(productId, limit, offset) as StockMovementRow[];
  },

  /** Historique global (avec référence produit + nom de dépôt). */
  getAllHistory(limit = 500, offset = 0): Array<StockMovementRow & { product_ref?: string; product_name?: string; warehouse_name?: string }> {
    return db.prepare(`
      SELECT sm.*, p.reference AS product_ref, p.designation AS product_name, w.name AS warehouse_name
      FROM stock_movements sm
      LEFT JOIN products p ON p.id = sm.product_id
      LEFT JOIN warehouses w ON w.id = sm.warehouse_id
      ORDER BY sm.date DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset) as Array<StockMovementRow & { product_ref?: string; product_name?: string; warehouse_name?: string }>;
  },
/**
   * Enregistre un mouvement de stock. Point d'entrée UNIQUE pour les écritures.
   *
   * Garanties : quantité > 0, produit existant, stock suffisant pour une sortie
   * (vérifié DANS LE DÉPÔT concerné), atomique (mouvement + solde du dépôt).
   */
  recordMovement(input: MovementInput): StockMovementRow {
    const quantity = Number(input.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error('Quantité invalide : le mouvement doit avoir une quantité supérieure à 0.');
    }

    const direction = MOVEMENT_DIRECTION[input.movement_type] ?? input.direction;
    if (!direction) {
      throw new Error(`Type de mouvement inconnu : ${input.movement_type}`);
    }

    // Dépôt de l'écriture : explicite, sinon dépôt actif (repli : défaut).
    const warehouseId = this.resolveWarehouseId(input.warehouse_id);

    return runInTransaction(() => {
      const product = stmtGetProduct.get(input.product_id) as { reference: string; designation: string; purchase_price: number } | undefined;
      if (!product) {
        throw new Error('Produit introuvable : impossible de créer un mouvement de stock.');
      }

      // Vérification du stock pour les sorties — DANS LE DÉPÔT concerné.
      if (direction === 'OUT') {
        const current = this.getStockLevel(input.product_id, warehouseId);
        if (current < quantity) {
          const warehouseName = (db.prepare('SELECT name FROM warehouses WHERE id = ?').get(warehouseId) as { name: string } | undefined)?.name ?? 'dépôt';
          throw new Error(
            `Stock insuffisant pour "${product.reference} (${product.designation})" dans le dépôt « ${warehouseName} » : ` +
            `demandé ${quantity}, disponible ${current}.`
          );
        }
      }

      // §Phase 13 — FEFO (« First Expired, First Out ») : toute SORTIE de stock
      // consomme les lots par date d'expiration CROISSANTE, dans la MÊME
      // transaction que le mouvement et le solde (unité atomique).
      // Seuls les produits `batch_managed = 1` sont concernés : tous les autres
      // sont ignorés (`skipped: true`), donc AUCUN changement de comportement
      // pour les produits sans gestion de lots.
      let batchAllocations: FefoAllocation[] | undefined;
      if (direction === 'OUT') {
        const consumption = ProductBatchRepository.consumeFefoInTransaction(input.product_id, quantity);
        if (!consumption.skipped && consumption.allocations.length > 0) {
          batchAllocations = consumption.allocations;
        }
      }

      const movement: StockMovementRow = {
        id: randomUUID(),
        product_id: input.product_id,
        warehouse_id: warehouseId,
        type: direction,
        movement_type: input.movement_type,
        quantity,
        unit_price: Number(input.unit_price ?? 0),
        date: input.date ?? new Date().toISOString(),
        reference_doc: input.reference_doc,
        document_id: input.document_id,
        supplier_id: input.supplier_id,
        notes: input.notes,
      };
      if (batchAllocations) movement.batch_allocations = batchAllocations;

      stmtInsert.run({
        id: movement.id,
        product_id: movement.product_id,
        warehouse_id: warehouseId,
        type: movement.type,
        movement_type: movement.movement_type,
        quantity: movement.quantity,
        unit_price: movement.unit_price,
        date: movement.date,
        reference_doc: movement.reference_doc ?? null,
        document_id: movement.document_id ?? null,
        supplier_id: movement.supplier_id ?? null,
        notes: movement.notes ?? null,
      });

      // §14 : solde du (produit, dépôt) mis à jour DANS la même transaction.
      const balance = stmtGetBalanceAt.get(input.product_id, warehouseId) as
        { quantity: number; total_in_qty: number; total_in_value: number } | undefined;

      const currentQty = Number(balance?.quantity ?? 0);
      const currentInQty = Number(balance?.total_in_qty ?? 0);
      const currentInValue = Number(balance?.total_in_value ?? 0);

      const newQty = direction === 'IN' ? currentQty + quantity : currentQty - quantity;
      const newInQty = direction === 'IN' ? currentInQty + quantity : currentInQty;
      const newInValue = direction === 'IN' ? currentInValue + quantity * movement.unit_price : currentInValue;
      const newAverageCost = newInQty > 0 ? newInValue / newInQty : 0;

      stmtUpsertBalance.run({
        product_id: input.product_id,
        warehouse_id: warehouseId,
        quantity: newQty,
        total_in_qty: newInQty,
        total_in_value: newInValue,
        average_cost: newAverageCost,
      });

      return movement;
    });
  },

  /**
   * Reconstruit `inventory_balances` depuis l'historique, PAR (produit, dépôt).
   * Backfill idempotent exécuté au démarrage (logique CMUP inchangée).
   */
  rebuildBalances(): void {
    db.transaction(() => {
      db.exec('DELETE FROM inventory_balances;');
      db.exec(`
        INSERT INTO inventory_balances (product_id, warehouse_id, quantity, total_in_qty, total_in_value, updated_at)
        SELECT
          product_id,
          warehouse_id,
          SUM(CASE WHEN type = 'IN' THEN quantity ELSE -quantity END) AS quantity,
          SUM(CASE WHEN type = 'IN' THEN quantity ELSE 0 END) AS total_in_qty,
          SUM(CASE WHEN type = 'IN' THEN quantity * unit_price ELSE 0 END) AS total_in_value,
          CURRENT_TIMESTAMP
        FROM stock_movements
        GROUP BY product_id, warehouse_id
      `);
      db.exec(`
        UPDATE inventory_balances
        SET average_cost = CASE WHEN total_in_qty > 0 THEN total_in_value / total_in_qty ELSE 0 END
        WHERE total_in_qty > 0
      `);
    })();
  },

  /**
   * Ajustement d'inventaire directionnel, pour UN dépôt précis.
   * @returns le mouvement créé, ou null si aucun écart
   */
  adjustInventory(input: {
    product_id: string;
    actualCount: number;
    warehouse_id?: string;
    unit_price?: number;
    document_id?: string;
    notes?: string;
  }): StockMovementRow | null {
    const warehouseId = this.resolveWarehouseId(input.warehouse_id);
    const current = this.getStockLevel(input.product_id, warehouseId);
    const actual = Number(input.actualCount);
    if (!Number.isFinite(actual) || actual < 0) {
      throw new Error('Quantité comptée invalide.');
    }

    const difference = actual - current;
    if (difference === 0) return null;

    const isSurplus = difference > 0;
    return this.recordMovement({
      product_id: input.product_id,
      movement_type: isSurplus ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
      quantity: Math.abs(difference),
      warehouse_id: warehouseId,
      unit_price: input.unit_price,
      document_id: input.document_id,
      notes: input.notes
        ? `${input.notes} — écart ${difference > 0 ? '+' : ''}${difference} (compté ${actual})`
        : `Inventaire : écart ${difference > 0 ? '+' : ''}${difference} (compté ${actual})`,
    });
  },

  /**
   * Transfert de stock entre deux dépôts (ATOMIQUE).
   *
   * Vérifie le stock disponible dans le dépôt source, puis crée — dans UNE SEULE
   * transaction — TRANSFER_OUT (source) + TRANSFER_IN (destination) + une ligne
   * `stock_transfers`. Jamais l'un sans l'autre.
   */
  transferStock(input: {
    product_id: string;
    from_warehouse_id: string;
    to_warehouse_id: string;
    quantity: number;
    notes?: string;
  }): WarehouseTransferRow {
    const quantity = Number(input.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error('Quantité de transfert invalide : elle doit être supérieure à 0.');
    }

    const fromId = this.resolveWarehouseId(input.from_warehouse_id);
    const toId = this.resolveWarehouseId(input.to_warehouse_id);
    if (fromId === toId) {
      throw new Error('Le dépôt source et le dépôt de destination doivent être différents.');
    }

    return runInTransaction(() => {
      const product = stmtGetProduct.get(input.product_id) as { reference: string; designation: string } | undefined;
      if (!product) {
        throw new Error('Produit introuvable : impossible de transférer le stock.');
      }

      const available = this.getStockLevel(input.product_id, fromId);
      if (available < quantity) {
        const fromName = (db.prepare('SELECT name FROM warehouses WHERE id = ?').get(fromId) as { name: string } | undefined)?.name ?? 'dépôt source';
        throw new Error(
          `Stock insuffisant pour transférer "${product.reference} (${product.designation})" depuis « ${fromName} » : ` +
          `demandé ${quantity}, disponible ${available}.`
        );
      }

      const notes = input.notes ?? 'Transfert entre dépôts';

      this.recordMovement({
        product_id: input.product_id,
        movement_type: 'TRANSFER_OUT',
        quantity,
        warehouse_id: fromId,
        notes,
      });
      this.recordMovement({
        product_id: input.product_id,
        movement_type: 'TRANSFER_IN',
        quantity,
        warehouse_id: toId,
        notes,
      });

      const row: WarehouseTransferRow = {
        id: randomUUID(),
        product_id: input.product_id,
        from_warehouse_id: fromId,
        to_warehouse_id: toId,
        quantity,
        date: new Date().toISOString(),
        notes,
      };
      stmtInsertTransfer.run({
        id: row.id,
        product_id: row.product_id,
        from_warehouse_id: row.from_warehouse_id,
        to_warehouse_id: row.to_warehouse_id,
        quantity: row.quantity,
        date: row.date,
        notes: row.notes ?? null,
      });

      return row;
    });
  },

  /** Historique des transferts entre dépôts (avec noms). */
  getTransfers(limit = 200, offset = 0): Array<WarehouseTransferRow & { product_ref?: string; product_name?: string; from_name?: string; to_name?: string }> {
    return db.prepare(`
      SELECT t.*, p.reference AS product_ref, p.designation AS product_name,
             wf.name AS from_name, wt.name AS to_name
      FROM stock_transfers t
      LEFT JOIN products p ON p.id = t.product_id
      LEFT JOIN warehouses wf ON wf.id = t.from_warehouse_id
      LEFT JOIN warehouses wt ON wt.id = t.to_warehouse_id
      ORDER BY t.date DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset) as Array<WarehouseTransferRow & { product_ref?: string; product_name?: string; from_name?: string; to_name?: string }>;
  },

  /**
   * §Phase 3.1 — AUDIT du stock (LECTURE SEULE, aucune écriture).
   *
   * Compare le solde STOCKÉ (`inventory_balances`) au solde ATTENDU recalculé
   * depuis la source de vérité (`stock_movements`). Renvoie la liste des écarts
   * sans jamais rien modifier : la réparation est une décision explicite de
   * l'utilisateur (`repairBalances`).
   */
  auditBalances(): StockAuditResult {
    const expectedRows = db.prepare(`
      SELECT
        product_id,
        warehouse_id,
        SUM(CASE WHEN type = 'IN' THEN quantity ELSE -quantity END) AS expected_qty,
        SUM(CASE WHEN type = 'IN' THEN quantity ELSE 0 END) AS expected_in_qty,
        SUM(CASE WHEN type = 'IN' THEN quantity * unit_price ELSE 0 END) AS expected_in_value
      FROM stock_movements
      GROUP BY product_id, warehouse_id
    `).all() as Array<{ product_id: string; warehouse_id: string; expected_qty: number; expected_in_qty: number; expected_in_value: number }>;

    const storedRows = db.prepare(`
      SELECT ib.product_id, ib.warehouse_id, ib.quantity AS stored_qty,
             ib.total_in_qty AS stored_in_qty, ib.total_in_value AS stored_in_value,
             p.reference AS product_ref, p.designation AS product_name,
             w.name AS warehouse_name
      FROM inventory_balances ib
      LEFT JOIN products p ON p.id = ib.product_id
      LEFT JOIN warehouses w ON w.id = ib.warehouse_id
    `).all() as Array<{ product_id: string; warehouse_id: string; stored_qty: number; stored_in_qty: number; stored_in_value: number; product_ref?: string; product_name?: string; warehouse_name?: string }>;

    const keyOf = (productId: string, warehouseId: string) => `${productId}|${warehouseId}`;
    const expectedByKey = new Map(expectedRows.map(r => [keyOf(r.product_id, r.warehouse_id), r]));
    const storedByKey = new Map(storedRows.map(r => [keyOf(r.product_id, r.warehouse_id), r]));
    const allKeys = new Set<string>([...expectedByKey.keys(), ...storedByKey.keys()]);

    const TOLERANCE = 0.0001; // quantités REAL : tolérance flottante
    const discrepancies: StockDiscrepancy[] = [];

    for (const key of allKeys) {
      const expected = expectedByKey.get(key);
      const stored = storedByKey.get(key);
      const expectedQty = Number(expected?.expected_qty ?? 0);
      const storedQty = Number(stored?.stored_qty ?? 0);
      const difference = Number((storedQty - expectedQty).toFixed(4));
      if (Math.abs(difference) <= TOLERANCE) continue;

      const productId = expected?.product_id ?? stored!.product_id;
      const warehouseId = expected?.warehouse_id ?? stored!.warehouse_id;
      discrepancies.push({
        product_id: productId,
        warehouse_id: warehouseId,
        product_ref: stored?.product_ref,
        product_name: stored?.product_name,
        warehouse_name: stored?.warehouse_name,
        stored_qty: storedQty,
        expected_qty: expectedQty,
        stored_in_qty: Number(stored?.stored_in_qty ?? 0),
        expected_in_qty: Number(expected?.expected_in_qty ?? 0),
        stored_in_value: Number(stored?.stored_in_value ?? 0),
        expected_in_value: Number(expected?.expected_in_value ?? 0),
        difference,
      });
    }

    return {
      checked: allKeys.size,
      discrepancyCount: discrepancies.length,
      discrepancies: discrepancies.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference)),
    };
  },

  /**
   * §Phase 3.1 — RÉPARATION contrôlée du stock.
   *
   * Ne répare QUE les couples (produit, dépôt) explicitement fournis : le solde
   * est recalculé depuis `stock_movements` puis réécrit. Aucun écrasement
   * silencieux — la fonction renvoie le détail avant/après pour l'audit.
   */
  repairBalances(items: Array<{ product_id: string; warehouse_id: string }>): StockRepairResult {
    if (!Array.isArray(items) || items.length === 0) {
      return { repaired: 0, details: [] };
    }

    return runInTransaction(() => {
      const details: StockRepairDetail[] = [];

      for (const item of items) {
        const productId = String(item.product_id ?? '');
        const warehouseId = String(item.warehouse_id ?? '');
        if (!productId || !warehouseId) continue;

        const agg = db.prepare(`
          SELECT
            COALESCE(SUM(CASE WHEN type = 'IN' THEN quantity ELSE -quantity END), 0) AS qty,
            COALESCE(SUM(CASE WHEN type = 'IN' THEN quantity ELSE 0 END), 0) AS in_qty,
            COALESCE(SUM(CASE WHEN type = 'IN' THEN quantity * unit_price ELSE 0 END), 0) AS in_value
          FROM stock_movements WHERE product_id = ? AND warehouse_id = ?
        `).get(productId, warehouseId) as { qty: number; in_qty: number; in_value: number };

        const before = stmtGetBalanceAt.get(productId, warehouseId) as { quantity: number } | undefined;
        const beforeQty = Number(before?.quantity ?? 0);
        const newQty = Number(agg.qty ?? 0);
        const newInQty = Number(agg.in_qty ?? 0);
        const newInValue = Number(agg.in_value ?? 0);

        stmtUpsertBalance.run({
          product_id: productId,
          warehouse_id: warehouseId,
          quantity: newQty,
          total_in_qty: newInQty,
          total_in_value: newInValue,
          average_cost: newInQty > 0 ? newInValue / newInQty : 0,
        });

        details.push({ product_id: productId, warehouse_id: warehouseId, before_qty: beforeQty, after_qty: newQty });
      }

      return { repaired: details.length, details };
    });
  },

  /**
   * Transfert historique entre deux PRODUITS (API conservée pour compatibilité).
   * Crée TRANSFER_OUT + TRANSFER_IN dans le dépôt actif.
   */
  transfer(input: {
    from_product_id: string;
    to_product_id: string;
    quantity: number;
    notes?: string;
  }): { out: StockMovementRow; in: StockMovementRow } {
    return runInTransaction(() => {
      const out = this.recordMovement({
        product_id: input.from_product_id,
        movement_type: 'TRANSFER_OUT',
        quantity: input.quantity,
        notes: input.notes ?? 'Transfert',
      });
      const inMovement = this.recordMovement({
        product_id: input.to_product_id,
        movement_type: 'TRANSFER_IN',
        quantity: input.quantity,
        notes: input.notes ?? 'Transfert',
      });
      return { out, in: inMovement };
    });
  },
};
