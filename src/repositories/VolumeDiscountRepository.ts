import { db } from '../database/config/connection';
import { randomUUID } from 'crypto';

export interface VolumeDiscount {
  id: string;
  name: string;
  min_qty: number;
  max_qty?: number | null;
  discount_pct: number;
}

const stmtAll = db.prepare('SELECT * FROM volume_discounts ORDER BY min_qty ASC');
const stmtInsert = db.prepare(`
  INSERT INTO volume_discounts (id, name, min_qty, max_qty, discount_pct)
  VALUES (?, ?, ?, ?, ?)
`);
const stmtUpdate = db.prepare(`
  UPDATE volume_discounts SET name = ?, min_qty = ?, max_qty = ?, discount_pct = ?, updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`);
const stmtDelete = db.prepare('DELETE FROM volume_discounts WHERE id = ?');

export const VolumeDiscountRepository = {
  getAll(): VolumeDiscount[] {
    return stmtAll.all() as VolumeDiscount[];
  },

  create(data: { name: string; min_qty: number; max_qty?: number | null; discount_pct: number }): VolumeDiscount {
    const id = randomUUID();
    stmtInsert.run(id, data.name, data.min_qty, data.max_qty ?? null, data.discount_pct);
    return { id, ...data, max_qty: data.max_qty ?? null };
  },

  update(id: string, data: { name: string; min_qty: number; max_qty?: number | null; discount_pct: number }): VolumeDiscount {
    stmtUpdate.run(data.name, data.min_qty, data.max_qty ?? null, data.discount_pct, id);
    return { id, ...data, max_qty: data.max_qty ?? null };
  },

  remove(id: string): void {
    stmtDelete.run(id);
  },

  /** Applique la remise en fonction de la quantité (règle métier tarification). */
  getDiscountForQuantity(quantity: number): number {
    const rules = this.getAll().filter(r => quantity >= r.min_qty && (r.max_qty == null || quantity <= r.max_qty));
    if (rules.length === 0) return 0;
    return Math.max(...rules.map(r => r.discount_pct));
  }
};
