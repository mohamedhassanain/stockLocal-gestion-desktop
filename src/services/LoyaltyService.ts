import { runInTransaction } from '../database/config/connection';
import { ClientRepository } from '../repositories/ClientRepository';
import { GlobalSettingsService } from './GlobalSettingsService';
import { roundMoney } from '../utils/money';

/**
 * §Programme de fidélité (points).
 *
 * RÈGLES (toutes pilotées par les paramètres, jamais codées en dur) :
 *   - GAIN : chaque facture crédite `floor(TTC / loyalty_mad_per_point)` points
 *     au client. `loyalty_mad_per_point = 0` → programme DÉSACTIVÉ (aucun point).
 *   - VALEUR : 1 point vaut `loyalty_point_value_mad` MAD au moment de l'échange.
 *   - ÉCHANGE : les points sont convertis en un VRAI crédit client
 *     (`client_credits` type PAYMENT), c'est-à-dire une réduction de ce que le
 *     client doit — exactement comme un règlement. Aucun calcul de vente, de
 *     TVA ou de stock n'est touché : le moteur commercial reste inchangé.
 *
 * INVARIANTS :
 *   - Le solde de points ne peut JAMAIS devenir négatif (garde côté SQL).
 *   - L'échange est ATOMIQUE (débit des points + écriture du crédit dans une
 *     seule transaction) : jamais de points perdus sans contrepartie, ni de
 *     crédit accordé sans débit.
 *   - Un client inconnu (vente comptoir, `entity_id` vide) est simplement ignoré.
 */

export interface LoyaltySettings {
  /** 1 point par N MAD dépensés (0 = programme désactivé). */
  mad_per_point: number;
  /** Valeur en MAD d'un point échangé. */
  point_value_mad: number;
}

function currentSettings(): LoyaltySettings {
  const settings = GlobalSettingsService.getAll();
  return {
    mad_per_point: Number(settings.loyalty_mad_per_point ?? 0),
    point_value_mad: Number(settings.loyalty_point_value_mad ?? 0),
  };
}

/** Le programme est-il actif (taux de gain configuré) ? */
function isEnabled(): boolean {
  const { mad_per_point } = currentSettings();
  return Number.isFinite(mad_per_point) && mad_per_point > 0;
}

/**
 * Points gagnés pour un montant TTC. Arrondi VERS LE BAS : on ne crédite jamais
 * un point non entièrement mérité. 0 si le programme est désactivé.
 */
function pointsForAmount(amountInclTax: number): number {
  const { mad_per_point } = currentSettings();
  const amount = Number(amountInclTax);
  if (!Number.isFinite(mad_per_point) || mad_per_point <= 0) return 0;
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.floor(amount / mad_per_point);
}

/** Valeur en MAD d'un nombre de points (0 si la valeur n'est pas configurée). */
function valueOfPoints(points: number): number {
  const { point_value_mad } = currentSettings();
  const count = Math.floor(Number(points));
  if (!Number.isFinite(count) || count <= 0) return 0;
  if (!Number.isFinite(point_value_mad) || point_value_mad <= 0) return 0;
  return roundMoney(count * point_value_mad);
}

/**
 * Crédite les points d'une facture. `entity_id` vide ou inconnu → aucun point
 * (vente comptoir). Retourne le nombre de points crédités (0 si rien).
 *
 * Ne lève JAMAIS : un échec du programme de fidélité ne doit pas empêcher une
 * vente d'être enregistrée.
 */
function awardForInvoice(customerId: string | null | undefined, totalInclTax: number): number {
  try {
    if (!customerId) return 0;
    const points = pointsForAmount(totalInclTax);
    if (points <= 0) return 0;
    if (!ClientRepository.getById(customerId)) return 0;
    ClientRepository.addLoyaltyPoints(customerId, points);
    return points;
  } catch (error) {
    console.warn('[Fidélité] Attribution des points ignorée :', error);
    return 0;
  }
}

/**
 * Échange des points contre un crédit client.
 * Lève une erreur explicite (message affichable tel quel) si le solde est
 * insuffisant, si la valeur du point n'est pas configurée, ou si le client
 * n'existe pas.
 */
function redeemPoints(customerId: string, points: number): { value: number; remaining: number } {
  const count = Math.floor(Number(points));
  if (!Number.isFinite(count) || count <= 0) {
    throw new Error('Le nombre de points à échanger doit être supérieur à 0.');
  }

  const customer = ClientRepository.getById(customerId);
  if (!customer) throw new Error('Client introuvable.');

  const value = valueOfPoints(count);
  if (value <= 0) {
    throw new Error("La valeur d'un point fidélité n'est pas configurée (Paramètres → Fidélité).");
  }

  return runInTransaction(() => {
    // Le débit valide lui-même le solde (garde SQL) : refuse si insuffisant.
    const remaining = ClientRepository.redeemLoyaltyPoints(customerId, count);
    ClientRepository.addCredit({
      customer_id: customerId,
      type: 'PAYMENT',
      amount: value,
      description: `Fidélité — échange de ${count} point(s)`,
    });
    return { value, remaining };
  });
}

export const LoyaltyService = {
  isEnabled,
  pointsForAmount,
  valueOfPoints,
  awardForInvoice,
  redeemPoints,
};
