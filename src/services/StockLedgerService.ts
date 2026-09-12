import { db, runInTransaction } from '../database/config/connection';
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
