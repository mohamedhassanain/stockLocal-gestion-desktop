/**
 * Phase 6 — Vente en unité alternative (`unit_conversions`).
 *
 * Le stock est comptabilisé dans l'unité de BASE du produit. Lorsqu'une ligne
 * est vendue dans une unité alternative (ex : CARTON), on convertit :
 *   - la quantité vendue → quantité en unité de base (pour décrémenter le stock) ;
 *   - le prix unitaire (par unité alternative) → prix unitaire de base,
 *     afin de préserver EXACTEMENT le total de la ligne.
 *
 * ⚠️ La RÉSOLUTION DU FACTEUR de conversion n'est PAS faite ici : elle est
 * déléguée au backend (`window.api.conversions.convert`, qui s'appuie sur la
 * table `unit_conversions`). Ce module ne contient que l'arithmétique pure
 * d'application du facteur — aucune règle de conversion n'est dupliquée.
 */

/** Quantité en unité de base (décrément de stock). */
export function toBaseQuantity(quantity: number, unitFactor: number): number {
  if (!Number.isFinite(unitFactor) || unitFactor <= 0) return quantity;
  return quantity * unitFactor;
}

/** Prix unitaire ramené à l'unité de base (préserve le total de ligne). */
export function toBaseUnitPrice(saleUnitPrice: number, unitFactor: number): number {
  if (!Number.isFinite(unitFactor) || unitFactor <= 0) return saleUnitPrice;
  return saleUnitPrice / unitFactor;
}
