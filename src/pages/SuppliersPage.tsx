import React, { useEffect, useState } from 'react';
import { useSupplierStore } from '../stores/useSupplierStore';
import type { Supplier } from '../repositories/SupplierRepository';

// ─── Sous-composant : Formulaire de création fournisseur ──────────────────────
const SupplierFormModal: React.FC<{ onClose: () => void; onSave: (data: any) => void }> = ({ onClose, onSave }) => {
  const [form, setForm] = useState({ name: '', phone: '', address: '', ice: '' });
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: 'white', borderRadius: '16px', padding: '32px', width: '480px', boxShadow: '0 25px 50px rgba(0,0,0,0.3)' }}>
        <h2 style={{ marginTop: 0, marginBottom: '24px', color: '#0f172a' }}>🏭 Nouveau Fournisseur</h2>
        {[
          { key: 'name', label: 'Nom *', type: 'text', placeholder: 'Raison sociale du fournisseur' },
          { key: 'phone', label: 'Téléphone', type: 'tel', placeholder: '05XXXXXXXX' },
          { key: 'address', label: 'Adresse', type: 'text', placeholder: 'Ville, région...' },
          { key: 'ice', label: 'ICE', type: 'text', placeholder: 'Identifiant Commun de l\'Entreprise' },
        ].map(({ key, label, type, placeholder }) => (
          <div key={key} style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', color: '#374151' }}>{label}</label>
            <input
              type={type}
              placeholder={placeholder}
              value={(form as any)[key]}
              onChange={e => setForm({ ...form, [key]: e.target.value })}
              style={{ width: '100%', padding: '12px', fontSize: '16px', border: '2px solid #e5e7eb', borderRadius: '8px', boxSizing: 'border-box' }}
            />
          </div>
        ))}
        <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '14px', background: '#f3f4f6', border: 'none', borderRadius: '8px', fontSize: '16px', cursor: 'pointer' }}>Annuler</button>
          <button onClick={() => onSave(form)} style={{ flex: 2, padding: '14px', background: '#7c3aed', color: 'white', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer' }}>Enregistrer</button>
        </div>
      </div>
    </div>
  );
};

