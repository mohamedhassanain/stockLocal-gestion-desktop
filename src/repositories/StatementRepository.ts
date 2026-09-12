import { db } from '../database/config/connection';
import { roundMoney } from '../utils/money';
import { compareDateOnly } from '../utils/date';
// §Phase 2 — moteur d'échéance/crédit UNIQUE : aucune page ni dépôt ne
// recalcule « en retard / à échéance / à venir » de son côté.
import { evaluateCredit, type CreditStatus } from '../domain/credit/CreditStatus';

/**
 * §Phase 8 & 9 — Relevés de compte CLIENT et FOURNISSEUR.
 *
 * ⚠️ Source de vérité unique : SQLite. Aucun solde n'est stocké ni recalculé
 * dans l'UI : ce dépôt produit les lignes (Date / Document / Débit / Crédit /
 * Solde) et les totaux ; l'UI se contente de les afficher.
 *
 * Règles comptables appliquées (documentées, cohérentes entre elles) :
 *   CLIENT
 *     Débit  : factures & bons de livraison NON ANNULÉS (le client doit)
 *     Débit  : écritures client_credits de type CREDIT (dette manuelle)
 *     Crédit : paiements rattachés à un document NON ANNULÉ
 *     Crédit : écritures client_credits de type PAYMENT (règlement manuel + avoir)
 *   FOURNISSEUR
 *     Crédit : commandes d'achat non annulées (nous devons)
 *     Crédit : écritures supplier_credits de type CREDIT (dette manuelle)
 *     Débit  : écritures supplier_credits de type PAYMENT (nos règlements)
 *
 * ⚠️ Une facture ANNULÉE (retour total) est exclue de l'historique, ainsi que
 * ses paiements : le retour total est alors représenté par l'avoir, ce qui
 * évite tout double comptage (cf. §Phase 7).
 */

export interface StatementLine {
  /** Date au format YYYY-MM-DD (jamais convertie en UTC). */
  date: string;
  /** Libellé affiché : numéro de document ou description de l'écriture. */
  label: string;
  /** Sous-type technique (coloration / filtrage) : INVOICE, PAYMENT, MANUAL_DEBIT… */
  kind: string;
  /** Montant au débit (0 si crédit). */
  debit: number;
  /** Montant au crédit (0 si débit). */
  credit: number;
  /** Solde cumulé APRÈS application de cette ligne. */
  balance: number;
  /** Échéance éventuelle (documents uniquement). */
  dueDate?: string | null;
  /** Statut du document le cas échéant. */
  status?: string;
  /**
   * §Phase 2 — état de l'échéance dérivé du moteur UNIQUE `evaluateCredit`.
   * L'UI affiche ce libellé tel quel : elle ne compare JAMAIS de dates.
   */
  dueStatus?: CreditStatus | null;
  dueStatusLabel?: string | null;
}

export interface StatementDue {
  date: string;
  label: string;
  dueDate: string;
  remaining: number;
  /** true si l'échéance est dépassée (dérivé de `status === 'EN_RETARD'`). */
  overdue: boolean;
  /** Statut issu du moteur unique `evaluateCredit`. */
  status: CreditStatus;
  /** Libellé français prêt à afficher (« À venir », « À échéance », « En retard »…). */
  statusLabel: string;
  /** Jours avant l'échéance (négatif = dépassée). */
  daysUntilDue: number | null;
}

export interface Statement {
  entityId: string;
  entityName: string;
  /** Lignes triées par date croissante, solde cumulé calculé. */
  lines: StatementLine[];
  /** Somme des débits. */
  totalDebit: number;
  /** Somme des crédits. */
  totalCredit: number;
  /**
   * Solde actuel, dans le SENS MÉTIER de l'entité :
   *   - CLIENT      : débit − crédit  (positif = le client nous doit)
   *   - FOURNISSEUR : crédit − débit  (positif = nous devons au fournisseur)
   */
  balance: number;
  /** Échéances à venir (due_date >= aujourd'hui), reste dû > 0. */
  upcoming: StatementDue[];
  /** Échéances en retard (due_date < aujourd'hui), reste dû > 0. */
  overdue: StatementDue[];
  /** Somme des restes dus sur les échéances en retard. */
  overdueTotal: number;
}

interface RawLine {
  date: string;
  label: string;
  kind: string;
  debit: number;
  credit: number;
  dueDate?: string | null;
  status?: string;
  /** Montant restant dû sur la ligne (documents uniquement). */
  remaining?: number;
}

