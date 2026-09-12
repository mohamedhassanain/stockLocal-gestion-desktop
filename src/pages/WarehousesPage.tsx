import React, { useEffect, useState } from 'react';
import { PageHeader, Card, Button, Input, Badge } from '../components/ui';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { toast } from '../stores/useToastStore';

/**
 * Phase 5 — Gestion des dépôts (CRUD). Portée réduite documentée :
 * le stock reste global (aucune ventilation par dépôt), pas de transferts.
 */

interface Warehouse {
  id: string;
  name: string;
  address: string | null;
  is_default: number;
}

export const WarehousesPage: React.FC = () => {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [warehouseSearch, setWarehouseSearch] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Warehouse | null>(null);

  const load = async () => {
    setIsLoading(true);
    try {
      const data = await window.api.warehouses.getAll();
      setWarehouses((data ?? []) as Warehouse[]);
    } catch (e: unknown) {
      toast.error(`Impossible de charger les dépôts : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const resetForm = () => {
    setName('');
    setAddress('');
    setIsDefault(false);
    setEditingId(null);
  };

  const handleSubmit = async () => {
    if (!name.trim()) { toast.warning('Le nom du dépôt est obligatoire.'); return; }
    try {
      const payload = { name: name.trim(), address: address.trim() || null, is_default: isDefault };
      const result = editingId
        ? await window.api.warehouses.update(editingId, payload)
        : await window.api.warehouses.create(payload);
      if (!result.success) throw new Error(result.error);
      toast.success(editingId ? 'Dépôt modifié.' : 'Dépôt créé.');
      resetForm();
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleEdit = (w: Warehouse) => {
    setEditingId(w.id);
    setName(w.name);
    setAddress(w.address ?? '');
    setIsDefault(w.is_default === 1);
  };

  const handleSetDefault = async (id: string) => {
    try {
      const result = await window.api.warehouses.setDefault(id);
      if (!result.success) throw new Error(result.error);
      toast.success('Dépôt par défaut défini.');
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    try {
      const result = await window.api.warehouses.delete(pendingDelete.id);
      if (!result.success) throw new Error(result.error);
      toast.success('Dépôt supprimé.');
      setPendingDelete(null);
      if (editingId === pendingDelete.id) resetForm();
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const filteredWarehouses = warehouses.filter(w => {
    const q = warehouseSearch.trim().toLowerCase();
    if (!q) return true;
    return w.name.toLowerCase().includes(q) || (w.address ?? '').toLowerCase().includes(q);
  });

  return (
    <div className="page-shell">
      <PageHeader
        icon="🏬"
        title="Dépôts"
        subtitle="Référentiel des dépôts. Le stock reste comptabilisé globalement (pas encore de ventilation par dépôt)."
      />

      <div className="page-content" style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        <Card padding style={{ width: 380, flexShrink: 0 }}>
          <h3 style={{ marginTop: 0 }}>{editingId ? 'Modifier le dépôt' : 'Nouveau dépôt'}</h3>
          <Input label="Nom *" value={name} onChange={e => setName(e.target.value)} placeholder="Ex : Dépôt principal" />
          <Input label="Adresse" value={address} onChange={e => setAddress(e.target.value)} placeholder="Adresse (optionnel)" />
          <label className="flex items-center gap-2 cursor-pointer font-semibold text-secondary" style={{ marginBottom: 'var(--space-4)' }}>
            <input
              type="checkbox"
              checked={isDefault}
              onChange={e => setIsDefault(e.target.checked)}
              style={{ width: 18, height: 18, accentColor: 'var(--primary)' }}
            />
            Dépôt par défaut
          </label>
          <div className="flex gap-2">
            <Button variant="success" onClick={handleSubmit}>{editingId ? 'Enregistrer' : '+ Ajouter'}</Button>
            {editingId && <Button variant="secondary" onClick={resetForm}>Annuler</Button>}
          </div>
        </Card>

        <Card overflow className="flex-1">
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
            <Input
              type="text"
              placeholder="🔍 Rechercher un dépôt (nom ou adresse)…"
              value={warehouseSearch}
              onChange={e => setWarehouseSearch(e.target.value)}
              inputSize="sm"
            />
          </div>
          {isLoading ? (
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton skeleton-row" />)}
            </div>
          ) : filteredWarehouses.length === 0 ? (
            <div className="state-box">
              <div className="state-title">{warehouses.length === 0 ? 'Aucun dépôt' : 'Aucun résultat'}</div>
              <div className="state-text">{warehouses.length === 0 ? 'Créez votre premier dépôt avec le formulaire ci-contre.' : 'Aucun dépôt ne correspond à votre recherche.'}</div>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Adresse</th>
                  <th>Par défaut</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredWarehouses.map(w => (
                  <tr key={w.id}>
                    <td className="font-semibold">{w.name}</td>
                    <td className="text-sm text-secondary">{w.address || '—'}</td>
                    <td>{w.is_default === 1 ? <Badge variant="success">Par défaut</Badge> : <span className="text-muted">—</span>}</td>
                    <td>
                      <div className="flex gap-2">
                        <Button variant="secondary" size="sm" onClick={() => handleEdit(w)} title="Modifier">✏️</Button>
                        {w.is_default !== 1 && (
                          <Button variant="secondary" size="sm" onClick={() => handleSetDefault(w.id)} title="Définir par défaut">⭐</Button>
                        )}
                        <Button variant="danger" size="sm" onClick={() => setPendingDelete(w)} title="Supprimer">🗑️</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          open
          title="Supprimer ce dépôt ?"
          message={<>Le dépôt <strong>{pendingDelete.name}</strong> sera supprimé. Cette action est irréversible.</>}
          danger
          confirmLabel="Supprimer"
          onConfirm={() => { void handleDelete(); }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
};
