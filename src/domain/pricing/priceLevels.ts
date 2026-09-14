import { roundMoney } from '../../utils/money';

/**
 * ─── §B3 — Niveaux de prix (tarification par client) — module PUR ────────────
 *
 * Aucune I/O, aucune base de données : uniquement des règles, testables
 * isolément (même approche que `domain/tax/vatRates.ts` et `utils/money.ts`).
 *
 * Un client possède un NIVEAU DE PRIX (`customers.price_level`). Un produit peut
 * définir un prix EXPLICITE par niveau (`product_price_levels`), et un client
 * peut avoir un prix NÉGOCIÉ pour un produit précis (`customer_prices`).
 *
 * ─── ORDRE DE RÉSOLUTION (PRIORITÉ DÉCROISSANTE) ────────────────────────────
 *   1. PRIX SPÉCIFIQUE CLIENT  (customer_prices)      — priorité maximale
 *   2. PRIX DU NIVEAU DU CLIENT (product_price_levels)
 *   3. REMISE QUANTITÉ          (volume_discounts, appliquée au prix standard)
 *   4. PRIX STANDARD            (products.selling_price)
 *
 * Une remise quantité ne s'applique JAMAIS par-dessus un prix spécifique client
 * ou un prix de niveau : ces prix sont négociés et priment sur toute règle
 * générique. L'appelant reçoit toujours le MOTIF exact de la résolution pour
 * l'afficher à l'utilisateur (aucun prix imposé silencieusement).
 */

/** Un niveau de prix du catalogue (clé stable + libellé d'affichage). */
export interface PriceLevel {
  key: string;
  label: string;
}

/** Niveaux de prix par défaut. Les clés sont STABLES (persistées en base). */
export const PRICE_LEVELS: readonly PriceLevel[] = [
  { key: 'RETAIL', label: 'Détail' },
  { key: 'WHOLESALE', label: 'Grossiste' },
  { key: 'VIP', label: 'VIP' },
] as const;

/** Niveau appliqué par défaut quand aucun n'est défini (comportement historique). */
export const DEFAULT_PRICE_LEVEL = 'RETAIL';

/** Bornes de sécurité pour une clé de niveau (partagées UI/validation). */
export const PRICE_LEVEL_KEY_MAX_LENGTH = 40;

/** `true` si la clé correspond à un niveau connu du catalogue. */
export function isKnownPriceLevel(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const key = value.trim().toUpperCase();
  return PRICE_LEVELS.some(l => l.key === key);
}

/**
 * Normalise une clé de niveau :
 *   - chaîne non vide → MAJUSCULES (clé stable), bornée en longueur ;
 *   - valeur absente/invalide → niveau par défaut (jamais de crash, jamais de
 *     niveau vide qui rendrait toute résolution impossible).
 */
export function normalizePriceLevel(value: unknown): string {
  if (typeof value === 'string') {
    const key = value.trim().toUpperCase().slice(0, PRICE_LEVEL_KEY_MAX_LENGTH);
    if (key) return key;
  }
  return DEFAULT_PRICE_LEVEL;
}

/** Libellé affichable d'un niveau (retombe sur la clé brute si inconnu). */
export function describePriceLevel(key: unknown): string {
  const normalized = normalizePriceLevel(key);
  return PRICE_LEVELS.find(l => l.key === normalized)?.label ?? normalized;
}

/** Origine d'un prix résolu (affichée à l'utilisateur). */
export type PriceSource = 'CUSTOMER' | 'LEVEL' | 'VOLUME' | 'STANDARD';

/** Entrée de la résolution de prix (toutes les sources possibles, optionnelles). */
export interface PriceResolutionInput {
  /** Prix de vente standard du produit (`products.selling_price`). */
  standardPrice: number;
  /** Prix négocié pour CE client et CE produit (`customer_prices`), si défini. */
  customerPrice?: number | null;
  /** Prix du NIVEAU du client pour ce produit (`product_price_levels`), si défini. */
  levelPrice?: number | null;
  /** Niveau de prix du client (pour le libellé du motif). */
  level?: string | null;
  /** Pourcentage de remise quantité applicable (0 si aucune). */
  volumeDiscountPct?: number | null;
}

/** Résultat de la résolution : prix, remise, origine et motif affichable. */
export interface PriceResolution {
  /** Prix unitaire retenu (hors remise quantité éventuelle). */
  unitPrice: number;
  /** Remise (%) à appliquer sur `unitPrice` (0 sauf source VOLUME). */
  discountPct: number;
  /** Source du prix retenu. */
  source: PriceSource;
  /** Motif en français, prêt à afficher (« Prix spécifique client », …). */
  reason: string;
}

/** `true` si la valeur est un prix utilisable (nombre fini ≥ 0). */
function isUsablePrice(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Résout le prix unitaire d'un produit pour un client donné.
 * Fonction PURE : aucun accès base, aucun effet de bord.
 */
export function resolvePrice(input: PriceResolutionInput): PriceResolution {
  const standardPrice = roundMoney(Number.isFinite(input.standardPrice) ? input.standardPrice : 0);

  // 1. Prix spécifique client — priorité maximale.
  if (isUsablePrice(input.customerPrice)) {
    return {
      unitPrice: roundMoney(input.customerPrice),
      discountPct: 0,
      source: 'CUSTOMER',
      reason: 'Prix spécifique client',
    };
  }

  // 2. Prix du niveau de prix du client.
  if (isUsablePrice(input.levelPrice)) {
    const label = describePriceLevel(input.level);
    return {
      unitPrice: roundMoney(input.levelPrice),
      discountPct: 0,
      source: 'LEVEL',
      reason: `Prix niveau ${label}`,
    };
  }

  // 3. Remise quantité appliquée au prix standard.
  const volumePct = Number.isFinite(input.volumeDiscountPct)
    ? Math.max(0, Math.min(100, Number(input.volumeDiscountPct)))
    : 0;
  if (volumePct > 0) {
    return {
      unitPrice: standardPrice,
      discountPct: volumePct,
      source: 'VOLUME',
      reason: `Remise quantité : -${volumePct}%`,
    };
  }

  // 4. Prix de vente standard.
  return {
    unitPrice: standardPrice,
    discountPct: 0,
    source: 'STANDARD',
    reason: 'Prix standard',
  };
}
