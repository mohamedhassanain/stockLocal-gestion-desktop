/**
 * ─── Moteur monétaire central ──────────────────────────────────────────────────
 *
 * Source de vérité UNIQUE pour tout calcul monétaire (MAD, 2 décimales).
 *
 * Pourquoi ce module : avant, `round2()` était dupliqué dans DocumentRepository
 * ET dans POSPage, et les totaux/remises/TVA/résidus étaient recalculés à
 * plusieurs endroits avec un léger risque de divergence (arrondis, virgule
 * flottante). Désormais :
 *
 *   Service métier  ──►  money.ts  ──►  UI
 *
 * Règles :
 *   - Toute valeur monétaire est arrondie à 2 décimales (roundMoney).
 *   - Les sommes utilisent addMoney / sumMoney (jamais une addition brute
 *     de flottants exposée à l'utilisateur : 0.1 + 0.2 ≠ 0.30000000000000004).
 *   - La TVA est calculée ligne par ligne (même base que la facturation),
 *     jamais sur un total agrégé, pour rester cohérent avec les documents.
 *   - Aucune valeur non finie (NaN / Infinity) ne sort d'ici : elle vaut 0.
 *
 * Ce module ne connaît AUCUNE règle métier (pas de statut, pas de base de
 * données) : c'est de l'arithmétique monétaire pure, testable isolément.
 * ───────────────────────────────────────────────────────────────────────────────
 */

/** Nombre de décimales monétaires (le dirham marocain se compte en centimes). */
export const MONEY_DECIMALS = 2;

const MONEY_FACTOR = 10 ** MONEY_DECIMALS;

/** Tolérance d'arrondi par défaut pour les comparaisons monétaires (1 centime). */
export const MONEY_EPSILON = 0.01;

