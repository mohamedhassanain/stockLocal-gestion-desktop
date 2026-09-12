import { randomUUID } from 'crypto';
import { db, runInTransaction } from '../database/config/connection';
import { roundMoney } from '../utils/money';
import { toLocalDateString } from '../utils/date';
import { CashSessionRepository, type CashMethod } from './CashSessionRepository';

/**
 * §Phase 11 — DÉPENSES.
 *
 * Intégration caisse : une dépense réglée en ESPÈCES est rattachée à la session
 * de caisse ouverte et génère un mouvement `EXPENSE` (direction OUT). Une
 * dépense Chèque / Virement est enregistrée sans mouvement de tiroir.
 *
 * Catégories normalisées, utilisées à l'identique dans toute l'application.
 */

export const EXPENSE_CATEGORIES = [
  'Transport',
  'Électricité',
  'Loyer',
  'Téléphone',
  'Carburant',
  'Salaires',
  'Autres',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export interface Expense {
  id: string;
  date: string;
  category: string;
  amount: number;
  description: string | null;
  payment_method: CashMethod;
  cash_session_id: string | null;
  warehouse_id: string | null;
}

export interface ExpenseCategoryTotal {
  category: string;
  total: number;
  count: number;
}

const stmtInsert = db.prepare(`
  INSERT INTO expenses (id, date, category, amount, description, payment_method, cash_session_id, warehouse_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const stmtGetById = db.prepare('SELECT * FROM expenses WHERE id = ?');

const stmtAll = db.prepare(`
  SELECT * FROM expenses ORDER BY date DESC, created_at DESC LIMIT ? OFFSET ?
`);

// BETWEEN évite toute comparaison stricte et rend l'inclusion des bornes explicite.
const stmtInRange = db.prepare(`
  SELECT * FROM expenses
  WHERE date(date) BETWEEN date(?) AND date(?)
  ORDER BY date DESC
`);

const stmtTotalInRange = db.prepare(`
  SELECT COALESCE(SUM(amount), 0) AS total FROM expenses
  WHERE date(date) BETWEEN date(?) AND date(?)
`);

const stmtTotalsByCategory = db.prepare(`
  SELECT category, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
  FROM expenses
  WHERE date(date) BETWEEN date(?) AND date(?)
  GROUP BY category
  ORDER BY total DESC
`);

const stmtDelete = db.prepare('DELETE FROM expenses WHERE id = ?');

export const ExpenseRepository = {
  /** Catégories disponibles (source unique partagée avec l'UI). */
  categories(): readonly string[] {
    return EXPENSE_CATEGORIES;
  },

  /**
   * Enregistre une dépense.
   *
   * @throws si le montant ou la catégorie sont invalides, ou si aucune caisse
   *         n'est ouverte pour une dépense en espèces (on refuse plutôt que de
   *         créer une dépense non rattachée au tiroir, qui fausserait l'écart).
   */
  create(input: {
    category: string;
    amount: number;
    description?: string;
    paymentMethod?: CashMethod;
    date?: string;
    warehouseId?: string;
  }): Expense {
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || !(amount > 0)) {
      throw new Error('Le montant de la dépense doit être supérieur à 0.');
    }
    const category = (input.category ?? '').trim();
    if (!category) throw new Error('La catégorie de la dépense est obligatoire.');

    const paymentMethod: CashMethod = input.paymentMethod ?? 'CASH';
    const date = input.date
      ? toLocalDateString(new Date(`${input.date}T12:00:00`))
      : toLocalDateString();

    let sessionId: string | null = null;
    if (paymentMethod === 'CASH') {
      const session = CashSessionRepository.getOpenSession();
      if (!session) {
        throw new Error('Aucune session de caisse ouverte : ouvrez la caisse avant d\'enregistrer une dépense en espèces.');
      }
      sessionId = session.id;
    }

    const id = randomUUID();

    runInTransaction(() => {
      stmtInsert.run(
        id,
        date,
        category,
        roundMoney(amount),
        input.description?.trim() || null,
        paymentMethod,
        sessionId,
        input.warehouseId ?? null,
      );

      if (paymentMethod === 'CASH' && sessionId) {
        CashSessionRepository.addMovement({
          sessionId,
          movementType: 'EXPENSE',
          direction: 'OUT',
          amount: roundMoney(amount),
          paymentMethod: 'CASH',
          description: `Dépense — ${category}${input.description ? ` : ${input.description}` : ''}`,
          referenceId: id,
        });
      }
    });

    return stmtGetById.get(id) as Expense;
  },

  /** Liste paginée des dépenses (les plus récentes d'abord). */
  getAll(limit = 100, offset = 0): Expense[] {
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const safeOffset = Math.max(Number(offset) || 0, 0);
    return stmtAll.all(safeLimit, safeOffset) as Expense[];
  },

  /** Dépenses dans un intervalle de dates (bornes incluses). */
  getInRange(from: string, to: string): Expense[] {
    return stmtInRange.all(from, to) as Expense[];
  },

  /** Total des dépenses sur un intervalle (tableau de bord §Phase 12). */
  getTotalInRange(from: string, to: string): number {
    const row = stmtTotalInRange.get(from, to) as { total: number };
    return roundMoney(Number(row?.total ?? 0));
  },

  /** Répartition des dépenses par catégorie sur un intervalle. */
  getTotalsByCategory(from: string, to: string): ExpenseCategoryTotal[] {
    return (stmtTotalsByCategory.all(from, to) as ExpenseCategoryTotal[])
      .map(row => ({ ...row, total: roundMoney(Number(row.total ?? 0)) }));
  },

  /**
   * Supprime une dépense.
   * @throws si la dépense est rattachée à une session de caisse FERMÉE :
   *         retirer une dépense d'un tiroir déjà compté fausserait l'écart
   *         historique. Aucune donnée n'est modifiée silencieusement.
   */
  remove(id: string): void {
    const expense = stmtGetById.get(id) as Expense | undefined;
    if (!expense) throw new Error('Dépense introuvable.');

    if (expense.cash_session_id) {
      const session = CashSessionRepository.getById(expense.cash_session_id);
      if (session && session.status === 'CLOSED') {
        throw new Error('Impossible de supprimer cette dépense : sa session de caisse est déjà fermée.');
      }
    }

    runInTransaction(() => {
      db.prepare(`DELETE FROM cash_movements WHERE reference_id = ? AND movement_type = 'EXPENSE'`).run(id);
      stmtDelete.run(id);
    });
  },
};
