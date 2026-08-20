import React, { useEffect, useMemo, useState } from 'react';
import { toast } from '../stores/useToastStore';
import type { PaymentRecord } from '../repositories/DocumentRepository';

const PAGE_SIZE = 50;

const TYPE_BADGE: Record<string, { label: string; cls: string }> = {
  INVOICE: { label: 'Facture', cls: 'badge-primary' },
  DELIVERY_NOTE: { label: 'BL', cls: 'badge-warning' },
  CREDIT_NOTE: { label: 'Avoir', cls: 'badge-success' },
  QUOTE: { label: 'Devis', cls: 'badge-muted' },
};

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Espèces',
  CHECK: 'Chèque',
  TRANSFER: 'Virement',
};

const CASH_ACCOUNT = 'CASH';
const CHECK_ACCOUNT = 'CHECK';
const TRANSFER_ACCOUNT = 'TRANSFER';

export const CashRegisterPage: React.FC = () => {
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = async () => {
    setIsLoading(true);
    try {
      const data = await window.api.documents.getAllPayments({ limit: 500, offset: 0 });
      setPayments(data ?? []);
    } catch (e: any) {
      toast.error(`Impossible de charger la caisse : ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const totals = useMemo(() => {
    let cash = 0;
    let check = 0;
    let transfer = 0;
    let total = 0;
    for (const p of payments) {
      const amount = Number(p.amount) || 0;
      total += amount;
      if (p.payment_method === CASH_ACCOUNT) cash += amount;
      else if (p.payment_method === CHECK_ACCOUNT) check += amount;
      else if (p.payment_method === TRANSFER_ACCOUNT) transfer += amount;
    }
    return { cash, check, transfer, total };
  }, [payments]);

  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(payments.length / PAGE_SIZE));
  const visible = payments.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg)', height: '100vh', overflow: 'hidden' }}>
      <div className="page-header">
        <div>
          <h1>Caisse</h1>
          <div style={{ color: 'var(--muted)', marginTop: 4, fontSize: 13 }}>
            Suivi des encaissements par mode de paiement
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost" onClick={load}>Actualiser</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* KPI par mode de paiement */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          {[
            { label: 'Espèces', value: totals.cash, soft: 'var(--success-soft)', color: 'var(--success)' },
            { label: 'Chèques', value: totals.check, soft: 'var(--warning-soft)', color: 'var(--warning)' },
            { label: 'Virements', value: totals.transfer, soft: 'var(--info-soft)', color: 'var(--info)' },
            { label: 'Total encaissé', value: totals.total, soft: 'var(--primary-soft)', color: 'var(--primary)' },
          ].map((kpi) => (
            <div key={kpi.label} className="card" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{kpi.label}</span>
              <span className="money" style={{ fontSize: 22, fontWeight: 800, color: kpi.color }}>{kpi.value.toFixed(2)} MAD</span>
            </div>
          ))}
        </div>

        {/* Journal des paiements */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>Journal de caisse</h3>
            <span className="text-sm text-muted">{payments.length} encaissement(s)</span>
          </div>
          {isLoading ? (
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton skeleton-row" />)}
            </div>
          ) : payments.length === 0 ? (
            <div className="state-box">
              <div className="state-text">Aucun paiement encaissé pour le moment.</div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Document</th>
                    <th>Client</th>
                    <th>Mode</th>
                    <th style={{ textAlign: 'right' }}>Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => {
                    const badge = TYPE_BADGE[p.document_type] ?? TYPE_BADGE.QUOTE;
                    return (
                      <tr key={p.id}>
                        <td className="text-sm" style={{ whiteSpace: 'nowrap' }}>{new Date(p.date).toLocaleDateString('fr-MA')}</td>
                        <td>
                          <span className={`badge ${badge.cls}`} style={{ marginRight: 8 }}>{badge.label}</span>
                          <span style={{ fontWeight: 600 }}>{p.document_number}</span>
                        </td>
                        <td>{p.customer_name ?? '—'}</td>
                        <td>{METHOD_LABELS[p.payment_method] ?? p.payment_method}</td>
                        <td className="money" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--success)' }}>{p.amount.toFixed(2)} MAD</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {pageCount > 1 && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
              <button className="btn btn-secondary" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Précédent</button>
              <span className="text-sm text-muted" style={{ alignSelf: 'center' }}>Page {page + 1} / {pageCount}</span>
              <button className="btn btn-secondary" disabled={page >= pageCount - 1} onClick={() => setPage(p => p + 1)}>Suivant →</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
