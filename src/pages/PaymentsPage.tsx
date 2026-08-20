import React, { useEffect, useState } from 'react';
import { useClientStore } from '../stores/useClientStore';
import { toast } from '../stores/useToastStore';

interface PaymentRecordUI {
  id: string;
  document_id: string;
  amount: number;
  payment_method: string;
  date: string;
  document_number: string;
  document_type: string;
  customer_name?: string;
  reference?: string | null;
}

interface DebtorRow {
  id: string;
  name: string;
  balance: number;
  totalDocs: number;
  unpaidDocs: number;
}

const PAGE_SIZE = 50;

export const PaymentsPage: React.FC = () => {
  const { clients } = useClientStore();

  const [payments, setPayments] = useState<PaymentRecordUI[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(0);

  const loadPayments = async () => {
    setIsLoading(true);
    try {
      const data = await window.api.documents.getAllPayments({ limit: 500, offset: 0 });
      setPayments(data ?? []);
    } catch (e: any) {
      toast.error(`Impossible de charger les paiements : ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { loadPayments(); }, []);

  // Synthèse : clients ayant un solde impayé.
  const debtors: DebtorRow[] = (clients ?? [])
    .filter((c: any) => (c.balance ?? 0) > 0)
    .map((c: any) => ({
      id: c.id,
      name: c.name,
      balance: c.balance ?? 0,
      totalDocs: 0,
      unpaidDocs: 0,
    }));

  const pageCount = Math.max(1, Math.ceil(payments.length / PAGE_SIZE));
  const visible = payments.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const totalCollected = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg)', height: '100vh', overflow: 'hidden' }}>
      <div className="page-header">
        <div>
          <h1>Paiements</h1>
          <div style={{ color: 'var(--muted)', marginTop: 4, fontSize: 13 }}>
            Encaissements enregistrés sur les factures et avoirs
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span className="money" style={{ fontWeight: 700, color: 'var(--success)' }}>Total : {totalCollected.toFixed(2)} MAD</span>
          <button className="btn btn-ghost" onClick={loadPayments}>Actualiser</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Synthèse clients débiteurs */}
        <div className="card" style={{ padding: '16px 18px' }}>
          <h3 style={{ margin: '0 0 12px' }}>Clients avec solde impayé</h3>
          {debtors.length === 0 ? (
            <div className="text-sm text-success" style={{ fontWeight: 600 }}>Tous les clients ont un solde réglé.</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {debtors.slice(0, 10).map((d) => (
                <span key={d.id} className="badge badge-danger" style={{ padding: '6px 14px', fontSize: 12 }}>
                  {d.name} : {d.balance.toFixed(2)} MAD
                </span>
              ))}
              {debtors.length > 10 && (
                <span className="badge badge-muted" style={{ padding: '6px 14px', fontSize: 12 }}>
                  +{debtors.length - 10} autre(s)
                </span>
              )}
            </div>
          )}
        </div>

        {/* Registre des paiements */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>Registre des encaissements</h3>
            <span className="text-sm text-muted">{payments.length} paiement(s)</span>
          </div>
          {isLoading ? (
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton skeleton-row" />)}
            </div>
          ) : payments.length === 0 ? (
            <div className="state-box">
              <div className="state-text">Aucun paiement enregistré.</div>
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
                    <th>Référence</th>
                    <th style={{ textAlign: 'right' }}>Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => (
                    <tr key={p.id}>
                      <td className="text-sm" style={{ whiteSpace: 'nowrap' }}>{new Date(p.date).toLocaleDateString('fr-MA')}</td>
                      <td style={{ fontWeight: 600 }}>{p.document_number}</td>
                      <td>{p.customer_name ?? '—'}</td>
                      <td>
                        <span className="badge badge-muted">{p.payment_method}</span>
                      </td>
                      <td className="text-sm text-muted">{p.reference || '—'}</td>
                      <td className="money" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--success)' }}>{p.amount.toFixed(2)} MAD</td>
                    </tr>
                  ))}
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
