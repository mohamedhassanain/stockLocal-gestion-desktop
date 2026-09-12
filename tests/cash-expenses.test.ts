import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/database/config/connection';
import { CashSessionRepository } from '../src/repositories/CashSessionRepository';
import { ExpenseRepository } from '../src/repositories/ExpenseRepository';

/**
 * §Phase 10 — Caisse (sessions) & §Phase 11 — Dépenses.
 *
 * Scénarios couverts : ouverture (fond initial), ventes/encaissements,
 * dépense, retrait, fermeture (solde théorique / compté / écart), refus des
 * opérations invalides (double ouverture, mouvement après fermeture, dépense
 * en espèces sans caisse).
 */

function clean(): void {
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec(`
    DELETE FROM cash_movements;
    DELETE FROM expenses;
    DELETE FROM cash_sessions;
  `);
  db.exec('PRAGMA foreign_keys = ON;');
}

describe('§Phase 10 — Caisse : sessions', () => {
  beforeEach(() => { clean(); });

  it('ouvre une caisse avec un fond initial', () => {
    const session = CashSessionRepository.openSession(1000, 'Ouverture du jour');
    expect(session.status).toBe('OPEN');
    expect(session.opening_float).toBe(1000);
    expect(session.counted_amount).toBeNull();
    expect(session.theoretical_amount).toBeNull();

    const open = CashSessionRepository.getOpenSession();
    expect(open?.id).toBe(session.id);
  });

  it('refuse d\'ouvrir une deuxième caisse tant que la première est ouverte', () => {
    CashSessionRepository.openSession(500);
    expect(() => CashSessionRepository.openSession(200)).toThrow(/déjà ouverte/);
  });

  it('refuse un fond de caisse négatif', () => {
    expect(() => CashSessionRepository.openSession(-10)).toThrow();
  });

  it('solde théorique = fond + entrées espèces − sorties espèces', () => {
    const session = CashSessionRepository.openSession(1000);

    // Vente espèces +800
    CashSessionRepository.addMovement({ movementType: 'SALE_CASH', direction: 'IN', amount: 800 });
    // Encaissement espèces +200
    CashSessionRepository.addMovement({ movementType: 'PAYMENT_IN', direction: 'IN', amount: 200 });
    // Dépense espèces −150
    CashSessionRepository.addMovement({ movementType: 'EXPENSE', direction: 'OUT', amount: 150 });
    // Retrait −100
    CashSessionRepository.addMovement({ movementType: 'WITHDRAWAL', direction: 'OUT', amount: 100 });

    const detail = CashSessionRepository.getSessionDetail(session.id);
    expect(detail.totalCashIn).toBe(1000);
    expect(detail.totalCashOut).toBe(250);
    // 1000 + 1000 − 250
    expect(detail.theoreticalAmount).toBe(1750);
  });

  it('un mouvement chèque/virement n\'affecte PAS le tiroir', () => {
    const session = CashSessionRepository.openSession(500);

    CashSessionRepository.addMovement({ movementType: 'SALE_CASH', direction: 'IN', amount: 300 });
    CashSessionRepository.addMovement({
      movementType: 'PAYMENT_IN', direction: 'IN', amount: 900, paymentMethod: 'CHECK',
    });

    const detail = CashSessionRepository.getSessionDetail(session.id);
    expect(detail.totalCashIn).toBe(300);
    expect(detail.totalOtherIn).toBe(900);
    expect(detail.theoreticalAmount).toBe(800); // 500 + 300 seulement
  });

  it('refuse un mouvement de montant nul ou négatif', () => {
    CashSessionRepository.openSession(0);
    expect(() =>
      CashSessionRepository.addMovement({ movementType: 'MANUAL_IN', direction: 'IN', amount: 0 }),
    ).toThrow();
    expect(() =>
      CashSessionRepository.addMovement({ movementType: 'MANUAL_IN', direction: 'IN', amount: -5 }),
    ).toThrow();
  });

  it('refuse tout mouvement quand aucune caisse n\'est ouverte', () => {
    expect(() =>
      CashSessionRepository.addMovement({ movementType: 'MANUAL_IN', direction: 'IN', amount: 10 }),
    ).toThrow(/Aucune session de caisse ouverte/);
  });

  it('fermeture : solde théorique figé, solde compté et écart calculés', () => {
    const session = CashSessionRepository.openSession(1000);
    CashSessionRepository.addMovement({ movementType: 'SALE_CASH', direction: 'IN', amount: 5000 });
    CashSessionRepository.addMovement({ movementType: 'EXPENSE', direction: 'OUT', amount: 550 });

    // 1000 + 5000 − 550 = 5450
    const closed = CashSessionRepository.closeSession(session.id, 5400, 'Caissier');
    expect(closed.status).toBe('CLOSED');
    expect(closed.theoretical_amount).toBe(5450);
    expect(closed.counted_amount).toBe(5400);
    expect(closed.difference).toBe(-50);
    expect(closed.closed_by).toBe('Caissier');
    expect(closed.closed_at).toBeTruthy();
  });

  it('l\'écart est positif si le tiroir contient plus que le théorique', () => {
    const session = CashSessionRepository.openSession(100);
    const closed = CashSessionRepository.closeSession(session.id, 130);
    expect(closed.theoretical_amount).toBe(100);
    expect(closed.difference).toBe(30);
  });

  it('une session fermée ne peut plus être fermée ni recevoir de mouvement', () => {
    const session = CashSessionRepository.openSession(100);
    CashSessionRepository.closeSession(session.id, 100);

    expect(() => CashSessionRepository.closeSession(session.id, 100)).toThrow(/déjà fermée/);
    expect(() =>
      CashSessionRepository.addMovement({
        sessionId: session.id, movementType: 'MANUAL_IN', direction: 'IN', amount: 10,
      }),
    ).toThrow(/fermée/);
  });

  it('après fermeture, une nouvelle caisse peut être ouverte', () => {
    const first = CashSessionRepository.openSession(100);
    CashSessionRepository.closeSession(first.id, 100);
    expect(CashSessionRepository.getOpenSession()).toBeUndefined();

    const second = CashSessionRepository.openSession(200);
    expect(second.id).not.toBe(first.id);
    expect(CashSessionRepository.getOpenSession()?.id).toBe(second.id);
  });

  it('les sessions fermées restent dans l\'historique (jamais supprimées)', () => {
    const first = CashSessionRepository.openSession(100);
    CashSessionRepository.closeSession(first.id, 100);
    const all = CashSessionRepository.getAll();
    expect(all.some(s => s.id === first.id && s.status === 'CLOSED')).toBe(true);
  });
});

