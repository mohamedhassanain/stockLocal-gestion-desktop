import React, { useEffect, useMemo, useState } from 'react';
import { toast } from '../stores/useToastStore';
import { Button, Card, CardFooter, CardHeader, PageHeader, StatCard } from '../components/ui';
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
    <div className="page-shell">
      <PageHeader
        title="Caisse"
        subtitle="Suivi des encaissements par mode de paiement"
        actions={<Button variant="ghost" onClick={load}>Actualiser</Button>}
      />

      <div className="page-content">
        <div className="stat-grid">
          <StatCard label="Espèces" value={`${totals.cash.toFixed(2)} MAD`} tone="success" />
          <StatCard label="Chèques" value={`${totals.check.toFixed(2)} MAD`} tone="warning" />
          <StatCard label="Virements" value={`${totals.transfer.toFixed(2)} MAD`} tone="info" />
          <StatCard label="Total encaissé" value={`${totals.total.toFixed(2)} MAD`} tone="primary" />
        </div>

        <Card overflow>
          <CardHeader>
            <h3 style={{ margin: 0 }}>Journal de caisse</h3>
            <span className="text-sm text-muted">{payments.length} encaissement(s)</span>
          </CardHeader>
          {isLoading ? (
            <div className="card-body flex gap-3" style={{ flexDirection: 'column' }}>
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
                    <th className="text-right">Montant</th>
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
                          <span className="font-semibold">{p.document_number}</span>
                        </td>
                        <td>{p.customer_name ?? '—'}</td>
                        <td>{METHOD_LABELS[p.payment_method] ?? p.payment_method}</td>
                        <td className="money text-right font-semibold text-success">{p.amount.toFixed(2)} MAD</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {pageCount > 1 && (
            <CardFooter>
              <Button variant="secondary" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Précédent</Button>
              <span className="text-sm text-muted" style={{ alignSelf: 'center' }}>Page {page + 1} / {pageCount}</span>
              <Button variant="secondary" disabled={page >= pageCount - 1} onClick={() => setPage(p => p + 1)}>Suivant →</Button>
            </CardFooter>
          )}
        </Card>
      </div>
    </div>
  );
};