// ─── Sous-composant : Fiche Fournisseur ───────────────────────────────────────
const SupplierDetailPanel: React.FC<{ supplier: Supplier; onDebt: (a: number, d: string) => void; onPayment: (a: number, d: string) => void }> = ({ supplier, onDebt, onPayment }) => {
  const { supplierHistory } = useSupplierStore();
  const [amount, setAmount] = useState(0);
  const [desc, setDesc] = useState('');

  const balance = supplier.balance ?? 0;
  const balanceColor = balance > 0 ? '#ef4444' : '#10b981';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Informations */}
      <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <h3 style={{ marginTop: 0, marginBottom: '12px', color: '#7c3aed' }}>Informations</h3>
        {supplier.phone && <div style={{ marginBottom: '6px' }}>📞 {supplier.phone}</div>}
        {supplier.address && <div style={{ marginBottom: '6px' }}>📍 {supplier.address}</div>}
        {supplier.ice && <div style={{ marginBottom: '6px' }}>🏢 ICE: {supplier.ice}</div>}
      </div>

      {/* Solde (dette envers le fournisseur) */}
      <div style={{ background: 'white', borderRadius: '12px', padding: '20px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '8px' }}>Dette envers le fournisseur</div>
        <div style={{ fontSize: '36px', fontWeight: 'bold', color: balanceColor }}>
          {balance.toFixed(2)} MAD
        </div>
      </div>

      {/* Actions Rapides */}
      <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <h3 style={{ marginTop: 0 }}>Action Rapide</h3>
        <input
          type="number"
          placeholder="Montant (MAD)"
          value={amount || ''}
          onChange={e => setAmount(Number(e.target.value))}
          style={{ width: '100%', padding: '12px', fontSize: '16px', border: '2px solid #e5e7eb', borderRadius: '8px', marginBottom: '10px', boxSizing: 'border-box' }}
        />
        <input
          type="text"
          placeholder="Description (optionnel)"
          value={desc}
          onChange={e => setDesc(e.target.value)}
          style={{ width: '100%', padding: '12px', fontSize: '14px', border: '2px solid #e5e7eb', borderRadius: '8px', marginBottom: '14px', boxSizing: 'border-box' }}
        />
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={() => { if (amount > 0) { onDebt(amount, desc); setAmount(0); setDesc(''); } }}
            style={{ flex: 1, padding: '16px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: 'bold', cursor: 'pointer' }}>
            + Achat à crédit
          </button>
          <button
            onClick={() => { if (amount > 0) { onPayment(amount, desc); setAmount(0); setDesc(''); } }}
            style={{ flex: 1, padding: '16px', background: '#10b981', color: 'white', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: 'bold', cursor: 'pointer' }}>
            ✓ Payer fournisseur
          </button>
        </div>
      </div>

      {/* Historique */}
      <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <h3 style={{ marginTop: 0 }}>Historique des transactions</h3>
        {supplierHistory.length === 0 ? (
          <div style={{ color: '#9ca3af', textAlign: 'center', padding: '20px' }}>Aucune transaction pour ce fournisseur.</div>
        ) : (
          <div style={{ maxHeight: '280px', overflowY: 'auto' }}>
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
    </div>
  );
};

// ─── Page Principale Fournisseurs ─────────────────────────────────────────────
export const SuppliersPage: React.FC = () => {
  const { suppliers, selectedSupplier, searchQuery, isLoading, setSearchQuery, loadSuppliers, selectSupplier, createSupplier, addDebt, addPayment } = useSupplierStore();
  const [showForm, setShowForm] = useState(false);

  useEffect(() => { loadSuppliers(); }, []);

  const handleSaveSupplier = async (data: any) => {
    try {
      await createSupplier(data);
      setShowForm(false);
    } catch (e: any) {
      alert(e.message);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#f8fafc', height: '100vh', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '24px 30px 16px', borderBottom: '1px solid #e5e7eb', background: 'white', display: 'flex', alignItems: 'center', gap: '16px' }}>
        <h1 style={{ margin: 0, fontSize: '28px', color: '#0f172a', flex: 1 }}>🏭 Fournisseurs</h1>
        <button onClick={() => setShowForm(true)} style={{ padding: '12px 24px', background: '#7c3aed', color: 'white', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer' }}>
          + Nouveau Fournisseur
        </button>
      </div>

      {/* Barre de recherche */}
      <div style={{ padding: '16px 30px', background: 'white', borderBottom: '1px solid #e5e7eb' }}>
        <input
          type="text"
          placeholder="Rechercher par nom ou téléphone..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{ width: '100%', padding: '14px 18px', fontSize: '18px', border: '2px solid #e5e7eb', borderRadius: '10px', outline: 'none', boxSizing: 'border-box' }}
          autoFocus
        />
      </div>

      {/* Contenu */}
      <div style={{ flex: 1, display: 'flex', gap: '0', overflow: 'hidden' }}>
        {/* Liste des fournisseurs */}
        <div style={{ width: '380px', borderRight: '1px solid #e5e7eb', overflowY: 'auto', background: 'white' }}>
          {isLoading && <div style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>Chargement...</div>}
          {suppliers.length === 0 && !isLoading && (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: '#9ca3af' }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>🏭</div>
              <div>Aucun fournisseur trouvé. Créez-en un nouveau.</div>
            </div>
          )}
          {suppliers.map(supplier => {
            const balance = supplier.balance ?? 0;
            const isSelected = selectedSupplier?.id === supplier.id;
            return (
              <div
                key={supplier.id}
                onClick={() => selectSupplier(supplier)}
                style={{
                  padding: '16px 20px',
                  cursor: 'pointer',
                  borderBottom: '1px solid #f1f5f9',
                  background: isSelected ? '#f5f3ff' : 'transparent',
                  borderLeft: isSelected ? '4px solid #7c3aed' : '4px solid transparent',
                  transition: 'all 0.15s'
                }}
              >
                <div style={{ fontWeight: isSelected ? 'bold' : '600', fontSize: '16px', color: '#111827' }}>{supplier.name}</div>
                <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '2px' }}>{supplier.phone || 'Pas de téléphone'}</div>
                <div style={{ fontSize: '15px', fontWeight: 'bold', marginTop: '6px', color: balance > 0 ? '#ef4444' : '#10b981' }}>
                  {balance > 0 ? `Doit : ${balance.toFixed(2)} MAD` : '✓ Soldé'}
                </div>
              </div>
            );
          })}
        </div>

        {/* Détail fournisseur */}
        <div style={{ flex: 1, padding: '24px', overflowY: 'auto' }}>
          {!selectedSupplier ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#9ca3af', fontSize: '18px' }}>
              ← Sélectionnez un fournisseur pour voir les détails
            </div>
          ) : (
            <>
              <h2 style={{ marginTop: 0, marginBottom: '20px', color: '#0f172a' }}>{selectedSupplier.name}</h2>
              <SupplierDetailPanel
                supplier={selectedSupplier}
                onDebt={(a, d) => addDebt(selectedSupplier.id, a, d).catch(e => alert(e.message))}
                onPayment={(a, d) => addPayment(selectedSupplier.id, a, d).catch(e => alert(e.message))}
              />
            </>
          )}
        </div>
      </div>

      {showForm && <SupplierFormModal onClose={() => setShowForm(false)} onSave={handleSaveSupplier} />}
    </div>
  );
};
