import { db } from '../database/config/connection';
import { roundMoney } from '../utils/money';

/**
 * ─── §B3 — Repository de tarification (niveaux de prix) ─────────────────────
 *
 * SEUL endroit qui lit/écrit `product_price_levels` et `customer_prices`.
 * Aucune règle métier ici : la résolution (priorité) vit dans
 * `domain/pricing/priceLevels.ts`, orchestrée par `services/PricingService.ts`.
 *
 * Principe : un prix ABSENT n'est pas un prix à 0 — c'est « pas de prix
 * défini à ce niveau », donc `null` en retour (et non 0), pour que la
 * résolution retombe sur la source suivante.
 */

export interface ProductLevelPrice {
  product_id: string;
  level: string;
  price: number;
}

function toNullablePrice(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

const stmtGetCustomerPrice = db.prepare(
  'SELECT price FROM customer_prices WHERE customer_id = ? AND product_id = ?'
);

const stmtUpsertCustomerPrice = db.prepare(`
  INSERT INTO customer_prices (customer_id, product_id, price, updated_at)
  VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(customer_id, product_id) DO UPDATE SET
    price = excluded.price,
    updated_at = CURRENT_TIMESTAMP
`);

const stmtDeleteCustomerPrice = db.prepare(
  'DELETE FROM customer_prices WHERE customer_id = ? AND product_id = ?'
);

const stmtGetLevelPrice = db.prepare(
  'SELECT price FROM product_price_levels WHERE product_id = ? AND level = ?'
);

const stmtUpsertLevelPrice = db.prepare(`
  INSERT INTO product_price_levels (product_id, level, price, updated_at)
  VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(product_id, level) DO UPDATE SET
    price = excluded.price,
    updated_at = CURRENT_TIMESTAMP
`);

const stmtDeleteLevelPrice = db.prepare(
  'DELETE FROM product_price_levels WHERE product_id = ? AND level = ?'
);

const stmtListProductLevels = db.prepare(
  'SELECT product_id, level, price FROM product_price_levels WHERE product_id = ? ORDER BY level ASC'
);

const stmtGetCustomerLevel = db.prepare(
  'SELECT price_level FROM customers WHERE id = ?'
);

const stmtSetCustomerLevel = db.prepare(
  'UPDATE customers SET price_level = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
);

const stmtGetStandardPrice = db.prepare(
  'SELECT selling_price FROM products WHERE id = ?'
);

export const PricingRepository = {
  /** Prix spécifique négocié pour (client, produit), ou `null` si non défini. */
  getCustomerPrice(customerId: string, productId: string): number | null {
    const row = stmtGetCustomerPrice.get(customerId, productId) as { price?: number } | undefined;
    return row ? toNullablePrice(row.price) : null;
  },

  /** Définit (ou remplace) le prix spécifique d'un produit pour un client. */
  setCustomerPrice(customerId: string, productId: string, price: number): void {
    stmtUpsertCustomerPrice.run(customerId, productId, roundMoney(price));
  },

  /** Supprime le prix spécifique d'un client (retour au niveau/standard). */
  deleteCustomerPrice(customerId: string, productId: string): void {
    stmtDeleteCustomerPrice.run(customerId, productId);
  },

  /** Prix d'un produit pour un niveau donné, ou `null` si non défini. */
  getLevelPrice(productId: string, level: string): number | null {
    const row = stmtGetLevelPrice.get(productId, level) as { price?: number } | undefined;
    return row ? toNullablePrice(row.price) : null;
  },

  /** Définit (ou remplace) le prix d'un produit pour un niveau. */
  setLevelPrice(productId: string, level: string, price: number): void {
    stmtUpsertLevelPrice.run(productId, level, roundMoney(price));
  },

  /** Supprime le prix d'un niveau pour un produit (retour au standard). */
  deleteLevelPrice(productId: string, level: string): void {
    stmtDeleteLevelPrice.run(productId, level);
  },

  /** Tous les prix par niveau définis pour un produit. */
  listProductLevels(productId: string): ProductLevelPrice[] {
    return stmtListProductLevels.all(productId) as ProductLevelPrice[];
  },

  /** Niveau de prix d'un client (`null` si le client n'existe pas). */
  getCustomerLevel(customerId: string): string | null {
    const row = stmtGetCustomerLevel.get(customerId) as { price_level?: string } | undefined;
    return row && typeof row.price_level === 'string' ? row.price_level : null;
  },

  /** Met à jour le niveau de prix d'un client. */
  setCustomerLevel(customerId: string, level: string): void {
    stmtSetCustomerLevel.run(level, customerId);
  },

  /** Prix de vente standard d'un produit, ou `null` si le produit n'existe pas. */
  getStandardPrice(productId: string): number | null {
    const row = stmtGetStandardPrice.get(productId) as { selling_price?: number } | undefined;
    return row ? toNullablePrice(row.selling_price) : null;
  },
};
