import { randomUUID } from 'crypto';
import { db, runInTransaction } from '../database/config/connection';
import { roundMoney } from '../utils/money';

/**
 * §Phase 10 — CAISSE : sessions.
 *
 * RÈGLES MÉTIER (source de vérité unique, appliquées ici et nulle part ailleurs) :
 *
 *   Solde théorique = fond initial
 *                   + Σ entrées ESPÈCES (CASH)
 *                   − Σ sorties ESPÈCES (CASH)
 *
 *   - Les mouvements Chèque / Virement sont enregistrés pour l'historique mais
 *     N'AFFECTENT PAS le tiroir-caisse (on ne compte pas un chèque dans les espèces).
 *   - Une session FERMÉE est FIGÉE : `theoretical_amount` et `difference` sont
 *     enregistrés au moment de la fermeture et ne sont JAMAIS recalculés.
 *   - Une seule session peut être OUVERTE à la fois : ouvrir une caisse déjà
 *     ouverte est refusé.
 *   - Aucun mouvement n'est accepté sur une session fermée.
 */

export type CashMovementType =
  | 'SALE_CASH'
  | 'PAYMENT_IN'
  | 'EXPENSE'
  | 'WITHDRAWAL'
  | 'MANUAL_IN'
  | 'MANUAL_OUT';

export type CashDirection = 'IN' | 'OUT';
export type CashMethod = 'CASH' | 'CHECK' | 'TRANSFER';

export interface CashSession {
  id: string;
  opened_at: string;
  closed_at: string | null;
  opening_float: number;
  counted_amount: number | null;
  theoretical_amount: number | null;
  difference: number | null;
  status: 'OPEN' | 'CLOSED';
  notes: string | null;
  closed_by: string | null;
  warehouse_id: string | null;
}

export interface CashMovement {
  id: string;
  session_id: string;
  movement_type: CashMovementType;
  direction: CashDirection;
  amount: number;
  payment_method: CashMethod;
  description: string | null;
  reference_id: string | null;
  date: string;
}

export interface CashSessionDetail {
  session: CashSession;
  movements: CashMovement[];
  totalCashIn: number;
  totalCashOut: number;
  totalOtherIn: number;
  totalOtherOut: number;
  theoreticalAmount: number;
}

const stmtGetOpen = db.prepare(
  `SELECT * FROM cash_sessions WHERE status = 'OPEN' ORDER BY opened_at DESC LIMIT 1`,
);

const stmtGetById = db.prepare('SELECT * FROM cash_sessions WHERE id = ?');

const stmtInsertSession = db.prepare(`
  INSERT INTO cash_sessions (id, opening_float, notes, warehouse_id, status)
  VALUES (?, ?, ?, ?, 'OPEN')
`);

