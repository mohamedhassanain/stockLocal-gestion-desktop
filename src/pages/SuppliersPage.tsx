import React, { useEffect, useState } from 'react';
import { useSupplierStore } from '../stores/useSupplierStore';
import { SupplierDetailPanel } from '../components/SupplierDetailPanel';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { toast } from '../stores/useToastStore';
import type { Supplier } from '../repositories/SupplierRepository';
import { Button, Input, PageHeader, Modal, ModalHeader, ModalBody, ModalFooter } from '../components/ui';

const SupplierFormModal: React.FC<{ initial?: Supplier; onClose: () => void; onSave: (data: any) => void }> = ({ initial, onClose, onSave }) => {
  const [form, setForm] = useState(() =>
    initial
      ? { name: initial.name, phone: initial.phone ?? '', address: initial.address ?? '', ice: initial.ice ?? '' }
      : { name: '', phone: '', address: '', ice: '' });

  return (
    <Modal open onClose={onClose} width={480}>
      <ModalHeader title={initial ? '✏️ Modifier le Fournisseur' : '🏭 Nouveau Fournisseur'} />
      <ModalBody>
        {[
          { key: 'name', label: 'Nom *', type: 'text', placeholder: 'Raison sociale du fournisseur' },
          { key: 'phone', label: 'Téléphone', type: 'tel', placeholder: '05XXXXXXXX' },
          { key: 'address', label: 'Adresse', type: 'text', placeholder: 'Ville, région...' },
          { key: 'ice', label: 'ICE', type: 'text', placeholder: "Identifiant Commun de l'Entreprise" },
        ].map(({ key, label, type, placeholder }) => (
          <Input
            key={key}
            label={label}
            type={type}
            placeholder={placeholder}
            value={(form as any)[key]}
            onChange={e => setForm({ ...form, [key]: e.target.value })}
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

export const SuppliersPage: React.FC = () => {
  const { suppliers, selectedSupplier, searchQuery, isLoading, setSearchQuery, loadSuppliers, selectSupplier, createSupplier, updateSupplier, deleteSupplier, addDebt, addPayment } = useSupplierStore();
  const [modalState, setModalState] = useState<{ mode: 'create' } | { mode: 'edit'; supplier: Supplier } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

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

  const confirmDeleteSupplier = async () => {
    if (!deleteTarget) return;
    const { id, name } = deleteTarget;
    try {
      await deleteSupplier(id);
      toast.success(`Fournisseur « ${name} » supprimé.`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="page-shell">
      <PageHeader
        title="🏭 Fournisseurs"
        actions={
          <Button variant="primary" onClick={() => setModalState({ mode: 'create' })}>
            + Nouveau Fournisseur
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
          {suppliers.length === 0 && !isLoading && (
            <div className="state-box">
              <div className="state-icon">🏭</div>
              <div className="state-text">Aucun fournisseur trouvé. Créez-en un nouveau.</div>
            </div>
          )}
          {suppliers.map(supplier => {
            const balance = supplier.balance ?? 0;
            const isSelected = selectedSupplier?.id === supplier.id;
            return (
              <div
                key={supplier.id}
                onClick={() => selectSupplier(supplier)}
                className={isSelected ? 'list-item list-item-selected' : 'list-item'}
                style={{
                  borderRadius: 0,
                  border: 'none',
                  borderBottom: '1px solid var(--border)',
                  borderLeft: isSelected ? '4px solid var(--primary)' : '4px solid transparent',
                  marginBottom: 0,
                }}
              >
                <div style={{ fontWeight: isSelected ? 700 : 600, fontSize: 16 }}>{supplier.name}</div>
                <div className="text-sm text-muted" style={{ marginTop: 2 }}>{supplier.phone || 'Pas de téléphone'}</div>
                <div className={`text-sm font-semibold ${balance > 0 ? 'text-danger' : 'text-success'}`} style={{ marginTop: 6 }}>
                  {balance > 0 ? `Doit : ${balance.toFixed(2)} MAD` : '✓ Soldé'}
                </div>
              </div>
            );
          })}
        </div>

        <div className="page-content">
          {!selectedSupplier ? (
            <div className="state-box" style={{ height: '100%' }}>
              <div className="state-text">← Sélectionnez un fournisseur pour voir les détails</div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                <h2 style={{ margin: 0 }}>{selectedSupplier.name}</h2>
                <div className="flex-1" />
                <Button variant="secondary" onClick={() => setModalState({ mode: 'edit', supplier: selectedSupplier })}>
                  ✏️ Modifier
                </Button>
                <Button variant="danger" onClick={() => setDeleteTarget({ id: selectedSupplier.id, name: selectedSupplier.name })}>
                  🗑️ Supprimer
                </Button>
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

      {modalState && (
        <SupplierFormModal
          initial={modalState.mode === 'edit' ? modalState.supplier : undefined}
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
              Supprimer le fournisseur <strong>{deleteTarget.name}</strong> ?
              <br /><span style={{ color: 'var(--danger)', fontWeight: 700 }}>Cette action est irréversible.</span>
              <br />Sera bloquée si le fournisseur possède des documents ou mouvements liés.
            </>
          }
          danger
          confirmLabel="Supprimer définitivement"
          onConfirm={confirmDeleteSupplier}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
};
