import { DashboardRepository } from '../repositories/DashboardRepository';
import { ExpenseRepository } from '../repositories/ExpenseRepository';
import { roundMoney, subtractMoney } from '../utils/money';

/**
 * §Phase 12 — Marge brute et résultat estimé.
 *
 * DISTINCTION EXPLICITE (ne jamais appeler cela « bénéfice net ») :
 *
 *   Marge brute      = CA hors taxes − coût des marchandises vendues
 *   Résultat estimé  = marge brute − dépenses d'exploitation
 *
 * Le résultat est qualifié d'ESTIMÉ car l'application ne tient pas de
 * comptabilité complète (pas d'amortissements, pas de charges non saisies).
 * Cette logique vit ici, en un seul endroit : aucune page ne la recalcule.
 */

export interface ProfitSummary {
  from: string;
  to: string;
  /** CA TTC encaissable sur la période (factures − avoirs). */
  revenueInclTax: number;
  /** CA hors taxes — base de calcul de la marge. */
  revenueExclTax: number;
  /** Coût d'achat estimé des marchandises vendues (net des retours). */
  costOfGoods: number;
  /** CA HT − coût des marchandises. */
  grossMargin: number;
  /** Dépenses d'exploitation enregistrées sur la période. */
  expenses: number;
  /** Marge brute − dépenses. Estimé, jamais présenté comme un bénéfice net. */
  estimatedResult: number;
  /** Taux de marge brute (marge / CA HT), en pourcentage. */
  marginRate: number;
  salesCount: number;
}

export const ProfitService = {
  /**
   * Synthèse financière sur un intervalle de dates (bornes incluses).
   * @throws si l'intervalle est vide.
   */
  getSummary(from: string, to: string): ProfitSummary {
    if (!from || !to) throw new Error('Intervalle de dates incomplet.');

    const revenue = DashboardRepository.getRevenueAndCost(from, to);
    const expenses = ExpenseRepository.getTotalInRange(from, to);

    const grossMargin = roundMoney(subtractMoney(revenue.revenueExclTax, revenue.costOfGoods));
    const estimatedResult = roundMoney(subtractMoney(grossMargin, expenses));
    const marginRate = revenue.revenueExclTax > 0
      ? roundMoney((grossMargin / revenue.revenueExclTax) * 100)
      : 0;

    return {
      from,
      to,
      revenueInclTax: roundMoney(revenue.revenueInclTax),
      revenueExclTax: roundMoney(revenue.revenueExclTax),
      costOfGoods: roundMoney(revenue.costOfGoods),
      grossMargin,
      expenses: roundMoney(expenses),
      estimatedResult,
      marginRate,
      salesCount: revenue.salesCount,
    };
  },
};
