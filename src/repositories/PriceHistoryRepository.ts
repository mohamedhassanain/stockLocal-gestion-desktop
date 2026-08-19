import { db } from '../database/config/connection';
import { randomUUID } from 'crypto';

export interface PriceHistoryEntry {
  id: string;
  product_id: string;
  purchase_price: number;
  selling_price: number;
  wholesale_price: number;
  changed_at: string;
  reason: string | null;
}

const stmtGetByProduct = db.prepare(
  'SELECT * FROM price_history WHERE product_id = ? ORDER BY changed_at DESC LIMIT 50'
);
const stmtGetLatest = db.prepare(
  'SELECT * FROM price_history WHERE product_id = ? ORDER BY changed_at DESC LIMIT 1'
);
const stmtInsert = db.prepare(`
  INSERT INTO price_history (id, product_id, purchase_price, selling_price, wholesale_price, reason)
  VALUES (?, ?, ?, ?, ?, ?)
`);

export const PriceHistoryRepository = {
  getByProduct(productId: string): PriceHistoryEntry[] {
    return stmtGetByProduct.all(productId) as PriceHistoryEntry[];
  },

  getLatest(productId: string): PriceHistoryEntry | undefined {
    return stmtGetLatest.get(productId) as PriceHistoryEntry | undefined;
  },

  /**
   * Enregistre un changement de prix si les prix ont effectivement changé.
   * Appelé automatiquement lors de la mise à jour d'un produit.
   */
  recordChange(
    productId: string,
    oldPrices: { purchase_price: number; selling_price: number; wholesale_price: number },
    newPrices: { purchase_price: number; selling_price: number; wholesale_price: number },
    reason?: string
  ): void {
    const changed =
      oldPrices.purchase_price !== newPrices.purchase_price ||
      oldPrices.selling_price !== newPrices.selling_price ||
      oldPrices.wholesale_price !== newPrices.wholesale_price;

    if (!changed) return;

    const id = randomUUID();
    stmtInsert.run(
      id,
      productId,
      newPrices.purchase_price,
      newPrices.selling_price,
      newPrices.wholesale_price,
      reason ?? null
    );
  }
};
