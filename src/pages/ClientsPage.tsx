import React, { useEffect, useState } from 'react';
import { useClientStore } from '../stores/useClientStore';
import { ClientDetailPanel } from '../components/ClientDetailPanel';
import { toast } from '../stores/useToastStore';
import type { Customer } from '../repositories/ClientRepository';

// ─── Sous-composant : Formulaire de création client ──────────────────────────
const ClientFormModal: React.FC<{ initial?: Customer; onClose: () => void; onSave: (data: any) => void }> = ({ initial, onClose, onSave }) => {
  const [form, setForm] = useState(() =>
    initial
      ? { name: initial.name, phone: initial.phone ?? '', address: initial.address ?? '', ice: initial.ice ?? '', payment_conditions: initial.payment_conditions ?? 'Comptant', credit_limit: initial.credit_limit ?? 0, category: initial.category ?? 'DÉTAIL' }
      : { name: '', phone: '', address: '', ice: '', payment_conditions: 'Comptant', credit_limit: 0, category: 'DÉTAIL' });
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: 'white', borderRadius: '16px', padding: '32px', width: '480px', boxShadow: '0 25px 50px rgba(0,0,0,0.3)' }}>
        <h2 style={{ marginTop: 0, marginBottom: '24px', color: '#0f172a' }}>{initial ? '✏️ Modifier le Client' : 'Nouveau Client'}</h2>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', color: '#374151' }}>Catégorie *</label>
          <select
            value={form.category}
            onChange={e => setForm({ ...form, category: e.target.value })}
            style={{ width: '100%', padding: '12px', fontSize: '16px', border: '2px solid #e5e7eb', borderRadius: '8px', boxSizing: 'border-box' }}
          >
            <option value="DÉTAIL">Détail</option>
            <option value="GROSSISTE">Grossiste</option>
            <option value="VIP">VIP</option>
          </select>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', color: '#374151' }}>Conditions de paiement</label>
          <select
            value={form.payment_conditions}
            onChange={e => setForm({ ...form, payment_conditions: e.target.value })}
            style={{ width: '100%', padding: '12px', fontSize: '16px', border: '2px solid #e5e7eb', borderRadius: '8px', boxSizing: 'border-box' }}
          >
            <option value="Comptant">Comptant</option>
            <option value="7 jours">7 jours</option>
            <option value="15 jours">15 jours</option>
            <option value="30 jours">30 jours</option>
            <option value="45 jours">45 jours</option>
            <option value="60 jours">60 jours</option>
          </select>
        </div>

        {[
          { key: 'name', label: 'Nom *', type: 'text', placeholder: 'Nom complet ou raison sociale' },
          { key: 'phone', label: 'Téléphone', type: 'tel', placeholder: '06XXXXXXXX' },
          { key: 'address', label: 'Adresse', type: 'text', placeholder: 'Ville, quartier...' },
          { key: 'ice', label: 'ICE', type: 'text', placeholder: "Identifiant commun de l'entreprise" },
          { key: 'credit_limit', label: 'Plafond crédit (MAD)', type: 'number', placeholder: '0 = illimité' },
        ].map(({ key, label, type, placeholder }) => (
          <div key={key} style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', color: '#374151' }}>{label}</label>
            <input
              type={type}
              placeholder={placeholder}
              value={(form as any)[key]}
              onChange={e => setForm({ ...form, [key]: key === 'credit_limit' ? Number(e.target.value) : e.target.value })}
              style={{ width: '100%', padding: '12px', fontSize: '16px', border: '2px solid #e5e7eb', borderRadius: '8px', boxSizing: 'border-box' }}
            />
          </div>
        ))}
        <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '14px', background: '#f3f4f6', border: 'none', borderRadius: '8px', fontSize: '16px', cursor: 'pointer' }}>Annuler</button>
          <button onClick={() => onSave(form)} style={{ flex: 2, padding: '14px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer' }}>Enregistrer</button>
        </div>
      </div>
    </div>
  );
};

