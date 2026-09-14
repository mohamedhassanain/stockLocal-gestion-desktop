import React, { useCallback, useEffect, useState } from 'react';
import { Users, Plus, Pencil, Power, Trash2, BarChart3 } from 'lucide-react';
import { Button, Input, Modal, ModalBody, ModalFooter, ModalHeader, PageHeader } from '../components/ui';
import { useSellerStore, type Seller } from '../stores/useSellerStore';
import { toast } from '../stores/useToastStore';

/**
 * §B4 — Page Vendeurs / commerciaux.
 *
 * ⚠️  FICHES uniquement (nom, téléphone, taux de commission, actif). Ce ne sont
 *     PAS des comptes utilisateurs : aucune authentification.
 *
 * Gère le CRUD des vendeurs ET affiche le rapport de commission (CA, nombre de
 * ventes, commission) pour le mois sélectionné.
 */

interface CommissionRow {
  id: string;
  name: string;
  commission_rate: number;
  active: number;
  sales_count: number;
  revenue: number;
  commission: number;
}

interface CommissionReport {
  from: string;
  to: string;
  rows: CommissionRow[];
  totalRevenue: number;
  totalCommission: number;
}

/** Mois courant au format AAAA-MM (date locale, jamais UTC). */
function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const EMPTY_FORM = { name: '', phone: '', commission_rate: 0, notes: '' };

