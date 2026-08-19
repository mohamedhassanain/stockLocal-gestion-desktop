import { db } from '../database/config/connection';
import { randomUUID } from 'crypto';

export interface UnitConversion {
  id: string;
  from_unit: string;
  to_unit: string;
  factor: number;
  product_id: string | null;
  created_at?: string;
}

const stmtGetAll = db.prepare('SELECT * FROM unit_conversions ORDER BY from_unit ASC');
const stmtGetByProduct = db.prepare('SELECT * FROM unit_conversions WHERE product_id = ? OR product_id IS NULL ORDER BY from_unit ASC');
const stmtInsert = db.prepare(`
  INSERT INTO unit_conversions (id, from_unit, to_unit, factor, product_id)
  VALUES (?, ?, ?, ?, ?)
`);
const stmtUpdate = db.prepare(`
  UPDATE unit_conversions SET from_unit = ?, to_unit = ?, factor = ?, product_id = ? WHERE id = ?
`);
const stmtDelete = db.prepare('DELETE FROM unit_conversions WHERE id = ?');

export const UnitConversionRepository = {
  getAll(): UnitConversion[] {
    return stmtGetAll.all() as UnitConversion[];
  },

  getByProduct(productId: string): UnitConversion[] {
    return stmtGetByProduct.all(productId) as UnitConversion[];
  },

  create(data: Omit<UnitConversion, 'id' | 'created_at'>): UnitConversion {
    const id = randomUUID();
    stmtInsert.run(id, data.from_unit, data.to_unit, data.factor, data.product_id ?? null);
    return { id, ...data };
  },

  update(id: string, data: Omit<UnitConversion, 'id' | 'created_at'>): UnitConversion {
    stmtUpdate.run(data.from_unit, data.to_unit, data.factor, data.product_id ?? null, id);
    return { id, ...data };
  },

  remove(id: string): void {
    stmtDelete.run(id);
  },

  /**
   * Convertit une quantité d'une unité à une autre.
   * Retourne null si aucune conversion n'est trouvée.
   */
  convert(quantity: number, fromUnit: string, toUnit: string, productId?: string): number | null {
    if (fromUnit === toUnit) return quantity;

    // Chercher une conversion directe
    const direct = db.prepare(
      'SELECT factor FROM unit_conversions WHERE from_unit = ? AND to_unit = ? AND (product_id = ? OR product_id IS NULL) ORDER BY product_id DESC LIMIT 1'
    ).get(fromUnit, toUnit, productId ?? null) as { factor: number } | undefined;

    if (direct) return quantity * direct.factor;

    // Chercher une conversion inverse
    const inverse = db.prepare(
      'SELECT factor FROM unit_conversions WHERE from_unit = ? AND to_unit = ? AND (product_id = ? OR product_id IS NULL) ORDER BY product_id DESC LIMIT 1'
    ).get(toUnit, fromUnit, productId ?? null) as { factor: number } | undefined;

    if (inverse) return quantity / inverse.factor;

    return null;
  }
};
