import React, { useEffect, useState } from 'react';
import type { Supplier, SupplierCredit } from '../repositories/SupplierRepository';

const STATUS_LABELS: Record<string, string> = {
  PAID: 'Payée',
  UNPAID: 'Impayée',
  PARTIAL: 'Partielle',
  RECEIVED: 'Réceptionnée',
  CONFIRMED: 'Confirmée',
  DRAFT: 'Brouillon',
  CANCELLED: 'Annulée',
};

interface Props {
  supplier: Supplier;
  onDebt: (amount: number, desc: string) => void;
  onPayment: (amount: number, desc: string) => void;
}

export const SupplierDetailPanel: React.FC<Props> = ({ supplier, onDebt, onPayment }) => {
  const [supplierHistory, setSupplierHistory] = useState<SupplierCredit[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [amount, setAmount] = useState(0);
  const [desc, setDesc] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'history' | 'purchases'>('overview');

  const loadData = async () => {
    try {
      const [history, purchaseList] = await Promise.all([
        window.api.suppliers.getHistory(supplier.id),
        window.api.purchases.getAll(),
      ]);
      setSupplierHistory(history);
      setPurchases(purchaseList.filter((p: any) => p.supplier_id === supplier.id));
    } catch {
      // silently fail
    }
  };

  useEffect(() => { loadData(); }, [supplier.id]);

  const balance = supplier.balance ?? 0;
  const totalDebt = supplierHistory.filter(h => h.type === 'DEBT').reduce((sum, h) => sum + h.amount, 0);
  const totalPaid = supplierHistory.filter(h => h.type === 'PAYMENT').reduce((sum, h) => sum + h.amount, 0);
  const lastDebt = supplierHistory.find(h => h.type === 'DEBT');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* ── Info Card ── */}
      <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <h3 style={{ marginTop: 0, marginBottom: '12px', color: '#7c3aed' }}>📋 Informations</h3>
        {supplier.phone && <div style={{ marginBottom: '6px' }}>📞 {supplier.phone}</div>}
        {supplier.address && <div style={{ marginBottom: '6px' }}>📍 {supplier.address}</div>}
        {supplier.ice && <div style={{ marginBottom: '6px' }}>🏢 ICE: {supplier.ice}</div>}
      </div>

      {/* ── Balance Card ── */}
      <div style={{ background: 'white', borderRadius: '12px', padding: '20px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '8px' }}>💰 Dette envers le fournisseur</div>
        <div style={{ fontSize: '36px', fontWeight: 'bold', color: balance > 0 ? '#ef4444' : '#10b981' }}>
          {balance.toFixed(2)} MAD
        </div>
      </div>

      {/* ── Stats Summary ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <div style={{ background: 'white', borderRadius: '12px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <div style={{ fontSize: '12px', color: '#6b7280' }}>📦 Total Achats (crédit)</div>
          <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#0f172a' }}>{totalDebt.toFixed(2)} MAD</div>
        </div>
        <div style={{ background: 'white', borderRadius: '12px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <div style={{ fontSize: '12px', color: '#6b7280' }}>💰 Total Payé</div>
          <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#10b981' }}>{totalPaid.toFixed(2)} MAD</div>
        </div>
        <div style={{ background: 'white', borderRadius: '12px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <div style={{ fontSize: '12px', color: '#6b7280' }}>🗓️ Dernier Achat</div>
          <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#0f172a' }}>
            {lastDebt ? new Date(lastDebt.date).toLocaleDateString('fr-MA') : '—'}
          </div>
        </div>
        <div style={{ background: 'white', borderRadius: '12px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <div style={{ fontSize: '12px', color: '#6b7280' }}>📋 Commandes</div>
          <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#7c3aed' }}>{purchases.length}</div>
        </div>
      </div>

      {/* ── Quick Actions ── */}
      <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <h3 style={{ marginTop: 0, marginBottom: '12px' }}>⚡ Actions Rapides</h3>
        <input type="number" placeholder="Montant (MAD)" value={amount || ''} onChange={e => setAmount(Number(e.target.value))} style={{ width: '100%', padding: '12px', fontSize: '16px', border: '2px solid #e5e7eb', borderRadius: '8px', marginBottom: '10px', boxSizing: 'border-box' }} />
        <input type="text" placeholder="Description (optionnel)" value={desc} onChange={e => setDesc(e.target.value)} style={{ width: '100%', padding: '12px', fontSize: '14px', border: '2px solid #e5e7eb', borderRadius: '8px', marginBottom: '14px', boxSizing: 'border-box' }} />
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={() => { if (amount > 0) { onDebt(amount, desc); setAmount(0); setDesc(''); } }} style={{ flex: 1, padding: '14px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}>
            + Achat à crédit
          </button>
          <button onClick={() => { if (amount > 0) { onPayment(amount, desc); setAmount(0); setDesc(''); } }} style={{ flex: 1, padding: '14px', background: '#10b981', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}>
            ✓ Payer fournisseur
          </button>
        </div>
      </div>

      {/* ── Export Button ── */}
      <button onClick={() => window.api.suppliers.exportStatement(supplier.id).then((r: { success: boolean; error?: string }) => { if (!r.success) alert(r.error); })} style={{ width: '100%', padding: '12px', background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}>
        📄 Exporter Relevé PDF
      </button>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: '4px', background: '#f1f5f9', borderRadius: '8px', padding: '4px' }}>
        {([
          { key: 'overview' as const, label: '📋 Vue d\'ensemble' },
          { key: 'purchases' as const, label: `🛒 Commandes (${purchases.length})` },
          { key: 'history' as const, label: '📜 Historique' },
        ]).map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            style={{ flex: 1, padding: '10px', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: activeTab === tab.key ? 'bold' : '600', background: activeTab === tab.key ? 'white' : 'transparent', color: activeTab === tab.key ? '#0f172a' : '#6b7280', cursor: 'pointer', boxShadow: activeTab === tab.key ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Tab Content ── */}
      {activeTab === 'overview' && (
        <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h3 style={{ marginTop: 0 }}>📊 Résumé</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {supplier.phone && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
              <span style={{ color: '#6b7280' }}>Téléphone</span>
              <span style={{ fontWeight: 'bold' }}>{supplier.phone}</span>
            </div>}
            {supplier.address && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
              <span style={{ color: '#6b7280' }}>Adresse</span>
              <span style={{ fontWeight: 'bold' }}>{supplier.address}</span>
            </div>}
            {supplier.ice && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
              <span style={{ color: '#6b7280' }}>ICE</span>
              <span style={{ fontWeight: 'bold' }}>{supplier.ice}</span>
            </div>}
          </div>
        </div>
      )}

      {activeTab === 'purchases' && (
        <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h3 style={{ margin: '0 0 15px' }}>🛒 Commandes d'achat</h3>
          {purchases.length === 0 ? (
            <div style={{ color: '#9ca3af', textAlign: 'center', padding: '20px' }}>Aucune commande pour ce fournisseur.</div>
          ) : (
            <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
              {purchases.map((p: any) => (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
                  <div>
                    <span style={{ fontWeight: '600', fontSize: '14px', color: '#111827' }}>{p.order_number}</span>
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>{p.date?.split('T')[0]}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 'bold' }}>{p.total?.toFixed(2)} MAD</div>
                    <span style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: '700', background: p.status === 'RECEIVED' ? '#d1fae5' : '#fef3c7', color: p.status === 'RECEIVED' ? '#065f46' : '#92400e' }}>
                      {STATUS_LABELS[p.status] || p.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h3 style={{ margin: '0 0 15px' }}>📜 Historique des transactions</h3>
          {supplierHistory.length === 0 ? (
            <div style={{ color: '#9ca3af', textAlign: 'center', padding: '20px' }}>Aucune transaction pour ce fournisseur.</div>
          ) : (
            <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
              {supplierHistory.map(h => (
                <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
                  <div>
                    <span style={{ fontWeight: '600', color: h.type === 'DEBT' ? '#ef4444' : '#10b981', marginRight: '8px' }}>
                      {h.type === 'DEBT' ? '↑ Achat' : '↓ Paiement'}
                    </span>
                    <span style={{ fontSize: '13px', color: '#6b7280' }}>{h.description}</span>
                  </div>
                  <div style={{ fontWeight: 'bold', color: h.type === 'DEBT' ? '#ef4444' : '#10b981' }}>
                    {h.type === 'DEBT' ? '+' : '-'}{h.amount.toFixed(2)} MAD
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
