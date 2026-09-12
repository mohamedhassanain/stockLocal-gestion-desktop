/**
 * Catégories de dépenses DÉFINIES PAR L'UTILISATEUR.
 *
 * La liste réellement proposée dans « Dépenses → Nouvelle dépense → Catégorie »
 * provient du réglage `global_settings.expense_categories` (JSON, tableau de
 * chaînes). Un défaut reprend l'ancienne liste figée pour ne rien casser.
 */

/** Bornes de sécurité partagées entre le renderer et la validation serveur. */
export const EXPENSE_CATEGORY_MAX_LENGTH = 50;
export const EXPENSE_CATEGORIES_MAX = 100;

/** Catégories proposées par défaut (comportement historique). */
export const DEFAULT_EXPENSE_CATEGORIES: readonly string[] = [
  'Transport',
  'Électricité',
  'Loyer',
  'Téléphone',
  'Carburant',
  'Salaires',
  'Autres',
];

/**
 * Normalise une liste : nettoie les espaces, retire les entrées vides et les
 * doublons (comparaison insensible à la casse). Ne force jamais de défaut.
 */
export function normalizeExpenseCategories(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw.slice(0, EXPENSE_CATEGORIES_MAX)) {
    if (typeof item !== 'string') continue;
    const label = item.trim().slice(0, EXPENSE_CATEGORY_MAX_LENGTH);
    if (!label) continue;
    const key = label.toLocaleLowerCase('fr');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

/**
 * Lit la valeur stockée (JSON) et retombe sur les catégories par défaut si la
 * valeur est absente, vide ou illisible (base ancienne ou corrompue).
 */
export function parseExpenseCategories(raw: string | null | undefined): string[] {
  if (raw === null || raw === undefined || raw === '') {
    return [...DEFAULT_EXPENSE_CATEGORIES];
  }
  try {
    const list = normalizeExpenseCategories(JSON.parse(raw));
    if (list.length > 0) return list;
  } catch {
    // Valeur non-JSON (base ancienne ou corrompue) : on ignore et on retombe
    // sur les catégories par défaut plutôt que d'afficher du texte illisible.
  }
  return [...DEFAULT_EXPENSE_CATEGORIES];
}
