import { db } from '../database/config/connection';
import { randomUUID } from 'crypto';

/**
 * Phase 3 — Lots / dates d'expiration (`product_batches`).
 *
 * Complémentaire au moteur de stock global (StockLedgerService) : les lots
 * N'ONT PAS d'impact sur `inventory_balances` ni sur les mouvements. Ils
 * enregistrent uniquement un détail qualité (numéro de lot + date d'expiration)
 * pour les produits marqués `batch_managed = 1`.
 */

export interface ProductBatch {
  id: string;
  product_id: string;
  lot_number: string;
  quantity: number;
  expiry_date: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ExpiringBatch {
  id: string;
  product_id: string;
  product_ref?: string;
  product_name?: string;
  lot_number: string;
  quantity: number;
  expiry_date: string | null;
  days_left: number | null;
}

const stmtListByProduct = db.prepare('SELECT * FROM product_batches WHERE product_id = ? ORDER BY expiry_date ASC');
const stmtGetById = db.prepare('SELECT * FROM product_batches WHERE id = ?');
const stmtInsert = db.prepare(`
  INSERT INTO product_batches (id, product_id, lot_number, quantity, expiry_date)
  VALUES (?, ?, ?, ?, ?)
`);
const stmtUpdateQuantity = db.prepare(`
  UPDATE product_batches SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
`);
const stmtDelete = db.prepare('DELETE FROM product_batches WHERE id = ?');

// Lots proches de l'expiration : UNIQUEMENT les produits en gestion par lots.
// `days_left` est négatif pour un lot déjà expiré.
const stmtExpiring = db.prepare<[number]>(`
  SELECT pb.id, pb.product_id, p.reference AS product_ref, p.designation AS product_name,
    pb.lot_number, pb.quantity, pb.expiry_date,
    CAST(julianday(pb.expiry_date) - julianday('now') AS INTEGER) AS days_left
  FROM product_batches pb
  JOIN products p ON p.id = pb.product_id
  WHERE p.batch_managed = 1
    AND p.status = 'ACTIVE'
    AND pb.expiry_date IS NOT NULL
    AND pb.quantity > 0
    AND julianday(pb.expiry_date) - julianday('now') <= ?
  ORDER BY pb.expiry_date ASC
  LIMIT 200
`);

export const ProductBatchRepository = {
  listByProduct(productId: string): ProductBatch[] {
    return stmtListByProduct.all(productId) as ProductBatch[];
  },

  getById(id: string): ProductBatch | undefined {
    return stmtGetById.get(id) as ProductBatch | undefined;
  },

  /** Crée un lot (numéro de lot obligatoire, date d'expiration optionnelle). */
  create(data: { product_id: string; lot_number: string; quantity: number; expiry_date?: string | null }): ProductBatch {
    const lotNumber = data.lot_number.trim();
    if (!lotNumber) throw new Error('Le numéro de lot est obligatoire.');
    const quantity = Number(data.quantity);
    if (!Number.isFinite(quantity) || quantity < 0) throw new Error('Quantité de lot invalide.');

    const id = randomUUID();
    stmtInsert.run(id, data.product_id, lotNumber, quantity, data.expiry_date ?? null);
    return this.getById(id)!;
  },

  updateQuantity(id: string, quantity: number): void {
    const q = Number(quantity);
    if (!Number.isFinite(q) || q < 0) throw new Error('Quantité de lot invalide.');
    stmtUpdateQuantity.run(q, id);
  },

  remove(id: string): void {
    stmtDelete.run(id);
  },

  /**
   * Lots dont l'expiration est à venir dans `withinDays` (ou déjà dépassée).
   * Les produits sans gestion de lots (`batch_managed = 0`) n'apparaissent
   * JAMAIS dans cette liste.
   */
  getExpiringBatches(withinDays: number = 30): ExpiringBatch[] {
    const days = Math.max(0, Math.min(3650, Number(withinDays) || 30));
    return stmtExpiring.all(days) as ExpiringBatch[];
  },
};
