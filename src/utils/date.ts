/**
 * Retourne la date LOCALE au format YYYY-MM-DD (sans décalage timezone).
 *
 * Pourquoi : `new Date().toISOString().split('T')[0]` renvoie la date en **UTC**.
 * Dans un fuseau à offset positif (ex. Maroc UTC+1), entre minuit et 01h00
 * locales, cela produit la **veille** → une facture créée à 00h30 locale
 * serait datée du jour précédent (off-by-one).
 *
 * Cette fonction utilise les composantes LOCALES de la date, donc la valeur
 * correspond toujours à la date affichée par l'horloge de l'utilisateur.
 */
export function toLocalDateString(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
/**
 * ─── Sécurité des dates « date seule » ─────────────────────────────────────────
 *
 * Bug corrigé : `new Date().toISOString().split('T')[0]` renvoie la date en UTC.
 * Dans un fuseau à offset positif (Maroc UTC+1), entre minuit et 01h00 locales,
 * cela produit la VEILLE. Idem pour `new Date('YYYY-MM-DD').toISOString()` qui
 * peut décaler d'un jour selon la machine.
 *
 * Règle : une valeur métier « date seule » (date de facture, échéance, date
 * d'inventaire, date de naissance…) est un CALENDRIER, pas un instant. Elle est
 * stockée et comparée comme une chaîne `YYYY-MM-DD` (comparable lexicographi-
 * quement) et n'est JAMAIS reconvertie via UTC pour l'affichage ou le calcul.
 * ───────────────────────────────────────────────────────────────────────────────
 */

/** Date seule au format `YYYY-MM-DD` (type nominal documentaire). */
export type DateOnly = string;

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Convertit une valeur (Date ou chaîne ISO / date seule) en `YYYY-MM-DD` LOCAL.
 *
 * - Chaîne `YYYY-MM-DD...` : on garde les 10 premiers caractères tels quels
 *   (aucune conversion de fuseau appliquée — c'est déjà une date calendaire).
 * - Objet `Date` : composantes LOCALES (jamais toISOString).
 * - Valeur invalide / vide : `null`.
 */
export function toDateOnly(value: Date | string | null | undefined): DateOnly | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const match = DATE_ONLY_PATTERN.exec(trimmed);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return null;
    return toLocalDateString(parsed);
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return toLocalDateString(value);
  }
  return null;
}

/**
 * Construit un `Date` à MINUIT LOCAL à partir d'une date seule `YYYY-MM-DD`.
 * Renvoie `null` si la chaîne est invalide. À utiliser pour l'affichage (formats
 * localisés, jours de la semaine) : jamais `new Date('YYYY-MM-DD')` qui est UTC.
 */
export function parseDateOnly(value: DateOnly | null | undefined): Date | null {
  const normalized = toDateOnly(value);
  if (!normalized) return null;
  const [yyyy, mm, dd] = normalized.split('-').map(Number);
  const date = new Date(yyyy, mm - 1, dd);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Date seule d'aujourd'hui (heure locale). */
export function todayDateOnly(): DateOnly {
  return toLocalDateString();
}

/** Compare deux dates seules : <0 si a<b, 0 si égales, >0 si a>b. */
export function compareDateOnly(a: DateOnly | null | undefined, b: DateOnly | null | undefined): number {
  const na = toDateOnly(a);
  const nb = toDateOnly(b);
  if (na === null && nb === null) return 0;
  if (na === null) return -1;
  if (nb === null) return 1;
  if (na === nb) return 0;
  return na < nb ? -1 : 1;
}

/**
 * Nombre de jours calendaires entre deux dates seules (`b - a`).
 * Calcul robuste au passage d'heure d'été (base : nombre de jours entiers).
 */
export function daysBetweenDateOnly(a: DateOnly | null | undefined, b: DateOnly | null | undefined): number | null {
  const da = parseDateOnly(a);
  const db = parseDateOnly(b);
  if (!da || !db) return null;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  // On supprime les heures : différence de minuits locaux.
  const utcA = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate());
  const utcB = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate());
  return Math.round((utcB - utcA) / MS_PER_DAY);
}

/**
 * Ajoute (ou retire, si négatif) un nombre de jours à une date seule.
 * Renvoie `null` si l'entrée est invalide.
 */
export function addDaysDateOnly(value: DateOnly | null | undefined, days: number): DateOnly | null {
  const base = parseDateOnly(value);
  if (!base || !Number.isFinite(days)) return null;
  base.setDate(base.getDate() + Math.trunc(days));
  return toLocalDateString(base);
}

/**
 * Formate une date seule pour l'affichage humain (ex. « 15/09/2026 »).
 * La chaîne est interprétée comme un CALENDRIER (jamais décalée par le fuseau).
 */
export function formatDateOnly(value: DateOnly | null | undefined): string {
  const date = parseDateOnly(value);
  if (!date) return '—';
  // Format fixe dd/MM/yyyy : aucune dépendance au moteur/navigateur, aucune
  // reconversion UTC (la chaîne est lue comme un calendrier).
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/** `true` si `value` est une date seule valide `YYYY-MM-DD`. */
export function isDateOnly(value: string | null | undefined): boolean {
  if (typeof value !== 'string') return false;
  const normalized = toDateOnly(value);
  if (!normalized) return false;
  const [yyyy, mm, dd] = normalized.split('-').map(Number);
  const probe = new Date(yyyy, mm - 1, dd);
  return probe.getFullYear() === yyyy && probe.getMonth() === mm - 1 && probe.getDate() === dd;
}