const stmtInsertMovement = db.prepare(`
  INSERT INTO cash_movements (id, session_id, movement_type, direction, amount, payment_method, description, reference_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const stmtMovementById = db.prepare('SELECT * FROM cash_movements WHERE id = ?');

const stmtMovementsBySession = db.prepare(`
  SELECT * FROM cash_movements WHERE session_id = ? ORDER BY date ASC, created_at ASC
`);

const stmtCloseSession = db.prepare(`
  UPDATE cash_sessions
  SET status = 'CLOSED', closed_at = CURRENT_TIMESTAMP,
      counted_amount = ?, theoretical_amount = ?, difference = ?, closed_by = ?
  WHERE id = ? AND status = 'OPEN'
`);

const stmtAllSessions = db.prepare(`
  SELECT * FROM cash_sessions ORDER BY opened_at DESC LIMIT ?
`);

/** Solde théorique du tiroir à partir des mouvements (espèces uniquement). */
function computeTheoretical(openingFloat: number, movements: CashMovement[]): {
  totalCashIn: number;
  totalCashOut: number;
  totalOtherIn: number;
  totalOtherOut: number;
  theoreticalAmount: number;
} {
  let totalCashIn = 0;
  let totalCashOut = 0;
  let totalOtherIn = 0;
  let totalOtherOut = 0;

  for (const m of movements) {
    const amount = Number(m.amount ?? 0);
    const isCash = m.payment_method === 'CASH';
    if (m.direction === 'IN') {
      if (isCash) totalCashIn += amount; else totalOtherIn += amount;
    } else if (isCash) totalCashOut += amount; else totalOtherOut += amount;
  }

  totalCashIn = roundMoney(totalCashIn);
  totalCashOut = roundMoney(totalCashOut);

  return {
    totalCashIn,
    totalCashOut,
    totalOtherIn: roundMoney(totalOtherIn),
    totalOtherOut: roundMoney(totalOtherOut),
    theoreticalAmount: roundMoney(Number(openingFloat ?? 0) + totalCashIn - totalCashOut),
  };
}
export const CashSessionRepository = {
  /** Session actuellement ouverte, ou undefined. */
  getOpenSession(): CashSession | undefined {
    return stmtGetOpen.get() as CashSession | undefined;
  },

  getById(id: string): CashSession | undefined {
    return stmtGetById.get(id) as CashSession | undefined;
  },

  /**
   * Ouvre une nouvelle session de caisse.
   * @throws si une session est déjà ouverte, ou si le fond est invalide.
   */
  openSession(openingFloat: number, notes?: string, warehouseId?: string): CashSession {
    const fund = Number(openingFloat);
    if (!Number.isFinite(fund) || fund < 0) {
      throw new Error('Le fond de caisse initial doit être un montant positif ou nul.');
    }
    if (this.getOpenSession()) {
      throw new Error('Une session de caisse est déjà ouverte. Fermez-la avant d\'en ouvrir une nouvelle.');
    }

    const id = randomUUID();
    runInTransaction(() => {
      stmtInsertSession.run(id, roundMoney(fund), notes?.trim() || null, warehouseId ?? null);
    });
    return this.getById(id)!;
  },

  /**
   * Enregistre un mouvement sur une session OUVERTE.
   * @throws si la caisse est fermée, introuvable, ou si le montant est invalide.
   */
  addMovement(input: {
    sessionId?: string;
    movementType: CashMovementType;
    direction: CashDirection;
    amount: number;
    paymentMethod?: CashMethod;
    description?: string;
    referenceId?: string;
  }): CashMovement {
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Le montant du mouvement de caisse doit être supérieur à 0.');
    }
    if (input.direction !== 'IN' && input.direction !== 'OUT') {
      throw new Error('Sens de mouvement de caisse invalide (IN ou OUT attendu).');
    }

    const session = input.sessionId ? this.getById(input.sessionId) : this.getOpenSession();
    if (!session) throw new Error('Aucune session de caisse ouverte.');
    if (session.status !== 'OPEN') {
      throw new Error('Impossible d\'ajouter un mouvement : cette session de caisse est fermée.');
    }

    const id = randomUUID();
    runInTransaction(() => {
      stmtInsertMovement.run(
        id,
        session.id,
        input.movementType,
        input.direction,
        roundMoney(amount),
        input.paymentMethod ?? 'CASH',
        input.description?.trim() || null,
        input.referenceId ?? null,
      );
    });

    return stmtMovementById.get(id) as CashMovement;
  },

  /** Détail complet d'une session : mouvements + solde théorique calculé. */
  getSessionDetail(sessionId: string): CashSessionDetail {
    const session = this.getById(sessionId);
    if (!session) throw new Error('Session de caisse introuvable.');
    const movements = stmtMovementsBySession.all(sessionId) as CashMovement[];
    const totals = computeTheoretical(session.opening_float, movements);
    return { session, movements, ...totals };
  },

  /**
   * Ferme une session : calcule et FIGE le solde théorique et l'écart
   * (solde compté − solde théorique). Ces valeurs ne sont plus jamais recalculées.
   * @throws si la session est déjà fermée ou le montant compté invalide.
   */
  closeSession(sessionId: string, countedAmount: number, closedBy?: string): CashSession {
    const counted = Number(countedAmount);
    if (!Number.isFinite(counted) || counted < 0) {
      throw new Error('Le solde compté doit être un montant positif ou nul.');
    }

    const session = this.getById(sessionId);
    if (!session) throw new Error('Session de caisse introuvable.');
    if (session.status === 'CLOSED') {
      throw new Error('Cette session de caisse est déjà fermée.');
    }

    const movements = stmtMovementsBySession.all(sessionId) as CashMovement[];
    const { theoreticalAmount } = computeTheoretical(session.opening_float, movements);
    const difference = roundMoney(counted - theoreticalAmount);

    runInTransaction(() => {
      const result = stmtCloseSession.run(
        roundMoney(counted), theoreticalAmount, difference, closedBy?.trim() || null, sessionId,
      );
      // Garde-fou : si une autre fermeture est passée entre-temps, on refuse
      // plutôt que d'écraser silencieusement une session déjà figée.
      if (result.changes === 0) {
        throw new Error('Cette session de caisse a déjà été fermée.');
      }
    });

    return this.getById(sessionId)!;
  },

  /** Historique des sessions (les plus récentes d'abord). */
  getAll(limit = 100): CashSession[] {
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    return stmtAllSessions.all(safeLimit) as CashSession[];
  },

  /** Solde théorique courant d'une session. */
  getTheoreticalBalance(sessionId: string): number {
    return this.getSessionDetail(sessionId).theoreticalAmount;
  },
};
