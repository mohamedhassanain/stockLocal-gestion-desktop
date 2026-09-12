/**
 * ─── Moteur d'échéance / crédit ────────────────────────────────────────────────
 *
 * Source de vérité UNIQUE pour l'état d'un crédit client/fournisseur.
 * Aucune page React ne doit recalculer « en retard / payée / reste dû » :
 * tous appellent `evaluateCredit`.
 *
 *   repository (SQL) ──► evaluateCredit() ──► UI (badge, couleur, libellé)
 *
 * Règles :
 *   reste = total dû − total payé            (jamais négatif, cf. money.ts)
 *   reste <= 0                                → PAYE
 *   reste  > 0 et échéance dans le futur      → A_VENIR
 *   reste  > 0 et échéance aujourd'hui        → A_ECHEANCE
 *   reste  > 0 et échéance passée             → EN_RETARD
 *   reste  > 0 et pas d'échéance              → A_VENIR (crédit ouvert)
 * ───────────────────────────────────────────────────────────────────────────────
 */

import { calculateRemaining, isZeroMoney } from '../../utils/money';
import { compareDateOnly, daysBetweenDateOnly, todayDateOnly, type DateOnly } from '../../utils/date';

/** Statut dérivé d'un crédit (un seul vocabulaire pour toute l'application). */
export type CreditStatus = 'PAYE' | 'A_VENIR' | 'A_ECHEANCE' | 'EN_RETARD';

/** Libellés français affichables (réutilisés partout : tableaux, badges, PDF). */
export const CREDIT_STATUS_LABELS: Record<CreditStatus, string> = {
  PAYE: 'Payée',
  A_VENIR: 'À venir',
  A_ECHEANCE: 'À échéance',
  EN_RETARD: 'En retard',
};

/** Évaluation complète et immuable d'un crédit. */
export interface CreditEvaluation {
  /** Reste à payer (>= 0). */
  remaining: number;
  /** Statut dérivé. */
  status: CreditStatus;
  /** Libellé français prêt à afficher. */
  label: string;
  /** Jours avant l'échéance (négatif = dépassée). `null` si pas d'échéance. */
  daysUntilDue: number | null;
  /** `true` dès que l'échéance est dépassée et qu'il reste un solde. */
  isOverdue: boolean;
  /** `true` si le document est soldé. */
  isPaid: boolean;
}

export interface CreditInput {
  /** Montant total dû (TTC net d'avoirs). */
  totalDue: number;
  /** Montant déjà encaissé / payé. */
  amountPaid: number;
  /** Date d'échéance « date seule » (`YYYY-MM-DD`). */
  dueDate?: DateOnly | null;
  /** Date de référence (défaut : aujourd'hui local). Injectable pour les tests. */
  referenceDate?: DateOnly | null;
}

/**
 * Calcule l'état complet d'un crédit. Fonction PURE : aucune I/O, testable
 * en isolation, identique côté UI et côté service.
 */
export function evaluateCredit(input: CreditInput): CreditEvaluation {
  const remaining = calculateRemaining(input.totalDue, input.amountPaid);
  const reference = input.referenceDate ?? todayDateOnly();

  if (isZeroMoney(remaining) || remaining <= 0) {
    return {
      remaining: 0,
      status: 'PAYE',
      label: CREDIT_STATUS_LABELS.PAYE,
      daysUntilDue: input.dueDate ? daysBetweenDateOnly(reference, input.dueDate) : null,
      isOverdue: false,
      isPaid: true,
    };
  }

  const daysUntilDue = input.dueDate ? daysBetweenDateOnly(reference, input.dueDate) : null;

  // Pas d'échéance connue → crédit ouvert, considéré « à venir ».
  if (daysUntilDue === null) {
    return {
      remaining,
      status: 'A_VENIR',
      label: CREDIT_STATUS_LABELS.A_VENIR,
      daysUntilDue: null,
      isOverdue: false,
      isPaid: false,
    };
  }

  if (daysUntilDue < 0) {
    return {
      remaining,
      status: 'EN_RETARD',
      label: CREDIT_STATUS_LABELS.EN_RETARD,
      daysUntilDue,
      isOverdue: true,
      isPaid: false,
    };
  }

  if (daysUntilDue === 0) {
    return {
      remaining,
      status: 'A_ECHEANCE',
      label: CREDIT_STATUS_LABELS.A_ECHEANCE,
      daysUntilDue: 0,
      isOverdue: false,
      isPaid: false,
    };
  }

  return {
    remaining,
    status: 'A_VENIR',
    label: CREDIT_STATUS_LABELS.A_VENIR,
    daysUntilDue,
    isOverdue: false,
    isPaid: false,
  };
}

/**
 * Une échéance est valide si elle n'est PAS antérieure à la date de facture.
 * Règle par défaut du cahier des charges : `due_date >= invoice_date`.
 */
export function isValidDueDate(invoiceDate: DateOnly | null | undefined, dueDate: DateOnly | null | undefined): boolean {
  if (!dueDate) return true; // pas d'échéance = pas de contrainte
  if (!invoiceDate) return true; // facture sans date : on ne bloque pas
  return compareDateOnly(dueDate, invoiceDate) >= 0;
}

/** Message d'erreur français standard quand l'échéance précède la facture. */
export const DUE_DATE_BEFORE_INVOICE_MESSAGE =
  "La date d'échéance ne peut pas être antérieure à la date de facture.";
