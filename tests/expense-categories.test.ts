import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/database/config/connection';
import { GlobalSettingsService } from '../src/services/GlobalSettingsService';
import { ExpenseRepository } from '../src/repositories/ExpenseRepository';
import { CashSessionRepository } from '../src/repositories/CashSessionRepository';
import {
  DEFAULT_EXPENSE_CATEGORIES,
  parseExpenseCategories,
  normalizeExpenseCategories,
} from '../src/domain/expenses/expenseCategories';

/**
 * Catégories de dépenses définies par l'utilisateur (Paramètres → Dépenses).
 *
 * L'utilisateur crée ses propres catégories (ex : « Loyer »), persistées dans
 * `global_settings.expense_categories` et proposées dans « Dépenses → Nouvelle dépense → Catégorie ».
 */

function reset(): void {
  db.prepare('DELETE FROM global_settings WHERE key = ?').run('expense_categories');
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('DELETE FROM cash_movements; DELETE FROM expenses; DELETE FROM cash_sessions;');
  db.exec('PRAGMA foreign_keys = ON;');
}

describe('Catégories de dépenses (définies par l\'utilisateur)', () => {
  beforeEach(() => { reset(); });

  it('propose les catégories par défaut quand rien n\'est enregistré', () => {
    const categories = [...ExpenseRepository.categories()];
    expect(categories).toEqual([...DEFAULT_EXPENSE_CATEGORIES]);
    expect(categories).toContain('Transport');
    expect(categories).toContain('Loyer');
  });

  it('un utilisateur peut définir ses catégories (ex : Loyer, Impôts) et elles sont proposées', () => {
    GlobalSettingsService.save({ expense_categories: ['Loyer', 'Impôts'] });
    expect([...ExpenseRepository.categories()]).toEqual(['Loyer', 'Impôts']);
  });

  it('persiste la liste dans global_settings et la relit', () => {
    const categories = ['Transport', 'Loyer', 'Eau'];
    GlobalSettingsService.save({ expense_categories: categories });
    expect(GlobalSettingsService.getAll().expense_categories).toEqual(categories);
  });

  it('normalise : nettoie les espaces, retire doublons et entrées vides/non-texte', () => {
    expect(normalizeExpenseCategories(['  Loyer ', 'loyer', '', 42, 'Eau'])).toEqual(['Loyer', 'Eau']);
  });

  it('retombe sur les catégories par défaut si la valeur est vide ou illisible', () => {
    expect(parseExpenseCategories(null)).toEqual([...DEFAULT_EXPENSE_CATEGORIES]);
    expect(parseExpenseCategories('[]')).toEqual([...DEFAULT_EXPENSE_CATEGORIES]);
    expect(parseExpenseCategories('pas du json')).toEqual([...DEFAULT_EXPENSE_CATEGORIES]);
  });

  it('une dépense accepte une catégorie personnalisée et reste comptée dans la caisse', () => {
    const session = CashSessionRepository.openSession(1000);
    GlobalSettingsService.save({ expense_categories: ['Impôts'] });

    const expense = ExpenseRepository.create({ category: 'Impôts', amount: 250 });
    expect(expense.category).toBe('Impôts');
    expect(expense.cash_session_id).toBe(session.id);

    const detail = CashSessionRepository.getSessionDetail(session.id);
    expect(detail.totalCashOut).toBe(250);
    expect(detail.theoreticalAmount).toBe(750);
  });
});
