/**
 * Phase 4 — Remises par quantité (`volume_discounts`).
 *
 * RÈGLE MÉTIER (documentée, non-cumul) :
 *   - Les règles de remise portent sur la QUANTITÉ (le schéma `volume_discounts`
 *     ne contient pas de `product_id` : une règle s'applique donc à tous les
 *     produits pour la tranche de quantité concernée).
 *   - Si l'utilisateur a saisi une remise MANUELLE sur la ligne, celle-ci est
 *     PRIORITAIRE : la remise quantité n'est pas cumulée (pas d'addition des %).
 *   - Sinon, la meilleure règle correspondant à la quantité (pourcentage le plus
 *     élevé parmi les paliers applicables) est appliquée automatiquement.
 *   - Aucune remise n'est jamais appliquée SILENCIEUSEMENT : l'appelant affiche
 *     le motif (« Remise quantité : -X% dès N unités »).
 */

export interface VolumeDiscountRule {
  id?: string;
  name: string;
  min_qty: number;
  max_qty?: number | null;
  discount_pct: number;
}

export type DiscountSource = 'manual' | 'volume' | 'none';

export interface ResolvedDiscount {
  pct: number;
  source: DiscountSource;
  rule: VolumeDiscountRule | null;
}

/** Meilleure règle applicable à une quantité (le % le plus élevé), ou null. */
export function findApplicableDiscount(rules: VolumeDiscountRule[], quantity: number): VolumeDiscountRule | null {
  const applicable = rules.filter(
    r => quantity >= r.min_qty && (r.max_qty == null || quantity <= r.max_qty),
  );
  if (applicable.length === 0) return null;
  return applicable.reduce((best, r) => (r.discount_pct > best.discount_pct ? r : best));
}

/** Décrit le palier appliqué pour l'afficher à l'utilisateur. */
export function describeVolumeDiscount(rule: VolumeDiscountRule): string {
  return `Remise quantité : -${rule.discount_pct}% dès ${rule.min_qty} unité(s)`;
}

/**
 * Résout la remise d'une ligne.
 *
 * @param manualDiscountPct remise saisie manuellement (null/undefined si aucune).
 *        Toute remise manuelle > 0 est prioritaire (non-cumul).
 */
export function resolveDiscount(
  rules: VolumeDiscountRule[],
  quantity: number,
  manualDiscountPct?: number | null,
): ResolvedDiscount {
  if (manualDiscountPct != null && manualDiscountPct > 0) {
    return { pct: manualDiscountPct, source: 'manual', rule: null };
  }
  const rule = findApplicableDiscount(rules, quantity);
  if (rule) return { pct: rule.discount_pct, source: 'volume', rule };
  return { pct: 0, source: 'none', rule: null };
}
