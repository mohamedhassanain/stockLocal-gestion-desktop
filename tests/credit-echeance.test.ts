import { describe, it, expect } from 'vitest';
import { evaluateCredit, isValidDueDate, DUE_DATE_BEFORE_INVOICE_MESSAGE } from '../src/domain/credit/CreditStatus';
import {
  toDateOnly,
  parseDateOnly,
  formatDateOnly,
  compareDateOnly,
  daysBetweenDateOnly,
  isDateOnly,
  todayDateOnly,
  toLocalDateString,
} from '../src/utils/date';

describe('§Phase 2 — Moteur d\'échéance / crédit', () => {
  it('facture intégralement payée → PAYE, reste 0', () => {
    const c = evaluateCredit({ totalDue: 1200, amountPaid: 1200, dueDate: '2026-09-15', referenceDate: '2026-09-01' });
    expect(c.remaining).toBe(0);
    expect(c.status).toBe('PAYE');
    expect(c.isPaid).toBe(true);
    expect(c.label).toBe('Payée');
  });

  it('paiement partiel avec échéance future → A_VENIR, reste 900', () => {
    const c = evaluateCredit({ totalDue: 1200, amountPaid: 300, dueDate: '2026-09-15', referenceDate: '2026-09-01' });
    expect(c.remaining).toBe(900);
    expect(c.status).toBe('A_VENIR');
    expect(c.daysUntilDue).toBe(14);
    expect(c.isOverdue).toBe(false);
  });

  it('échéance = aujourd\'hui → A_ECHEANCE', () => {
    const c = evaluateCredit({ totalDue: 800, amountPaid: 0, dueDate: '2026-09-08', referenceDate: '2026-09-08' });
    expect(c.status).toBe('A_ECHEANCE');
    expect(c.daysUntilDue).toBe(0);
    expect(c.label).toBe('À échéance');
  });

  it('échéance dépassée → EN_RETARD', () => {
    const c = evaluateCredit({ totalDue: 800, amountPaid: 300, dueDate: '2026-09-01', referenceDate: '2026-09-08' });
    expect(c.status).toBe('EN_RETARD');
    expect(c.daysUntilDue).toBe(-7);
    expect(c.isOverdue).toBe(true);
    expect(c.remaining).toBe(500);
  });

  it('crédit sans échéance → A_VENIR (crédit ouvert)', () => {
    const c = evaluateCredit({ totalDue: 500, amountPaid: 0, dueDate: null, referenceDate: '2026-09-08' });
    expect(c.status).toBe('A_VENIR');
    expect(c.daysUntilDue).toBeNull();
    expect(c.isOverdue).toBe(false);
  });

  it('§2.3 paiements partiels successifs : 1200 → 300 → 600 → 0', () => {
    // 300 payés
    let c = evaluateCredit({ totalDue: 1200, amountPaid: 300, dueDate: '2026-09-15', referenceDate: '2026-09-01' });
    expect(c.remaining).toBe(900);
    // +300 → 600 payés
    c = evaluateCredit({ totalDue: 1200, amountPaid: 600, dueDate: '2026-09-15', referenceDate: '2026-09-01' });
    expect(c.remaining).toBe(600);
    // +600 → 1200 payés
    c = evaluateCredit({ totalDue: 1200, amountPaid: 1200, dueDate: '2026-09-15', referenceDate: '2026-09-01' });
    expect(c.remaining).toBe(0);
    expect(c.status).toBe('PAYE');
  });

  it('§2.4 trop-perçu : le reste dû ne devient JAMAIS négatif', () => {
    const c = evaluateCredit({ totalDue: 1000, amountPaid: 1200, dueDate: '2026-09-15', referenceDate: '2026-09-01' });
    expect(c.remaining).toBe(0);
    expect(c.remaining).toBeGreaterThanOrEqual(0);
    expect(c.status).toBe('PAYE');
  });

  it('§2.5 libellés français cohérents', () => {
    expect(evaluateCredit({ totalDue: 10, amountPaid: 10 }).label).toBe('Payée');
    expect(evaluateCredit({ totalDue: 10, amountPaid: 0, dueDate: '2099-01-01' }).label).toBe('À venir');
    expect(evaluateCredit({ totalDue: 10, amountPaid: 0, dueDate: '2020-01-01', referenceDate: '2026-01-01' }).label).toBe('En retard');
  });
});