/** Normalise une valeur : `NaN`, `Infinity` et `null`/`undefined` valent 0. */
function toFinite(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Arrondit une valeur monétaire à 2 décimales (arrondi au plus proche).
 *
 * `+ Number.EPSILON` corrige les cas limites où la représentation binaire est
 * légèrement INFÉRIEURE à la valeur décimale exacte (ex. 1.005 → 1.00 sans
 * correction, 1.01 avec). Comportement identique à l'ancien `round2()` du
 * DocumentRepository : aucun montant existant ne change.
 */
export function roundMoney(value: number | null | undefined): number {
  return Math.round((toFinite(value) + Number.EPSILON) * MONEY_FACTOR) / MONEY_FACTOR;
}

/** Somme monétaire sûre (arrondie une seule fois, à la fin). */
export function addMoney(...values: Array<number | null | undefined>): number {
  let total = 0;
  for (const value of values) total += toFinite(value);
  return roundMoney(total);
}

/** Somme monétaire d'un tableau (évite le spread sur de grands tableaux). */
export function sumMoney(values: Array<number | null | undefined>): number {
  let total = 0;
  for (const value of values) total += toFinite(value);
  return roundMoney(total);
}

/** Différence monétaire `a - b` (arrondie). */
export function subtractMoney(a: number | null | undefined, b: number | null | undefined): number {
  return roundMoney(toFinite(a) - toFinite(b));
}

/** Multiplication monétaire (quantité × prix, etc.), arrondie. */
export function multiplyMoney(value: number | null | undefined, factor: number | null | undefined): number {
  return roundMoney(toFinite(value) * toFinite(factor));
}

/** Contraint une valeur dans un intervalle [min, max] (bornes incluses). */
export function clampMoney(value: number, min: number, max: number): number {
  const v = toFinite(value);
  return Math.min(Math.max(v, min), max);
}

/** Montant de remise pour un pourcentage appliqué à une base (0–100 %). */
export function calculateDiscount(baseAmount: number, discountPercent: number): number {
  const percent = clampMoney(discountPercent, 0, 100);
  return roundMoney(toFinite(baseAmount) * (percent / 100));
}

/** Montant de TVA pour un taux appliqué à une base hors taxe. */
export function calculateTax(exclTax: number, vatRate: number): number {
  return roundMoney(toFinite(exclTax) * (toFinite(vatRate) / 100));
}

/** Total TTC à partir du HT et de la TVA (ou du taux). */
export function calculateTotal(exclTax: number, taxOrRate: number, isRate = false): number {
  const tax = isRate ? calculateTax(exclTax, taxOrRate) : roundMoney(taxOrRate);
  return addMoney(exclTax, tax);
}

/**
 * Reste à payer = total dû − déjà payé.
 *
 * Renvoie `0` si l'entrée est incohérente (payé > dû) : le résidu affiché ne
 * doit JAMAIS être négatif (un trop-perçu relève d'un modèle de crédit client,
 * pas d'un « reste dû » négatif).
 */
export function calculateRemaining(totalDue: number, amountPaid: number): number {
  const remaining = toFinite(totalDue) - toFinite(amountPaid);
  return remaining > 0 ? roundMoney(remaining) : 0;
}

/**
 * Marge (brute) = (prix de vente − prix d'achat) × quantité.
 * Positif = marge, négatif = vente à perte (conservé tel quel, c'est un signal).
 */
export function calculateMargin(sellingPrice: number, purchasePrice: number, quantity = 1): number {
  return roundMoney((toFinite(sellingPrice) - toFinite(purchasePrice)) * toFinite(quantity));
}

/** Marge exprimée en pourcentage du prix de vente (0 si prix de vente nul). */
export function calculateMarginRate(sellingPrice: number, purchasePrice: number): number {
  const price = toFinite(sellingPrice);
  if (price <= 0) return 0;
  return Math.round(((price - toFinite(purchasePrice)) / price) * 10000) / 100;
}

/** `true` si la valeur est nulle à un centime près. */
export function isZeroMoney(value: number, tolerance = MONEY_EPSILON): boolean {
  return Math.abs(toFinite(value)) < tolerance;
}

/** `true` si `a` et `b` sont égaux à un centime près. */
export function moneyEquals(a: number, b: number, tolerance = MONEY_EPSILON): boolean {
  return Math.abs(toFinite(a) - toFinite(b)) < tolerance;
}

/**
 * Amounts d'une ligne de document : HT, TVA, TTC.
 *
 * Calcul IDENTIQUE à la facturation historique (base = quantité × prix ×
 * (1 − remise/100), puis arrondi, puis TVA sur la base HT) : les montants
 * existants ne bougent pas.
 */
export interface LineAmountsInput {
  quantity: number;
  unitPrice: number;
  discountPct?: number;
  vatRate?: number;
}

export interface LineAmounts {
  /** Total hors taxe de la ligne (remise déduite). */
  exclTax: number;
  /** Montant de TVA de la ligne. */
  tax: number;
  /** Total toutes taxes comprises de la ligne. */
  inclTax: number;
  /** Montant de la remise (partie informationnelle). */
  discount: number;
}

export function calculateLineAmounts(input: LineAmountsInput): LineAmounts {
  const quantity = toFinite(input.quantity);
  const unitPrice = toFinite(input.unitPrice);
  const discountPct = clampMoney(input.discountPct ?? 0, 0, 100);
  const vatRate = toFinite(input.vatRate);

  const gross = quantity * unitPrice;
  const base = gross * (1 - discountPct / 100);
  const exclTax = roundMoney(base);
  const tax = roundMoney(base * (vatRate / 100));

  return {
    exclTax,
    tax,
    inclTax: addMoney(exclTax, tax),
    discount: roundMoney(gross * (discountPct / 100)),
  };
}

/** Formate un montant pour l'affichage (« 1 234.50 »), sans suffixe devise. */
export function formatMoney(value: number | null | undefined): string {
  return roundMoney(value).toFixed(MONEY_DECIMALS);
}
