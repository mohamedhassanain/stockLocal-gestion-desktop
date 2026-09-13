/**
 * ─── Catalogue des taux de TVA (Maroc) — module PUR ────────────────────────────
 *
 * Source de vérité UNIQUE des taux de TVA manipulables par l'application.
 * Aucune I/O, aucune base de données : uniquement des règles, testables
 * isolément (même approche que `utils/money.ts` et `domain/credit`).
 *
 * Taux légaux marocains :
 *   0  %  → exonéré (produits exonérés, export…)
 *   7  %  → taux réduit (produits de large consommation)
 *   10 %  → taux intermédiaire (opérations bancaires, restauration…)
 *   14 %  → taux intermédiaire (transport, fourniture d'eau/électricité…)
 *   20 %  → taux normal (cas général)
 *
 * L'utilisateur peut en outre définir ses propres taux dans Paramètres :
 * ce module ne fait que VALIDER et NORMALISER les valeurs ; leur persistance
 * appartient à `GlobalSettingsService` (`vat_rates`).
 *
 * RÈGLE : un taux est toujours un pourcentage borné [0, 100] à 2 décimales.
 * Toute valeur non finie, négative ou > 100 est refusée (jamais silencieusement
 * convertie en 0 : une TVA fausse est une erreur comptable, pas un détail d'UI).
 */

/** Un taux de TVA avec son libellé d'affichage. */
export interface VatRate {
  /** Taux en pourcentage (0 = exonéré). */
  rate: number;
  /** Libellé français prêt à afficher (ex. « 20 % — normal »). */
  label: string;
  /** Libellé court (« 20 % », « Exonéré »). */
  shortLabel: string;
  /** `true` pour un taux légal marocain (non supprimable par l'utilisateur). */
  isPreset: boolean;
}

/** Taux légaux marocains, dans l'ordre d'affichage attendu par les utilisateurs. */
export const VAT_PRESET_RATES: readonly number[] = [0, 7, 10, 14, 20] as const;

/** Taux normal (cas général au Maroc) — utilisé comme dernier repli. */
export const DEFAULT_VAT_RATE = 20;

/** Nombre de décimales acceptées pour un taux (0,5 % doit rester possible). */
const RATE_DECIMALS = 2;
const RATE_FACTOR = 10 ** RATE_DECIMALS;

/** Libellés des taux légaux (le 0 est « exonéré », pas « 0 % »). */
const PRESET_LABELS: Record<number, { label: string; short: string }> = {
  0: { label: '0 % — Exonéré', short: 'Exonéré' },
  7: { label: '7 % — Taux réduit', short: '7 %' },
  10: { label: '10 % — Taux intermédiaire', short: '10 %' },
  14: { label: '14 % — Taux intermédiaire', short: '14 %' },
  20: { label: '20 % — Taux normal', short: '20 %' },
};

/** Arrondit un taux à 2 décimales (0,5 % reste exact). */
export function roundVatRate(rate: number): number {
  return Math.round((rate + Number.EPSILON) * RATE_FACTOR) / RATE_FACTOR;
}

/**
 * Valide et normalise un taux de TVA.
 * @throws Error (message affichable tel quel) si le taux est invalide.
 */
export function parseVatRate(value: unknown): number {
  const rate = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(rate)) {
    throw new Error('Taux de TVA invalide : une valeur numérique est attendue.');
  }
  if (rate < 0) {
    throw new Error('Taux de TVA invalide : un taux ne peut pas être négatif.');
  }
  if (rate > 100) {
    throw new Error('Taux de TVA invalide : un taux ne peut pas dépasser 100 %.');
  }
  return roundVatRate(rate);
}

/** `true` si le taux est un taux légal marocain (0, 7, 10, 14 ou 20). */
export function isPresetVatRate(rate: number): boolean {
  const rounded = roundVatRate(rate);
  return VAT_PRESET_RATES.includes(rounded);
}

/** Construit la description affichable d'un taux (personnalisé si hors presets). */
export function describeVatRate(rate: number): VatRate {
  const normalized = roundVatRate(rate);
  const preset = PRESET_LABELS[normalized];
  if (preset) {
    return { rate: normalized, label: preset.label, shortLabel: preset.short, isPreset: true };
  }
  const short = formatVatRate(normalized);
  return {
    rate: normalized,
    label: `${short} — Taux personnalisé`,
    shortLabel: short,
    isPreset: false,
  };
}

/** Formate un taux pour l'affichage : « Exonéré », « 7 % », « 5,5 % ». */
export function formatVatRate(rate: number): string {
  const normalized = roundVatRate(rate);
  if (normalized === 0) return 'Exonéré';
  // Séparateur décimal français (virgule) — sans zéros inutiles (20 % et non 20,00 %).
  return `${String(normalized).replace('.', ',')} %`;
}

/**
 * Normalise une liste de taux fournie par l'utilisateur (Paramètres) :
 *   - supprime les doublons (comparaison sur le taux arrondi),
 *   - ignore les entrées invalides (jamais d'exception ici : une saisie
 *     partiellement erronée ne doit pas empêcher d'enregistrer le reste),
 *   - trie par taux croissant,
 *   - CONSERVE les taux légaux (ils ne sont jamais perdus).
 */
export function normalizeVatRates(values: unknown): number[] {
  const rates = new Set<number>(VAT_PRESET_RATES);
  if (Array.isArray(values)) {
    for (const value of values) {
      const rate = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) continue;
      rates.add(roundVatRate(rate));
    }
  }
  return [...rates].sort((a, b) => a - b);
}

/**
 * Lit la liste des taux enregistrée (JSON) en retombant sur les presets si la
 * valeur est absente ou illisible — jamais de liste vide (l'UI aurait un menu
 * de TVA vide et l'utilisateur ne pourrait plus créer de produit).
 */
export function parseVatRates(raw: string | null | undefined): number[] {
  if (!raw) return [...VAT_PRESET_RATES];
  try {
    return normalizeVatRates(JSON.parse(raw));
  } catch {
    return [...VAT_PRESET_RATES];
  }
}

/** Catalogue complet (taux légaux + personnalisés) prêt pour l'UI. */
export function buildVatRateCatalog(customRates?: unknown): VatRate[] {
  return normalizeVatRates(customRates).map(describeVatRate);
}
