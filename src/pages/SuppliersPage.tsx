import React, { useEffect, useState } from 'react';
import { useSupplierStore } from '../stores/useSupplierStore';
import { SupplierDetailPanel } from '../components/SupplierDetailPanel';
import { toast } from '../stores/useToastStore';
import type { Supplier } from '../repositories/SupplierRepository';

// ─── Sous-composant : Formulaire de création fournisseur ──────────────────────
const SupplierFormModal: React.FC<{ initial?: Supplier; onClose: () => void; onSave: (data: any) => void }> = ({ initial, onClose, onSave }) => {
  const [form, setForm] = useState(() =>
    initial
      ? { name: initial.name, phone: initial.phone ?? '', address: initial.address ?? '', ice: initial.ice ?? '' }
      : { name: '', phone: '', address: '', ice: '' });
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: 'white', borderRadius: '16px', padding: '32px', width: '480px', boxShadow: '0 25px 50px rgba(0,0,0,0.3)' }}>
        <h2 style={{ marginTop: 0, marginBottom: '24px', color: '#0f172a' }}>{initial ? '✏️ Modifier le Fournisseur' : '🏭 Nouveau Fournisseur'}</h2>
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

// ─── Page Principale Fournisseurs ─────────────────────────────────────────────
export const SuppliersPage: React.FC = () => {
  const { suppliers, selectedSupplier, searchQuery, isLoading, setSearchQuery, loadSuppliers, selectSupplier, createSupplier, updateSupplier, deleteSupplier, addDebt, addPayment } = useSupplierStore();
  const [modalState, setModalState] = useState<{ mode: 'create' } | { mode: 'edit'; supplier: Supplier } | null>(null);

  useEffect(() => { loadSuppliers(); }, []);

  const handleSaveForm = async (data: any) => {
    try {
      if (modalState?.mode === 'edit' && modalState.supplier) {
        await updateSupplier(modalState.supplier.id, data);
        toast.success('Fournisseur mis à jour.');
      } else {
        await createSupplier(data);
        toast.success('Fournisseur créé.');
      }
      setModalState(null);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    const ok = window.confirm('Supprimer le fournisseur « ' + name + ' » ? Cette action est irréversible.');
    if (!ok) return;
    try {
      await deleteSupplier(id);
      toast.success(`Fournisseur « ${name} » supprimé.`);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#f8fafc', height: '100vh', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '24px 30px 16px', borderBottom: '1px solid #e5e7eb', background: 'white', display: 'flex', alignItems: 'center', gap: '16px' }}>
        <h1 style={{ margin: 0, fontSize: '28px', color: '#0f172a', flex: 1 }}>🏭 Fournisseurs</h1>
        <button onClick={() => setModalState({ mode: 'create' })} style={{ padding: '12px 24px', background: '#7c3aed', color: 'white', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer' }}>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
                <h2 style={{ margin: 0, color: '#0f172a' }}>{selectedSupplier.name}</h2>
                <div style={{ flex: 1 }} />
                <button onClick={() => setModalState({ mode: 'edit', supplier: selectedSupplier })}
                  style={{ padding: '10px 18px', background: '#f59e0b', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}>
                  ✏️ Modifier
                </button>
                <button onClick={() => handleDelete(selectedSupplier.id, selectedSupplier.name)}
                  style={{ padding: '10px 18px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}>
                  🗑️ Supprimer
                </button>
              </div>
              <SupplierDetailPanel
                supplier={selectedSupplier}
                onDebt={(a: number, d: string) => addDebt(selectedSupplier.id, a, d).catch((e: any) => toast.error(e.message))}
                onPayment={(a: number, d: string) => addPayment(selectedSupplier.id, a, d).catch((e: any) => toast.error(e.message))}
              />
            </>
          )}
        </div>
      </div>

      {modalState && (<SupplierFormModal initial={modalState.mode === 'edit' ? modalState.supplier : undefined} onClose={() => setModalState(null)} onSave={handleSaveForm} />)}
    </div>
  );
};