/**
 * Trie par date croissante puis calcule le solde cumulé.
 *
 * `balance` est exprimé dans le sens MÉTIER de l'entité :
 *   - CLIENT     : solde = débit − crédit  → positif = le client nous doit
 *   - FOURNISSEUR: solde = crédit − débit  → positif = nous devons au fournisseur
 * (pour un fournisseur, la colonne « crédit » porte les achats, donc la dette)
 */
function buildStatement(
  entityId: string,
  entityName: string,
  raw: RawLine[],
  balanceIsCreditMinusDebit = false,
): Statement {
  const sorted = [...raw].sort((a, b) => {
    const byDate = compareDateOnly(a.date, b.date);
    if (byDate !== 0) return byDate;
    return a.label.localeCompare(b.label);
  });

  let running = 0;
  let totalDebit = 0;
  let totalCredit = 0;
  const lines: StatementLine[] = [];

  for (const row of sorted) {
    const debit = roundMoney(Math.max(0, row.debit));
    const credit = roundMoney(Math.max(0, row.credit));
    totalDebit = roundMoney(totalDebit + debit);
    totalCredit = roundMoney(totalCredit + credit);
    running = roundMoney(running + debit - credit);

    // §Phase 2 — l'état de l'échéance d'une ligne vient du moteur UNIQUE.
    // `amountPaid = 0` car `remaining` est DÉJÀ le reste dû de ce document :
    // evaluateCredit ramène donc la ligne à PAYE / À échéance / À venir / En retard.
    const dueEvaluation = row.dueDate
      ? evaluateCredit({
          totalDue: roundMoney(Number(row.remaining ?? 0)),
          amountPaid: 0,
          dueDate: row.dueDate,
        })
      : null;

    lines.push({
      date: row.date,
      label: row.label,
      kind: row.kind,
      debit,
      credit,
      balance: running,
      dueDate: row.dueDate ?? null,
      status: row.status,
      dueStatus: dueEvaluation?.status ?? null,
      dueStatusLabel: dueEvaluation?.label ?? null,
    });
  }

  // §Phase 2 — CHAQUE échéance est évaluée par le moteur UNIQUE : plus aucune
  // comparaison de dates ad hoc ici (elle divergeait du reste de l'application).
  const dues: StatementDue[] = sorted
    .filter(row => !!row.dueDate && Number(row.remaining ?? 0) > 0)
    .map(row => {
      const remaining = roundMoney(Number(row.remaining ?? 0));
      const evaluation = evaluateCredit({
        totalDue: remaining,
        amountPaid: 0,
        dueDate: row.dueDate as string,
      });
      return {
        date: row.date,
        label: row.label,
        dueDate: row.dueDate as string,
        remaining,
        overdue: evaluation.isOverdue,
        status: evaluation.status,
        statusLabel: evaluation.label,
        daysUntilDue: evaluation.daysUntilDue,
      };
    });

  const overdue = dues.filter(d => d.overdue);
  const upcoming = dues.filter(d => !d.overdue);

  return {
    entityId,
    entityName,
    lines,
    totalDebit,
    totalCredit,
    balance: roundMoney(balanceIsCreditMinusDebit ? totalCredit - totalDebit : totalDebit - totalCredit),
    upcoming,
    overdue,
    overdueTotal: roundMoney(overdue.reduce((s, d) => s + d.remaining, 0)),
  };
}

const DOC_TYPE_LABELS: Record<string, string> = {
  INVOICE: 'Facture',
  DELIVERY_NOTE: 'Bon de livraison',
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Espèces',
  CHECK: 'Chèque',
  TRANSFER: 'Virement',
};

