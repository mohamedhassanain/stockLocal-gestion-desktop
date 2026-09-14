import { roundMoney } from '../../utils/money';

/**
 * ─── §B4 — Commission des vendeurs — module PUR ─────────────────────────────
 *
 * Aucune I/O : uniquement la règle de calcul, testable isolément.
 *
 * ⚠️  Un VENDEUR est une FICHE (nom, téléphone, taux, actif). Ce n'est PAS un
 *     compte utilisateur : aucun mot de passe, aucune authentification.
 *
 * Règle : commission = chiffre d'affaires × taux de commission / 100,
 * arrondie à la précision monétaire (2 décimales, arrondi standard).
 * Un taux négatif ou non fini est ramené à 0 (jamais de commission négative).
 */

/** Bornes de sécurité partagées (UI / validation / service). */
export const COMMISSION_RATE_MIN = 0;
export const COMMISSION_RATE_MAX = 100;
export const SELLER_NAME_MAX_LENGTH = 200;

/** Ramène un taux au domaine valide [0, 100] (0 si non fini). */
export function normalizeCommissionRate(value: unknown): number {
  const rate = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(rate)) return 0;
  return Math.min(COMMISSION_RATE_MAX, Math.max(COMMISSION_RATE_MIN, rate));
}

/**
 * Calcule la commission due pour un chiffre d'affaires et un taux.
 * @param revenue chiffre d'affaires (MAD, TTC par convention d'affichage).
 * @param rate    taux de commission en pourcentage (0–100).
 */
export function calculateCommission(revenue: number, rate: number): number {
  const ca = Number.isFinite(revenue) ? revenue : 0;
  const pct = normalizeCommissionRate(rate);
  if (pct === 0 || ca === 0) return 0;
  return roundMoney(ca * (pct / 100));
}
