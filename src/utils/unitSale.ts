/**
 * Phase 6 — Vente en unité alternative (`unit_conversions`).
 *
 * Le stock est comptabilisé dans l'unité de BASE du produit. Lorsqu'une ligne
 * est vendue dans une unité alternative (ex : CARTON), on convertit :
 *   - la quantité vendue → quantité en unité de base (pour décrémenter le stock) ;
 *   - le prix unitaire (par unité alternative) → prix unitaire de base,
 *     afin de préserver EXACTEMENT le total de la ligne.
 *
 * Sans conversion définie, le facteur vaut 1 : comportement inchangé.
 */

export interface SaleUnitConversion {
  from_unit: string;
  to_unit: string;
  factor: number;
}

/**
 * Facteur de conversion : nombre d'unités de base pour 1 unité de vente.
 * Retourne 1 si `saleUnit` est l'unité de base ou si aucune règle n'est trouvée.
 */
export function resolveUnitFactor(
  baseUnit: string,
  saleUnit: string,
  conversions: SaleUnitConversion[],
): number {
  if (!saleUnit || saleUnit === baseUnit) return 1;

  // Conversion directe : 1 saleUnit = factor baseUnit.
  const direct = conversions.find(c => c.from_unit === saleUnit && c.to_unit === baseUnit);
  if (direct && direct.factor > 0) return direct.factor;

  // Conversion inverse : 1 baseUnit = factor saleUnit → 1 saleUnit = 1/factor baseUnit.
  const inverse = conversions.find(c => c.from_unit === baseUnit && c.to_unit === saleUnit);
  if (inverse && inverse.factor > 0) return 1 / inverse.factor;

  return 1;
}

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