// ─── Page Principale Clients ─────────────────────────────────────────────────
export const ClientsPage: React.FC = () => {
  const { clients, selectedClient, searchQuery, isLoading, setSearchQuery, loadClients, selectClient, createClient, updateClient, deleteClient, addDebt, addPayment } = useClientStore();
  const [modalState, setModalState] = useState<{ mode: 'create' } | { mode: 'edit'; client: Customer } | null>(null);

  useEffect(() => { loadClients(); }, []);

  const handleSaveForm = async (data: any) => {
    try {
      if (modalState?.mode === 'edit' && modalState.client) {
        await updateClient(modalState.client.id, data);
        toast.success('Client mis à jour.');
      } else {
        await createClient(data);
        toast.success('Client créé.');
      }
      setModalState(null);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    const ok = window.confirm('Supprimer le client « ' + name + ' » ? Cette action est irréversible.');
    if (!ok) return;
    try {
      await deleteClient(id);
      toast.success(`Client « ${name} » supprimé.`);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#f8fafc', height: '100vh', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '24px 30px 16px', borderBottom: '1px solid #e5e7eb', background: 'white', display: 'flex', alignItems: 'center', gap: '16px' }}>
        <h1 style={{ margin: 0, fontSize: '28px', color: '#0f172a', flex: 1 }}>🤝 Clients & Crédits (نسيئة)</h1>
        <button onClick={() => setModalState({ mode: 'create' })} style={{ padding: '12px 24px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer' }}>
          + Nouveau Client
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
        {/* Liste des clients */}
        <div style={{ width: '380px', borderRight: '1px solid #e5e7eb', overflowY: 'auto', background: 'white' }}>
          {isLoading && <div style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>Chargement...</div>}
          {clients.length === 0 && !isLoading && (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: '#9ca3af' }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>🤝</div>
              <div>Aucun client trouvé. Créez-en un nouveau.</div>
            </div>
          )}
          {clients.map(client => {
            const balance = client.balance ?? 0;
            const isSelected = selectedClient?.id === client.id;
            return (
              <div
                key={client.id}
                onClick={() => selectClient(client)}
                style={{
                  padding: '16px 20px',
                  cursor: 'pointer',
                  borderBottom: '1px solid #f1f5f9',
                  background: isSelected ? '#eff6ff' : 'transparent',
                  borderLeft: isSelected ? '4px solid #3b82f6' : '4px solid transparent',
                  transition: 'all 0.15s'
                }}
              >
                <div style={{ fontWeight: isSelected ? 'bold' : '600', fontSize: '16px', color: '#111827' }}>{client.name}</div>
                <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '2px' }}>{client.phone || 'Pas de téléphone'}</div>
                <div style={{ fontSize: '15px', fontWeight: 'bold', marginTop: '6px', color: balance > 0 ? '#ef4444' : '#10b981' }}>
                  {balance > 0 ? `Dette : ${balance.toFixed(2)} MAD` : '✓ Réglé'}
                </div>
              </div>
            );
          })}
        </div>

        {/* Détail client */}
        <div style={{ flex: 1, padding: '24px', overflowY: 'auto' }}>
          {!selectedClient ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#9ca3af', fontSize: '18px' }}>
              ← Sélectionnez un client pour voir les détails
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
                <h2 style={{ margin: 0, color: '#0f172a' }}>{selectedClient.name}</h2>
                <span style={{ padding: '4px 8px', background: '#e0e7ff', color: '#4338ca', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold' }}>
                  {selectedClient.category}
                </span>
                <div style={{ flex: 1 }} />
                <button onClick={() => setModalState({ mode: 'edit', client: selectedClient })}
                  style={{ padding: '10px 18px', background: '#f59e0b', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}>
                  ✏️ Modifier
                </button>
                <button onClick={() => handleDelete(selectedClient.id, selectedClient.name)}
                  style={{ padding: '10px 18px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}>
                  🗑️ Supprimer
                </button>
              </div>
              <ClientDetailPanel
                client={selectedClient}
                onDebt={(a: number, d: string) => addDebt(selectedClient.id, a, d).catch((e: any) => toast.error(e.message))}
                onPayment={(a: number, d: string) => addPayment(selectedClient.id, a, d).catch((e: any) => toast.error(e.message))}
              />
            </>
          )}
        </div>
      </div>

      {modalState && (<ClientFormModal initial={modalState.mode === 'edit' ? modalState.client : undefined} onClose={() => setModalState(null)} onSave={handleSaveForm} />)}
    </div>
  );
};