describe('§Phase 2.1 — Validation de la date d\'échéance', () => {
  it('échéance >= date de facture → valide', () => {
    expect(isValidDueDate('2026-09-12', '2026-09-12')).toBe(true);
    expect(isValidDueDate('2026-09-12', '2026-09-15')).toBe(true);
  });

  it('échéance < date de facture → invalide (exemple du cahier des charges)', () => {
    // facture = 12/09/2026, échéance = 05/09/2026 → doit être rejeté
    expect(isValidDueDate('2026-09-12', '2026-09-05')).toBe(false);
  });

  it('pas d\'échéance → toujours valide', () => {
    expect(isValidDueDate('2026-09-12', null)).toBe(true);
    expect(isValidDueDate('2026-09-12', undefined)).toBe(true);
  });

  it('message d\'erreur français défini', () => {
    expect(DUE_DATE_BEFORE_INVOICE_MESSAGE).toContain('échéance');
  });
});

describe('§Phase 2.2 — Sécurité des dates « date seule » (aucun décalage UTC)', () => {
  it('toDateOnly ne décale jamais une date calendaire', () => {
    // Cas critique : une chaîne date-only doit rester identique, quel que soit le fuseau
    expect(toDateOnly('2026-09-12')).toBe('2026-09-12');
    expect(toDateOnly('2026-01-01')).toBe('2026-01-01');
    expect(toDateOnly('2026-12-31')).toBe('2026-12-31');
    // Chaîne ISO complète → on garde la partie date (pas de conversion)
    expect(toDateOnly('2026-09-12T00:00:00.000Z')).toBe('2026-09-12');
    expect(toDateOnly('2026-09-12T23:59:59.000Z')).toBe('2026-09-12');
  });

  it('toLocalDateString(date) utilise l\'heure LOCALE (jamais UTC)', () => {
    // 1er janvier 2026 à 00h30 local (le bug historique renvoyait 2025-12-31 en UTC+)
    const midnightPlus = new Date(2026, 0, 1, 0, 30, 0);
    expect(toLocalDateString(midnightPlus)).toBe('2026-01-01');
    // 31 décembre 2025 à 23h30 local
    const lateEvening = new Date(2025, 11, 31, 23, 30, 0);
    expect(toLocalDateString(lateEvening)).toBe('2025-12-31');
  });

  it('parseDateOnly construit une date à minuit LOCAL', () => {
    const d = parseDateOnly('2026-09-12')!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8); // septembre = index 8
    expect(d.getDate()).toBe(12);
    expect(d.getHours()).toBe(0);
  });

  it('formatDateOnly affiche dd/MM/yyyy sans décalage', () => {
    expect(formatDateOnly('2026-09-15')).toBe('15/09/2026');
    expect(formatDateOnly('2026-01-01')).toBe('01/01/2026');
    expect(formatDateOnly(null)).toBe('—');
  });

  it('compareDateOnly et daysBetweenDateOnly sont cohérents', () => {
    expect(compareDateOnly('2026-09-12', '2026-09-15')).toBeLessThan(0);
    expect(compareDateOnly('2026-09-15', '2026-09-12')).toBeGreaterThan(0);
    expect(compareDateOnly('2026-09-12', '2026-09-12')).toBe(0);
    expect(daysBetweenDateOnly('2026-09-01', '2026-09-15')).toBe(14);
    expect(daysBetweenDateOnly('2026-09-15', '2026-09-01')).toBe(-14);
    expect(daysBetweenDateOnly('2026-02-28', '2026-03-01')).toBe(1);
  });

  it('isDateOnly rejette les valeurs invalides', () => {
    expect(isDateOnly('2026-09-12')).toBe(true);
    expect(isDateOnly('2026-13-40')).toBe(false);
    expect(isDateOnly('pas-une-date')).toBe(false);
    expect(isDateOnly(null)).toBe(false);
  });

  it('todayDateOnly correspond à la date locale du jour', () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(todayDateOnly()).toBe(expected);
  });
});