export const StatementRepository = {
  // ───────────────────────────────────────────────────────────────────────────
  // §Phase 8 — Relevé de compte CLIENT
  // ───────────────────────────────────────────────────────────────────────────
  getClientStatement(customerId: string): Statement {
    const customer = db.prepare('SELECT id, name FROM customers WHERE id = ?').get(customerId) as
      | { id: string; name: string }
      | undefined;
    if (!customer) throw new Error('Client introuvable.');

    // Factures / BL NON annulés → le client nous doit (débit).
    const docs = db.prepare(`
      SELECT id, document_number, type, date, total_incl_tax, status, due_date,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.document_id = documents.id), 0) AS paid
      FROM documents
      WHERE entity_id = ? AND type IN ('INVOICE', 'DELIVERY_NOTE') AND status != 'CANCELLED'
      ORDER BY date ASC
    `).all(customerId) as Array<{
      id: string; document_number: string; type: string; date: string;
      total_incl_tax: number; status: string; due_date: string | null; paid: number;
    }>;

    // Paiements rattachés à un document NON annulé → le client nous a payés (crédit).
    const payments = db.prepare(`
      SELECT p.date, p.amount, p.payment_method, d.document_number
      FROM payments p
      JOIN documents d ON d.id = p.document_id
      WHERE d.entity_id = ? AND d.status != 'CANCELLED'
      ORDER BY p.date ASC
    `).all(customerId) as Array<{
      date: string; amount: number; payment_method: string; document_number: string;
    }>;

    // Écritures manuelles + crédits d'avoir (client_credits).
    const credits = db.prepare(`
      SELECT date, type, amount, description
      FROM client_credits
      WHERE customer_id = ?
      ORDER BY date ASC
    `).all(customerId) as Array<{ date: string; type: string; amount: number; description: string | null }>;

    const raw: RawLine[] = [];

    for (const d of docs) {
      const total = Number(d.total_incl_tax ?? 0);
      const paid = Number(d.paid ?? 0);
      raw.push({
        date: String(d.date).split('T')[0],
        label: `${d.document_number} (${DOC_TYPE_LABELS[d.type] ?? d.type})`,
        kind: d.type,
        debit: total,
        credit: 0,
        dueDate: d.due_date,
        status: d.status,
        remaining: roundMoney(total - paid),
      });
    }

    for (const p of payments) {
      raw.push({
        date: String(p.date).split('T')[0],
        label: `Paiement (${PAYMENT_METHOD_LABELS[p.payment_method] ?? p.payment_method}) — ${p.document_number}`,
        kind: 'PAYMENT',
        debit: 0,
        credit: Number(p.amount ?? 0),
      });
    }

    for (const c of credits) {
      const isDebt = c.type === 'CREDIT';
      raw.push({
        date: String(c.date).split('T')[0],
        label: c.description ?? (isDebt ? 'Dette ajoutée' : 'Règlement'),
        kind: isDebt ? 'MANUAL_DEBIT' : 'MANUAL_CREDIT',
        debit: isDebt ? Number(c.amount ?? 0) : 0,
        credit: isDebt ? 0 : Number(c.amount ?? 0),
      });
    }

    return buildStatement(customer.id, customer.name, raw);
  },

  // ───────────────────────────────────────────────────────────────────────────
  // §Phase 9 — Relevé FOURNISSEUR
  // ───────────────────────────────────────────────────────────────────────────
  getSupplierStatement(supplierId: string): Statement {
    const supplier = db.prepare('SELECT id, name FROM suppliers WHERE id = ?').get(supplierId) as
      | { id: string; name: string }
      | undefined;
    if (!supplier) throw new Error('Fournisseur introuvable.');

    // Achats NON annulés → nous devons le montant au fournisseur (crédit de notre point de vue).
    const orders = db.prepare(`
      SELECT id, order_number, date, total, status, expected_date
      FROM purchase_orders
      WHERE supplier_id = ? AND status != 'CANCELLED'
      ORDER BY date ASC
    `).all(supplierId) as Array<{
      id: string; order_number: string; date: string; total: number;
      status: string; expected_date: string | null;
    }>;

    // Écritures manuelles : CREDIT = dette fournisseur, PAYMENT = notre règlement.
    const credits = db.prepare(`
      SELECT date, type, amount, description
      FROM supplier_credits
      WHERE supplier_id = ?
      ORDER BY date ASC
    `).all(supplierId) as Array<{ date: string; type: string; amount: number; description: string | null }>;

    const raw: RawLine[] = [];

    for (const o of orders) {
      raw.push({
        date: String(o.date).split('T')[0],
        label: `Achat ${o.order_number}`,
        kind: 'PURCHASE',
        // Sens FOURNISSEUR : l'achat augmente ce que NOUS devons → colonne Crédit.
        debit: 0,
        credit: Number(o.total ?? 0),
        dueDate: o.expected_date,
        status: o.status,
        remaining: Number(o.total ?? 0),
      });
    }

    for (const c of credits) {
      const isDebt = c.type === 'CREDIT';
      raw.push({
        date: String(c.date).split('T')[0],
        label: c.description ?? (isDebt ? 'Dette fournisseur' : 'Règlement fournisseur'),
        kind: isDebt ? 'MANUAL_CREDIT' : 'MANUAL_PAYMENT',
        // Sens FOURNISSEUR : notre dette = crédit ; notre paiement = débit.
        debit: isDebt ? 0 : Number(c.amount ?? 0),
        credit: isDebt ? Number(c.amount ?? 0) : 0,
      });
    }

    // Sens FOURNISSEUR : solde positif = nous devons au fournisseur.
    return buildStatement(supplier.id, supplier.name, raw, true);
  },
};
