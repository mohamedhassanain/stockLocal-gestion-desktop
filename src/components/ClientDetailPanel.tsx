import React, { useEffect, useState } from 'react';
import { toast } from '../stores/useToastStore';
import type { Customer, ClientCredit } from '../repositories/ClientRepository';

interface ClientDocument {
  id: string;
  type: string;
  document_number: string;
  date: string;
  total_incl_tax: number;
  status: string;
}

const TYPE_LABELS: Record<string, string> = {
  QUOTE: 'Devis',
  DELIVERY_NOTE: 'Bon de livraison',
  INVOICE: 'Facture',
  CREDIT_NOTE: 'Avoir',
};

const STATUS_LABELS: Record<string, string> = {
  PAID: 'Payée',
  UNPAID: 'Impayée',
  PARTIAL: 'Partielle',
  DRAFT: 'Brouillon',
  CANCELLED: 'Annulée',
};

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  PAID: { bg: '#d1fae5', color: '#065f46' },
  UNPAID: { bg: '#fee2e2', color: '#991b1b' },
  PARTIAL: { bg: '#fef3c7', color: '#92400e' },
  CANCELLED: { bg: '#f3f4f6', color: '#6b7280' },
};

interface Props {
  client: Customer;
  onDebt: (amount: number, desc: string) => void;
  onPayment: (amount: number, desc: string) => void;
}

