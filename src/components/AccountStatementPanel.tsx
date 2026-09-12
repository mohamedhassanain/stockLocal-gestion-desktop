import React, { useCallback, useEffect, useState } from 'react';
import { Button } from './ui';
import { toast } from '../stores/useToastStore';
import type { Statement, StatementLine } from '../repositories/StatementRepository';

/**
 * §Phase 8 & 9 — Relevé de compte (CLIENT ou FOURNISSEUR).
 *
 * Aucun calcul métier ici : toutes les valeurs (lignes, débits, crédits, solde,
 * échéances) proviennent du dépôt `StatementRepository` via IPC. Le composant
 * ne fait que les afficher.
 */

interface Props {
  entityKind: 'client' | 'supplier';
  entityId: string;
}

const EMPTY: Statement = {
  entityId: '', entityName: '', lines: [], totalDebit: 0, totalCredit: 0,
  balance: 0, upcoming: [], overdue: [], overdueTotal: 0,
};

function money(value: number): string {
  return `${value.toFixed(2)} MAD`;
}

/** Solde dans le sens métier : rouge quand un montant reste dû, vert sinon. */
function balanceColor(balance: number): string {
  return balance > 0.001 ? 'var(--danger, #ef4444)' : 'var(--success, #10b981)';
}

/**
 * §Phase 2 — Couleur du libellé d'échéance, DÉRIVÉE du statut renvoyé par le
 * moteur métier (`evaluateCredit`). L'UI ne compare jamais de dates elle-même :
 * elle ne connaît que le vocabulaire du domaine.
 */
const DUE_STATUS_CLASS: Record<string, string> = {
  EN_RETARD: 'text-danger',
  A_ECHEANCE: 'text-warning',
  A_VENIR: 'text-muted',
  PAYE: 'text-success',
};

