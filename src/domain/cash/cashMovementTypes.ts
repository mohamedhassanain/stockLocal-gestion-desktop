/**
 * Types de mouvement de caisse DÉFINIS PAR L'UTILISATEUR.
 *
 * Modèle : une liste de définitions `{ label, direction }` stockée en JSON dans
 * `global_settings.cash_movement_types`. Chaque définition alimente le menu
 * « Caisse → Nouveau mouvement → Type » (§Phase 10).
 *
 * - `label` est la valeur réellement enregistrée dans `cash_movements.movement_type`.
 * - `direction` (IN = entrée, OUT = sortie) détermine l'impact sur le tiroir-caisse.
 *
 * Les anciens codes internes (SALE_CASH, MANUAL_IN…) restent valides et lisibles
 * afin de ne casser ni l'historique existant ni les tests.
 */

export type CashMovementDirection = 'IN' | 'OUT';

export interface CashMovementTypeDef {
  label: string;
  direction: CashMovementDirection;
}

/** Bornes de sécurité partagées entre le renderer et la validation serveur. */
export const CASH_MOVEMENT_TYPE_LABEL_MAX = 50;
export const CASH_MOVEMENT_TYPES_MAX = 100;

/** Types proposés par défaut (reproduit le comportement historique de la caisse). */
export const DEFAULT_CASH_MOVEMENT_TYPES: readonly CashMovementTypeDef[] = [
  { label: 'Vente espèces', direction: 'IN' },
  { label: 'Encaissement', direction: 'IN' },
  { label: 'Dépense', direction: 'OUT' },
  { label: 'Retrait', direction: 'OUT' },
  { label: 'Entrée manuelle', direction: 'IN' },
  { label: 'Sortie manuelle', direction: 'OUT' },
];

/** Anciens codes internes → libellé, pour l'affichage de l'historique existant. */
export const CASH_MOVEMENT_LEGACY_LABELS: Readonly<Record<string, string>> = {
  SALE_CASH: 'Vente espèces',
  PAYMENT_IN: 'Encaissement',
  EXPENSE: 'Dépense',
  WITHDRAWAL: 'Retrait',
  MANUAL_IN: 'Entrée manuelle',
  MANUAL_OUT: 'Sortie manuelle',
};

function normalizeDirection(value: unknown): CashMovementDirection {
  return value === 'OUT' ? 'OUT' : 'IN';
}

/**
 * Nettoie une entrée brute : objet `{ label, direction }` (format courant) ou
 * chaîne héritée. Retourne `null` si l'entrée n'est pas exploitable.
 */
export function normalizeCashMovementType(raw: unknown): CashMovementTypeDef | null {
  if (typeof raw === 'string') {
    const label = raw.trim().slice(0, CASH_MOVEMENT_TYPE_LABEL_MAX);
    return label ? { label, direction: 'IN' } : null;
  }
  if (raw !== null && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    const label = typeof record.label === 'string'
      ? record.label.trim().slice(0, CASH_MOVEMENT_TYPE_LABEL_MAX)
      : '';
    if (!label) return null;
    return { label, direction: normalizeDirection(record.direction) };
  }
  return null;
}

/**
 * Normalise une liste brute : nettoie, retire les doublons (insensibles à la
 * casse) et les entrées vides. Ne force jamais de valeur par défaut.
 */
export function normalizeCashMovementTypes(raw: unknown): CashMovementTypeDef[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: CashMovementTypeDef[] = [];
  for (const item of raw.slice(0, CASH_MOVEMENT_TYPES_MAX)) {
    const def = normalizeCashMovementType(item);
    if (!def) continue;
    const key = def.label.toLocaleLowerCase('fr');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(def);
  }
  return out;
}

/**
 * Lit la valeur stockée (JSON) et retombe sur les types par défaut si la valeur
 * est absente, vide, ou illisible (base ancienne / corrompue).
 */
export function parseCashMovementTypes(raw: string | null | undefined): CashMovementTypeDef[] {
  if (raw === null || raw === undefined || raw === '') {
    return [...DEFAULT_CASH_MOVEMENT_TYPES];
  }
  try {
    const list = normalizeCashMovementTypes(JSON.parse(raw));
    return list.length > 0 ? list : [...DEFAULT_CASH_MOVEMENT_TYPES];
  } catch {
    return [...DEFAULT_CASH_MOVEMENT_TYPES];
  }
}

/** Libellé affichable pour une valeur de `movement_type` (label courant ou code hérité). */
export function cashMovementTypeLabel(movementType: string): string {
  return CASH_MOVEMENT_LEGACY_LABELS[movementType] ?? movementType;
}

/** Sens associé à un type : sens défini par l'utilisateur, ou code hérité, sinon IN. */
export function cashMovementDirection(
  types: readonly CashMovementTypeDef[],
  movementType: string,
): CashMovementDirection {
  const match = types.find(t => t.label === movementType);
  if (match) return match.direction;
  const legacy = CASH_MOVEMENT_LEGACY_LABELS[movementType];
  if (movementType === 'EXPENSE' || movementType === 'WITHDRAWAL' || movementType === 'MANUAL_OUT' || legacy === 'Dépense' || legacy === 'Retrait' || legacy === 'Sortie manuelle') {
    return 'OUT';
  }
  return 'IN';
}