export const ClientDetailPanel: React.FC<Props> = ({ client, onDebt, onPayment }) => {
  const [clientHistory, setClientHistory] = useState<ClientCredit[]>([]);
  const [docs, setDocs] = useState<ClientDocument[]>([]);
  const [amount, setAmount] = useState(0);
  const [desc, setDesc] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'history' | 'documents' | 'due'>('overview');

  const loadData = async () => {
    try {
      const [history, documents] = await Promise.all([
        window.api.clients.getHistory(client.id),
        window.api.clients.getDocuments(client.id),
      ]);
      setClientHistory(history);
      setDocs(documents);
    } catch {
      // silently fail
    }
  };

  useEffect(() => { loadData(); }, [client.id]);

  // Compute stats
  const invoices = docs.filter(d => d.type === 'INVOICE');
  const creditNotes = docs.filter(d => d.type === 'CREDIT_NOTE');
  const totalPurchased = invoices.reduce((sum, d) => sum + d.total_incl_tax, 0);
  const totalCredits = creditNotes.reduce((sum, d) => sum + d.total_incl_tax, 0);
  const totalPaid = clientHistory.filter(h => h.type === 'PAYMENT').reduce((sum, h) => sum + h.amount, 0);
  const balance = client.balance ?? 0;
  const lastInvoice = invoices.length > 0 ? invoices.reduce((latest, d) => d.date > latest.date ? d : latest) : null;
  const unpaidDocs = invoices.filter(d => d.status !== 'PAID' && d.status !== 'CANCELLED');

  const creditUsedPct = client.credit_limit > 0 ? Math.min((balance / client.credit_limit) * 100, 100) : 0;
  const creditColor = creditUsedPct > 80 ? '#ef4444' : creditUsedPct > 50 ? '#f59e0b' : '#10b981';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* ── Balance Card ── */}
      <div style={{ background: 'white', borderRadius: '12px', padding: '20px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '8px' }}>💰 Solde (نسيئة)</div>
        <div style={{ fontSize: '36px', fontWeight: 'bold', color: balance > 0 ? '#ef4444' : '#10b981' }}>
          {balance.toFixed(2)} MAD
        </div>
        {(client.credit_limit ?? 0) > 0 && (
          <div style={{ marginTop: '8px' }}>
            <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
              Plafond : {client.credit_limit.toFixed(2)} MAD ({creditUsedPct.toFixed(0)}% utilisé)
            </div>
            <div style={{ height: '8px', background: '#e5e7eb', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${creditUsedPct}%`, background: creditColor, borderRadius: '4px', transition: 'width 0.3s' }} />
            </div>
          </div>
        )}
      </div>

      {/* ── Quick Actions ── */}
      <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <h3 style={{ marginTop: 0, marginBottom: '12px' }}>⚡ Actions Rapides</h3>
        <input type="number" placeholder="Montant (MAD)" value={amount || ''} onChange={e => setAmount(Number(e.target.value))} style={{ width: '100%', padding: '12px', fontSize: '16px', border: '2px solid #e5e7eb', borderRadius: '8px', marginBottom: '10px', boxSizing: 'border-box' }} />
        <input type="text" placeholder="Description (optionnel)" value={desc} onChange={e => setDesc(e.target.value)} style={{ width: '100%', padding: '12px', fontSize: '14px', border: '2px solid #e5e7eb', borderRadius: '8px', marginBottom: '14px', boxSizing: 'border-box' }} />
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={() => { if (amount > 0) { onDebt(amount, desc); setAmount(0); setDesc(''); } }} style={{ flex: 1, padding: '14px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}>
            + Dette (نسيئة)
          </button>
          <button onClick={() => { if (amount > 0) { onPayment(amount, desc); setAmount(0); setDesc(''); } }} style={{ flex: 1, padding: '14px', background: '#10b981', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}>
            ✓ Encaisser
          </button>
        </div>
      </div>

      {/* ── Stats Summary ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <div style={{ background: 'white', borderRadius: '12px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <div style={{ fontSize: '12px', color: '#6b7280' }}>📦 Total Achat</div>
          <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#0f172a' }}>{totalPurchased.toFixed(2)} MAD</div>
          <div style={{ fontSize: '11px', color: '#9ca3af' }}>{invoices.length} facture(s)</div>
        </div>
        <div style={{ background: 'white', borderRadius: '12px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <div style={{ fontSize: '12px', color: '#6b7280' }}>💰 Total Payé</div>
          <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#10b981' }}>{totalPaid.toFixed(2)} MAD</div>
          <div style={{ fontSize: '11px', color: '#9ca3af' }}>{clientHistory.filter(h => h.type === 'PAYMENT').length} paiement(s)</div>
        </div>
        <div style={{ background: 'white', borderRadius: '12px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <div style={{ fontSize: '12px', color: '#6b7280' }}>🗓️ Dernier Achat</div>
          <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#0f172a' }}>
            {lastInvoice ? new Date(lastInvoice.date).toLocaleDateString('fr-MA') : '—'}
          </div>
        </div>
        <div style={{ background: 'white', borderRadius: '12px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <div style={{ fontSize: '12px', color: '#6b7280' }}>📋 Avoirs</div>
          <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#8b5cf6' }}>{totalCredits.toFixed(2)} MAD</div>
          <div style={{ fontSize: '11px', color: '#9ca3af' }}>{creditNotes.length} avoir(s)</div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: '4px', background: '#f1f5f9', borderRadius: '8px', padding: '4px' }}>
        {([
          { key: 'overview' as const, label: '📋 Vue d\'ensemble' },
          { key: 'documents' as const, label: '📄 Documents' },
          { key: 'due' as const, label: `⏰ Échéances (${unpaidDocs.length})` },
          { key: 'history' as const, label: '📜 Historique' },
        ]).map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            style={{ flex: 1, padding: '10px', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: activeTab === tab.key ? 'bold' : '600', background: activeTab === tab.key ? 'white' : 'transparent', color: activeTab === tab.key ? '#0f172a' : '#6b7280', cursor: 'pointer', boxShadow: activeTab === tab.key ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Export Statement Button ── */}
      <button onClick={() => window.api.clients.exportStatement(client.id).then((r: { success: boolean; error?: string; filePath?: string }) => { if (!r.success) toast.error(r.error || 'Erreur lors de l\'export.'); })} style={{ width: '100%', padding: '12px', background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}>
        📄 Exporter Relevé PDF
      </button>

      {/* ── Tab Content ── */}
      {activeTab === 'overview' && (
        <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h3 style={{ marginTop: 0 }}>📊 Résumé</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
              <span style={{ color: '#6b7280' }}>Catégorie</span>
              <span style={{ fontWeight: 'bold' }}>{client.category}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
              <span style={{ color: '#6b7280' }}>Conditions de paiement</span>
              <span style={{ fontWeight: 'bold' }}>{client.payment_conditions || '—'}</span>
            </div>
            {client.phone && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
              <span style={{ color: '#6b7280' }}>Téléphone</span>
              <span style={{ fontWeight: 'bold' }}>{client.phone}</span>
            </div>}
            {client.address && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
              <span style={{ color: '#6b7280' }}>Adresse</span>
              <span style={{ fontWeight: 'bold' }}>{client.address}</span>
            </div>}
            {client.ice && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
              <span style={{ color: '#6b7280' }}>ICE</span>
              <span style={{ fontWeight: 'bold' }}>{client.ice}</span>
            </div>}
          </div>
        </div>
      )}

      {activeTab === 'documents' && (
        <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h3 style={{ margin: '0 0 15px' }}>📄 Factures & Avoirs</h3>
          {docs.length === 0 ? (
            <div style={{ color: '#9ca3af', textAlign: 'center', padding: '20px' }}>Aucun document pour ce client.</div>
          ) : (
            <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
              {docs.map(doc => {
                const sc = STATUS_COLORS[doc.status] || STATUS_COLORS.UNPAID;
                return (
                  <div key={doc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ padding: '3px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: '700', background: doc.type === 'CREDIT_NOTE' ? '#d1fae5' : '#dbeafe', color: doc.type === 'CREDIT_NOTE' ? '#065f46' : '#1e40af' }}>
                        {TYPE_LABELS[doc.type] ?? doc.type}
                      </span>
                      <span style={{ fontWeight: '600', fontSize: '14px', color: '#111827' }}>{doc.document_number}</span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontWeight: 'bold', color: doc.type === 'CREDIT_NOTE' ? '#10b981' : '#0f172a' }}>
                        {doc.total_incl_tax.toFixed(2)} MAD
                      </span>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', justifyContent: 'flex-end', marginTop: '2px' }}>
                        <span style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: '700', background: sc.bg, color: sc.color }}>
                          {STATUS_LABELS[doc.status] || doc.status}
                        </span>
                        <span style={{ fontSize: '11px', color: '#9ca3af' }}>{doc.date?.split('T')[0]}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'due' && (
        <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h3 style={{ margin: '0 0 15px' }}>⏰ Échéances à venir</h3>
          {unpaidDocs.length === 0 ? (
            <div style={{ color: '#10b981', textAlign: 'center', padding: '20px', fontWeight: '600' }}>✅ Toutes les factures sont réglées.</div>
          ) : (
            unpaidDocs.map(doc => {
              const dueDate = doc.date ? new Date(doc.date) : null;
              const daysLeft = dueDate ? Math.ceil((dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;
              const isOverdue = daysLeft !== null && daysLeft < 0;
              const isUrgent = daysLeft !== null && daysLeft >= 0 && daysLeft <= 7;
              return (
                <div key={doc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
                  <div>
                    <span style={{ fontWeight: '600', fontSize: '14px', color: '#111827' }}>{doc.document_number}</span>
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>{doc.date?.split('T')[0]}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: '700', color: '#ef4444' }}>{doc.total_incl_tax.toFixed(2)} MAD</div>
                    {daysLeft !== null && (
                      <span style={{ padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: '700', background: isOverdue ? '#fee2e2' : isUrgent ? '#fef3c7' : '#f1f5f9', color: isOverdue ? '#991b1b' : isUrgent ? '#92400e' : '#374151' }}>
                        {isOverdue ? `En retard (${Math.abs(daysLeft)}j)` : `J-${daysLeft}`}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h3 style={{ margin: '0 0 15px' }}>📜 Historique des transactions</h3>
          {clientHistory.length === 0 ? (
            <div style={{ color: '#9ca3af', textAlign: 'center', padding: '20px' }}>Aucune transaction pour ce client.</div>
          ) : (
            <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
              {clientHistory.map(h => (
                <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
                  <div>
                    <span style={{ fontWeight: '600', color: h.type === 'CREDIT' ? '#ef4444' : '#10b981', marginRight: '8px' }}>
                      {h.type === 'CREDIT' ? '↑ Dette' : '↓ Paiement'}
                    </span>
                    <span style={{ fontSize: '13px', color: '#6b7280' }}>{h.description}</span>
                  </div>
                  <div style={{ fontWeight: 'bold', color: h.type === 'CREDIT' ? '#ef4444' : '#10b981' }}>
                    {h.type === 'CREDIT' ? '+' : '-'}{h.amount.toFixed(2)} MAD
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