describe('§Phase 11 — Dépenses', () => {
  beforeEach(() => { clean(); });

  it('expose les catégories normalisées', () => {
    const categories = ExpenseRepository.categories();
    expect(categories).toContain('Transport');
    expect(categories).toContain('Loyer');
    expect(categories).toContain('Salaires');
    expect(categories).toContain('Autres');
  });

  it('une dépense en espèces crée un mouvement de caisse OUT', () => {
    const session = CashSessionRepository.openSession(1000);
    const expense = ExpenseRepository.create({
      category: 'Transport', amount: 150, description: 'Livraison client',
    });

    expect(expense.category).toBe('Transport');
    expect(expense.amount).toBe(150);
    expect(expense.cash_session_id).toBe(session.id);

    const detail = CashSessionRepository.getSessionDetail(session.id);
    expect(detail.totalCashOut).toBe(150);
    expect(detail.theoreticalAmount).toBe(850); // 1000 − 150

    const movements = db.prepare(
      `SELECT COUNT(*) AS c FROM cash_movements WHERE movement_type = 'EXPENSE'`,
    ).get() as { c: number };
    expect(movements.c).toBe(1);
  });

  it('refuse une dépense en espèces quand la caisse est fermée', () => {
    expect(() =>
      ExpenseRepository.create({ category: 'Loyer', amount: 3000 }),
    ).toThrow(/Aucune session de caisse ouverte/);
  });

  it('une dépense par virement est enregistrée SANS mouvement de tiroir', () => {
    const expense = ExpenseRepository.create({
      category: 'Loyer', amount: 3000, paymentMethod: 'TRANSFER',
    });
    expect(expense.cash_session_id).toBeNull();

    const movements = db.prepare('SELECT COUNT(*) AS c FROM cash_movements').get() as { c: number };
    expect(movements.c).toBe(0);
  });

  it('refuse un montant nul ou négatif et une catégorie vide', () => {
    CashSessionRepository.openSession(0);
    expect(() => ExpenseRepository.create({ category: 'Transport', amount: 0 })).toThrow();
    expect(() => ExpenseRepository.create({ category: 'Transport', amount: -10 })).toThrow();
    expect(() => ExpenseRepository.create({ category: '   ', amount: 10 })).toThrow(/catégorie/);
  });

  it('totalise les dépenses sur un intervalle, par catégorie', () => {
    CashSessionRepository.openSession(10000);
    ExpenseRepository.create({ category: 'Transport', amount: 100, date: '2026-09-01' });
    ExpenseRepository.create({ category: 'Transport', amount: 50, date: '2026-09-02' });
    ExpenseRepository.create({ category: 'Loyer', amount: 2000, date: '2026-09-02' });
    ExpenseRepository.create({ category: 'Carburant', amount: 300, date: '2026-10-01' });

    const total = ExpenseRepository.getTotalInRange('2026-09-01', '2026-09-30');
    expect(total).toBe(2150);

    const byCategory = ExpenseRepository.getTotalsByCategory('2026-09-01', '2026-09-30');
    const transport = byCategory.find(c => c.category === 'Transport');
    expect(transport?.total).toBe(150);
    expect(transport?.count).toBe(2);

    // Le mois d'octobre n'est pas inclus
    const october = ExpenseRepository.getTotalInRange('2026-10-01', '2026-10-31');
    expect(october).toBe(300);
  });

  it('supprime une dépense et son mouvement de caisse associé', () => {
    const session = CashSessionRepository.openSession(1000);
    const expense = ExpenseRepository.create({ category: 'Transport', amount: 100 });

    ExpenseRepository.remove(expense.id);

    const detail = CashSessionRepository.getSessionDetail(session.id);
    expect(detail.totalCashOut).toBe(0);
    expect(detail.theoreticalAmount).toBe(1000);
  });

  it('refuse de supprimer une dépense d\'une session déjà fermée', () => {
    const session = CashSessionRepository.openSession(1000);
    const expense = ExpenseRepository.create({ category: 'Transport', amount: 100 });
    CashSessionRepository.closeSession(session.id, 900);

    expect(() => ExpenseRepository.remove(expense.id)).toThrow(/déjà fermée/);
  });

  it('la fermeture de caisse intègre les dépenses en espèces dans l\'écart', () => {
    const session = CashSessionRepository.openSession(8450);
    ExpenseRepository.create({ category: 'Carburant', amount: 50 });

    // Théorique = 8450 − 50 = 8400 ; compté 8400 → écart 0
    const closed = CashSessionRepository.closeSession(session.id, 8400);
    expect(closed.theoretical_amount).toBe(8400);
    expect(closed.difference).toBe(0);
  });
});