export const AccountStatementPanel: React.FC<Props> = ({ entityKind, entityId }) => {
  const [statement, setStatement] = useState<Statement>(EMPTY);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!entityId) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = entityKind === 'client'
        ? await window.api.clients.getStatement(entityId)
        : await window.api.suppliers.getStatement(entityId);

      // Les handlers IPC répondent { success, data } ; on tolère aussi une
      // réponse directe pour rester robuste.
      const payload = response as unknown as { success?: boolean; data?: Statement; error?: string };
      if (payload && payload.success === false) {
        setError(payload.error ?? 'Impossible de charger le relevé.');
        setStatement(EMPTY);
      } else {
        setStatement(payload?.data ?? (response as unknown as Statement) ?? EMPTY);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setStatement(EMPTY);
    } finally {
      setIsLoading(false);
    }
  }, [entityKind, entityId]);

  useEffect(() => { void load(); }, [load]);

  const exportPdf = async () => {
    try {
      const result = entityKind === 'client'
        ? await window.api.clients.exportStatement(entityId)
        : await window.api.suppliers.exportStatement(entityId);
      if (!result.success) toast.error(result.error ?? 'Export PDF impossible.');
      else toast.success('Relevé exporté au format PDF.');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Export PDF impossible.');
    }
  };

  const copyAsText = async () => {
    const header = `Relevé ${entityKind === 'client' ? 'client' : 'fournisseur'} — ${statement.entityName}`;
    const rows = statement.lines.map(l =>
      [l.date, l.label, l.debit.toFixed(2), l.credit.toFixed(2), l.balance.toFixed(2)].join('\t'),
    );
    const text = [
      header,
      ['Date', 'Document', 'Débit', 'Crédit', 'Solde'].join('\t'),
      ...rows,
      ['', 'TOTAL', statement.totalDebit.toFixed(2), statement.totalCredit.toFixed(2), statement.balance.toFixed(2)].join('\t'),
    ].join('\n');
    await window.api.system.writeClipboard(text);
    toast.success('Relevé copié dans le presse-papier.');
  };

  const debitLabel = entityKind === 'client' ? 'Total débits' : 'Total règlements';
  const creditLabel = entityKind === 'client' ? 'Total crédits' : 'Total achats';

  const lineTint = (line: StatementLine): string => {
    if (line.kind === 'PAYMENT' || line.kind === 'MANUAL_PAYMENT' || line.kind === 'MANUAL_CREDIT') {
      return 'rgba(16,185,129,0.07)';
    }
    return 'transparent';
  };

  if (isLoading) {
    return <div className="state-text" style={{ padding: 16 }}>Chargement du relevé…</div>;
  }

  if (error) {
    return <div className="surface-danger" style={{ padding: 12 }}>{error}</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* ── En-tête + actions ── */}
      <div className="flex items-center justify-between" style={{ gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div className="font-semibold" style={{ fontSize: 'var(--font-size-lg)' }}>
            Relevé de compte — {statement.entityName}
          </div>
          <div className="text-xs text-muted">
            {statement.lines.length} mouvement(s) · solde calculé depuis la base
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={copyAsText}>Copier</Button>
          <Button variant="primary" size="sm" onClick={exportPdf}>Exporter PDF</Button>
        </div>
      </div>

      {/* ── Totaux ── */}
      <div className="grid-3" style={{ gap: 10 }}>
        <div className="card card-body-compact">
          <div className="text-xs text-muted">{debitLabel}</div>
          <div className="money font-semibold">{money(statement.totalDebit)}</div>
        </div>
        <div className="card card-body-compact">
          <div className="text-xs text-muted">{creditLabel}</div>
          <div className="money font-semibold">{money(statement.totalCredit)}</div>
        </div>
        <div className="card card-body-compact">
          <div className="text-xs text-muted">
            {entityKind === 'client' ? 'Solde dû par le client' : 'Solde dû au fournisseur'}
          </div>
          <div className="money font-semibold" style={{ color: balanceColor(statement.balance) }}>
            {money(statement.balance)}
          </div>
        </div>
      </div>

      {/* ── Échéances ── */}
      {(statement.overdue.length > 0 || statement.upcoming.length > 0) && (
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          {statement.overdue.length > 0 && (
            <span className="badge badge-danger">
              {statement.overdue.length} échéance(s) en retard · {money(statement.overdueTotal)}
            </span>
          )}
          {statement.upcoming.length > 0 && (
            <span className="badge badge-info">{statement.upcoming.length} échéance(s) à venir</span>
          )}
        </div>
      )}

      {/* ── Tableau ── */}
      {statement.lines.length === 0 ? (
        <div className="text-muted text-center" style={{ padding: 24 }}>
          Aucun mouvement enregistré pour ce compte.
        </div>
      ) : (
        <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 96 }}>Date</th>
                <th>Document</th>
                <th style={{ textAlign: 'right', width: 110 }}>Débit</th>
                <th style={{ textAlign: 'right', width: 110 }}>Crédit</th>
                <th style={{ textAlign: 'right', width: 120 }}>Solde</th>
              </tr>
            </thead>
            <tbody>
              {statement.lines.map((line, index) => (
                <tr key={`${line.date}-${line.label}-${index}`} style={{ background: lineTint(line) }}>
                  <td className="text-sm">{line.date}</td>
                  <td>
                    <div className="text-sm font-semibold">{line.label}</div>
                    {line.dueDate && (
                      <div className={`text-xs ${line.dueStatus ? (DUE_STATUS_CLASS[line.dueStatus] ?? 'text-muted') : 'text-muted'}`}>
                        Échéance : {line.dueDate}
                        {line.dueStatusLabel ? ` · ${line.dueStatusLabel}` : ''}
                      </div>
                    )}
                  </td>
                  <td className="money text-right">{line.debit > 0 ? line.debit.toFixed(2) : '—'}</td>
                  <td className="money text-right">{line.credit > 0 ? line.credit.toFixed(2) : '—'}</td>
                  <td className="money text-right font-semibold">{line.balance.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td colSpan={2}>TOTAL</td>
                <td className="money text-right">{statement.totalDebit.toFixed(2)}</td>
                <td className="money text-right">{statement.totalCredit.toFixed(2)}</td>
                <td className="money text-right" style={{ color: balanceColor(statement.balance) }}>
                  {statement.balance.toFixed(2)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
};