export const SellersPage: React.FC = () => {
  const sellers = useSellerStore((s) => s.sellers);
  const loadSellers = useSellerStore((s) => s.loadSellers);
  const createSeller = useSellerStore((s) => s.createSeller);
  const updateSeller = useSellerStore((s) => s.updateSeller);
  const setSellerActive = useSellerStore((s) => s.setSellerActive);
  const deleteSeller = useSellerStore((s) => s.deleteSeller);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Seller | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [reportMonth, setReportMonth] = useState(currentMonth());
  const [report, setReport] = useState<CommissionReport | null>(null);

  const loadReport = useCallback(async (month: string) => {
    try {
      const res = await window.api.sellers.getReport({ month });
      if (res?.success) setReport(res.data as CommissionReport);
    } catch {
      setReport(null);
    }
  }, []);

  useEffect(() => {
    void loadSellers();
    void loadReport(reportMonth);
  }, [loadSellers, loadReport, reportMonth]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (seller: Seller) => {
    setEditing(seller);
    setForm({
      name: seller.name,
      phone: seller.phone ?? '',
      commission_rate: seller.commission_rate,
      notes: seller.notes ?? '',
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error('Le nom du vendeur est obligatoire.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        commission_rate: Number(form.commission_rate) || 0,
        notes: form.notes.trim() || null,
      };
      if (editing) {
        await updateSeller(editing.id, payload);
        toast.success('Vendeur modifié.');
      } else {
        await createSeller(payload);
        toast.success('Vendeur créé.');
      }
      setShowForm(false);
      await loadReport(reportMonth);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Enregistrement impossible.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (seller: Seller) => {
    try {
      await setSellerActive(seller.id, seller.active !== 1);
      toast.success(seller.active === 1 ? 'Vendeur désactivé.' : 'Vendeur activé.');
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Changement d\'état impossible.');
    }
  };

  const handleDelete = async (seller: Seller) => {
    if (!window.confirm(`Supprimer définitivement le vendeur « ${seller.name} » ?`)) return;
    try {
      await deleteSeller(seller.id);
      toast.success('Vendeur supprimé.');
      await loadReport(reportMonth);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Suppression impossible.');
    }
  };

  return (
    <div className="page-shell">
      <PageHeader
        icon={<Users size={24} strokeWidth={2} />}
        title="Vendeurs"
        subtitle="Fiches des commerciaux (aucun compte utilisateur) — suivi du chiffre d'affaires et des commissions"
        actions={<Button variant="primary" onClick={openCreate}><Plus size={16} /> Nouveau vendeur</Button>}
      />

      <div className="page-content" style={{ overflowY: 'auto' }}>
        <div className="card">
          <div className="card-header"><h3 style={{ margin: 0 }}>Vendeurs</h3></div>
          <div className="card-body" style={{ padding: 0 }}>
            {sellers.length === 0 ? (
              <div className="state-box">
                <Users size={36} className="state-icon" />
                <div className="state-title">Aucun vendeur</div>
                <div className="state-text">Créez une fiche vendeur pour suivre les ventes et les commissions.</div>
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Nom</th>
                    <th>Téléphone</th>
                    <th className="text-right">Commission</th>
                    <th>État</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sellers.map((s) => (
                    <tr key={s.id}>
                      <td className="font-semibold">{s.name}</td>
                      <td>{s.phone || '—'}</td>
                      <td className="text-right money">{Number(s.commission_rate).toFixed(2)} %</td>
                      <td>
                        <span className={`badge ${s.active === 1 ? 'badge-success' : 'badge-muted'}`}>
                          {s.active === 1 ? 'Actif' : 'Inactif'}
                        </span>
                      </td>
                      <td>
                        <div className="flex gap-2" style={{ justifyContent: 'flex-end' }}>
                          <Button variant="secondary" icon title="Modifier" onClick={() => openEdit(s)}>
                            <Pencil size={15} />
                          </Button>
                          <Button
                            variant="secondary"
                            icon
                            title={s.active === 1 ? 'Désactiver' : 'Activer'}
                            onClick={() => handleToggleActive(s)}
                          >
                            <Power size={15} />
                          </Button>
                          <Button variant="ghost" icon title="Supprimer" onClick={() => handleDelete(s)} style={{ color: 'var(--danger)' }}>
                            <Trash2 size={15} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="card" style={{ marginTop: 'var(--space-4)' }}>
          <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <BarChart3 size={18} /> Rapport de commission
            </h3>
            <input
              type="month"
              className="input"
              style={{ width: 180 }}
              value={reportMonth}
              onChange={(e) => setReportMonth(e.target.value || currentMonth())}
            />
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {!report || report.rows.length === 0 ? (
              <div className="state-box">
                <div className="state-title">Aucune donnée</div>
                <div className="state-text">Aucune vente rattachée à un vendeur sur cette période.</div>
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Vendeur</th>
                    <th className="text-right">Ventes</th>
                    <th className="text-right">Chiffre d'affaires</th>
                    <th className="text-right">Taux</th>
                    <th className="text-right">Commission</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="font-semibold">{r.name}</td>
                      <td className="text-right">{r.sales_count}</td>
                      <td className="text-right money">{Number(r.revenue).toFixed(2)} MAD</td>
                      <td className="text-right">{Number(r.commission_rate).toFixed(2)} %</td>
                      <td className="text-right money font-semibold">{Number(r.commission).toFixed(2)} MAD</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '2px solid var(--border-strong)' }}>
                    <td className="font-semibold" colSpan={2}>TOTAL</td>
                    <td className="text-right money font-semibold">{Number(report.totalRevenue).toFixed(2)} MAD</td>
                    <td />
                    <td className="text-right money font-semibold">{Number(report.totalCommission).toFixed(2)} MAD</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      <Modal open={showForm} onClose={() => setShowForm(false)} width={460}>
        <ModalHeader icon={<Users size={22} />} title={editing ? 'Modifier le vendeur' : 'Nouveau vendeur'} />
        <ModalBody>
          <Input
            label="Nom"
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Nom du vendeur"
            autoFocus
          />
          <Input
            label="Téléphone"
            type="text"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="06…"
          />
          <Input
            label="Taux de commission (%)"
            type="number"
            min={0}
            max={100}
            step={0.01}
            value={form.commission_rate}
            onChange={(e) => setForm({ ...form, commission_rate: Number(e.target.value) })}
          />
          <Input
            label="Notes"
            type="text"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Facultatif"
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setShowForm(false)}>Annuler</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
};
