import React, { useEffect, useState } from 'react';
import { useClientStore } from '../stores/useClientStore';
import { ClientDetailPanel } from '../components/ClientDetailPanel';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { toast } from '../stores/useToastStore';
import type { Customer } from '../repositories/ClientRepository';
import { Button, Badge, Input, Select, PageHeader, Modal, ModalHeader, ModalBody, ModalFooter } from '../components/ui';

const ClientFormModal: React.FC<{ initial?: Customer; onClose: () => void; onSave: (data: any) => void }> = ({ initial, onClose, onSave }) => {
  const [form, setForm] = useState(() =>
    initial
      ? { name: initial.name, phone: initial.phone ?? '', address: initial.address ?? '', ice: initial.ice ?? '', payment_conditions: initial.payment_conditions ?? 'Comptant', credit_limit: initial.credit_limit ?? 0, category: initial.category ?? 'DÉTAIL' }
      : { name: '', phone: '', address: '', ice: '', payment_conditions: 'Comptant', credit_limit: 0, category: 'DÉTAIL' });

  return (
    <Modal open onClose={onClose} width={480}>
      <ModalHeader title={initial ? '✏️ Modifier le Client' : 'Nouveau Client'} />
      <ModalBody>
        <Select
          label="Catégorie *"
          value={form.category}
          onChange={e => setForm({ ...form, category: e.target.value })}
        >
          <option value="DÉTAIL">Détail</option>
          <option value="GROSSISTE">Grossiste</option>
          <option value="VIP">VIP</option>
        </Select>

        <Select
          label="Conditions de paiement"
          value={form.payment_conditions}
          onChange={e => setForm({ ...form, payment_conditions: e.target.value })}
        >
          <option value="Comptant">Comptant</option>
          <option value="7 jours">7 jours</option>
          <option value="15 jours">15 jours</option>
          <option value="30 jours">30 jours</option>
          <option value="45 jours">45 jours</option>
          <option value="60 jours">60 jours</option>
        </Select>

        {[
          { key: 'name', label: 'Nom *', type: 'text', placeholder: 'Nom complet ou raison sociale' },
          { key: 'phone', label: 'Téléphone', type: 'tel', placeholder: '06XXXXXXXX' },
          { key: 'address', label: 'Adresse', type: 'text', placeholder: 'Ville, quartier...' },
          { key: 'ice', label: 'ICE', type: 'text', placeholder: "Identifiant commun de l'entreprise" },
          { key: 'credit_limit', label: 'Plafond crédit (MAD)', type: 'number', placeholder: '0 = illimité' },
        ].map(({ key, label, type, placeholder }) => (
          <Input
            key={key}
            label={label}
            type={type}
            placeholder={placeholder}
            value={(form as any)[key]}
            onChange={e => setForm({ ...form, [key]: key === 'credit_limit' ? Number(e.target.value) : e.target.value })}
          />
        ))}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Annuler</Button>
        <Button variant="primary" onClick={() => onSave(form)}>Enregistrer</Button>
      </ModalFooter>
    </Modal>
  );
};

export const ClientsPage: React.FC = () => {
  const { clients, selectedClient, searchQuery, isLoading, setSearchQuery, loadClients, selectClient, createClient, updateClient, deleteClient, addDebt, addPayment } = useClientStore();
  const [modalState, setModalState] = useState<{ mode: 'create' } | { mode: 'edit'; client: Customer } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

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

  const confirmDeleteClient = async () => {
    if (!deleteTarget) return;
    const { id, name } = deleteTarget;
    try {
      await deleteClient(id);
      toast.success(`Client « ${name} » supprimé.`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="page-shell">
      <PageHeader
        title="🤝 Clients & Crédits (نسيئة)"
        actions={
          <Button variant="primary" onClick={() => setModalState({ mode: 'create' })}>
            + Nouveau Client
          </Button>
        }
      />

      <div style={{ padding: '16px 28px', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        <input
          type="text"
          className="input input-lg w-full"
          placeholder="Rechercher par nom ou téléphone..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          autoFocus
        />
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ width: 380, borderRight: '1px solid var(--border)', overflowY: 'auto', background: 'var(--surface)' }}>
          {isLoading && <div className="text-muted" style={{ padding: 20, textAlign: 'center' }}>Chargement...</div>}
          {clients.length === 0 && !isLoading && (
            <div className="state-box">
              <div className="state-icon">🤝</div>
              <div className="state-text">Aucun client trouvé. Créez-en un nouveau.</div>
            </div>
          )}
          {clients.map(client => {
            const balance = client.balance ?? 0;
            const isSelected = selectedClient?.id === client.id;
            return (
              <div
                key={client.id}
                onClick={() => selectClient(client)}
                className={isSelected ? 'list-item list-item-selected' : 'list-item'}
                style={{
                  borderRadius: 0,
                  border: 'none',
                  borderBottom: '1px solid var(--border)',
                  borderLeft: isSelected ? '4px solid var(--primary)' : '4px solid transparent',
                  marginBottom: 0,
                }}
              >
                <div style={{ fontWeight: isSelected ? 700 : 600, fontSize: 16 }}>{client.name}</div>
                <div className="text-sm text-muted" style={{ marginTop: 2 }}>{client.phone || 'Pas de téléphone'}</div>
                <div className={`text-sm font-semibold ${balance > 0 ? 'text-danger' : 'text-success'}`} style={{ marginTop: 6 }}>
                  {balance > 0 ? `Dette : ${balance.toFixed(2)} MAD` : '✓ Réglé'}
                </div>
              </div>
            );
          })}
        </div>

        <div className="page-content">
          {!selectedClient ? (
            <div className="state-box" style={{ height: '100%' }}>
              <div className="state-text">← Sélectionnez un client pour voir les détails</div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                <h2 style={{ margin: 0 }}>{selectedClient.name}</h2>
                <Badge variant="info">{selectedClient.category}</Badge>
                <div className="flex-1" />
                <Button variant="secondary" onClick={() => setModalState({ mode: 'edit', client: selectedClient })}>
                  ✏️ Modifier
                </Button>
                <Button variant="danger" onClick={() => setDeleteTarget({ id: selectedClient.id, name: selectedClient.name })}>
                  🗑️ Supprimer
                </Button>
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

      {modalState && (
        <ClientFormModal
          initial={modalState.mode === 'edit' ? modalState.client : undefined}
          onClose={() => setModalState(null)}
          onSave={handleSaveForm}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          open
          title="Suppression définitive"
          message={
            <>
              Supprimer le client <strong>{deleteTarget.name}</strong> ?
              <br /><span style={{ color: 'var(--danger)', fontWeight: 700 }}>Cette action est irréversible.</span>
              <br />Sera bloquée si le client possède des documents liés.
            </>
          }
          danger
          confirmLabel="Supprimer définitivement"
          onConfirm={confirmDeleteClient}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
};
