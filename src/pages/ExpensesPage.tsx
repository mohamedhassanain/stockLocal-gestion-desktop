import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Input, Select, PageHeader, DeleteButton } from '../components/ui';
import { toast } from '../stores/useToastStore';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { toLocalDateString } from '../utils/date';
import type { Expense } from '../repositories/ExpenseRepository';

/**
 * §Phase 11 — Dépenses.
 *
 * Une dépense réglée en espèces est automatiquement rattachée à la session de
 * caisse ouverte (elle apparaît donc dans le solde théorique de la caisse).
 * Tout calcul de total vient du dépôt (source de vérité unique).
 */

interface CategoryTotal {
  category: string;
  total: number;
  count: number;
}

function money(value: number): string {
  return `${Number(value ?? 0).toFixed(2)} MAD`;
}

/** Premier jour du mois courant (YYYY-MM-01), en date locale. */
function monthStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

export const ExpensesPage: React.FC = () => {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [totals, setTotals] = useState<CategoryTotal[]>([]);
  const [periodTotal, setPeriodTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<Expense | null>(null);

  const [form, setForm] = useState({
    category: 'Transport',
    amount: 0,
    description: '',
    paymentMethod: 'CASH' as 'CASH' | 'CHECK' | 'TRANSFER',
    date: toLocalDateString(),
  });

  const range = useMemo(() => ({ from: monthStart(), to: toLocalDateString() }), []);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [list, cats, totalsResult] = await Promise.all([
        window.api.expenses.getAll({ limit: 200 }),
        window.api.expenses.categories(),
        window.api.expenses.getTotals(range.from, range.to),
      ]);
      setExpenses((list ?? []) as Expense[]);
      const safeCategories = (cats ?? []) as string[];
      setCategories(safeCategories);
      setForm(prev => (safeCategories.includes(prev.category) ? prev : { ...prev, category: safeCategories[0] ?? 'Autres' }));

      const payload = totalsResult as unknown as { success?: boolean; data?: { total: number; byCategory: CategoryTotal[] }; error?: string };
      if (payload && payload.success === false) {
        toast.error(payload.error ?? 'Totaux indisponibles.');
      } else {
        const data = payload?.data ?? (totalsResult as unknown as { total: number; byCategory: CategoryTotal[] });
        setPeriodTotal(Number(data?.total ?? 0));
        setTotals(Array.isArray(data?.byCategory) ? data.byCategory : []);
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Erreur de chargement des dépenses.');
    } finally {
      setIsLoading(false);
    }
  }, [range.from, range.to]);

  useEffect(() => { void load(); }, [load]);

  const addExpense = async () => {
    if (!(form.amount > 0)) { toast.error('Saisissez un montant supérieur à 0.'); return; }
    try {
      const result = await window.api.expenses.create({
        category: form.category,
        amount: form.amount,
        description: form.description || undefined,
        paymentMethod: form.paymentMethod,
        date: form.date,
      }) as { success: boolean; error?: string };
      if (!result.success) { toast.error(result.error ?? 'Enregistrement refusé.'); return; }
      toast.success('Dépense enregistrée.');
      setForm(prev => ({ ...prev, amount: 0, description: '' }));
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Enregistrement refusé.');
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      const result = await window.api.expenses.delete(pendingDelete.id) as { success: boolean; error?: string };
      if (!result.success) { toast.error(result.error ?? 'Suppression refusée.'); return; }
      toast.success('Dépense supprimée.');
      setPendingDelete(null);
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Suppression refusée.');
    }
  };

  const cashAndOther = expenses.reduce(
    (acc, e) => {
      if (e.payment_method === 'CASH') acc.cash += Number(e.amount);
      else acc.other += Number(e.amount);
      return acc;
    },
    { cash: 0, other: 0 },
  );

  return (
    <div className="page-shell">
      <PageHeader icon="🧾" title="Dépenses" subtitle="Charges d'exploitation — intégrées à la caisse pour les règlements en espèces" />

      <div className="page-content">
        {/* ── Saisie ── */}
        <Card padding className="mb-4">
          <h2 className="section-title" style={{ margin: '0 0 12px', fontSize: 'var(--font-size-lg)' }}>
            Nouvelle dépense
          </h2>
          <div className="grid-4" style={{ gap: 10, alignItems: 'end' }}>
            <Select label="Catégorie" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </Select>
            <Input
              label="Montant (MAD)"
              type="number"
              min={0}
              step={0.01}
              value={form.amount || ''}
              onChange={e => setForm({ ...form, amount: Number(e.target.value) })}
              className="money"
            />
            <Select
              label="Mode de paiement"
              value={form.paymentMethod}
              onChange={e => setForm({ ...form, paymentMethod: e.target.value as 'CASH' | 'CHECK' | 'TRANSFER' })}
            >
              <option value="CASH">Espèces (caisse)</option>
              <option value="CHECK">Chèque</option>
              <option value="TRANSFER">Virement</option>
            </Select>
            <Input label="Date" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
          </div>
          <Input
            label="Description"
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
            placeholder="Ex : livraison client X"
          />
          <div className="text-xs text-muted" style={{ marginTop: 4 }}>
            Une dépense en espèces est rattachée à la caisse ouverte et réduit le solde théorique du tiroir.
          </div>
          <Button variant="success" onClick={addExpense} className="mt-3" disabled={!(form.amount > 0)}>
            Enregistrer la dépense
          </Button>
        </Card>

        {/* ── Totaux du mois ── */}
        <div className="grid-3 mb-4" style={{ gap: 10 }}>
          <Card padding>
            <div className="text-xs text-muted">Total du mois en cours</div>
            <div className="money font-semibold" style={{ fontSize: 'var(--font-size-lg)' }}>{money(periodTotal)}</div>
          </Card>
          <Card padding>
            <div className="text-xs text-muted">Réglé en espèces</div>
            <div className="money font-semibold">{money(cashAndOther.cash)}</div>
          </Card>
          <Card padding>
            <div className="text-xs text-muted">Hors espèces</div>
            <div className="money font-semibold">{money(cashAndOther.other)}</div>
          </Card>
        </div>

        {totals.length > 0 && (
          <Card padding className="mb-4">
            <div className="text-sm text-muted" style={{ marginBottom: 8 }}>Répartition par catégorie (mois en cours)</div>
            <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
              {totals.map(t => (
                <span key={t.category} className="badge badge-info">
                  {t.category} · {money(t.total)} ({t.count})
                </span>
              ))}
            </div>
          </Card>
        )}

        {/* ── Liste ── */}
        <Card padding>
          <h2 className="section-title" style={{ margin: '0 0 12px', fontSize: 'var(--font-size-lg)' }}>
            Historique des dépenses
          </h2>
          {isLoading ? (
            <div className="state-text" style={{ padding: 16 }}>Chargement…</div>
          ) : expenses.length === 0 ? (
            <div className="text-muted text-center" style={{ padding: 24 }}>Aucune dépense enregistrée.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Date</th>
                  <th style={{ width: 140 }}>Catégorie</th>
                  <th>Description</th>
                  <th style={{ width: 130 }}>Mode</th>
                  <th style={{ width: 120, textAlign: 'right' }}>Montant</th>
                  <th style={{ width: 70 }}></th>
                </tr>
              </thead>
              <tbody>
                {expenses.map(e => (
                  <tr key={e.id}>
                    <td className="text-sm">{String(e.date).split('T')[0]}</td>
                    <td className="text-sm font-semibold">{e.category}</td>
                    <td className="text-sm text-muted">{e.description ?? '—'}</td>
                    <td className="text-sm">
                      {e.payment_method === 'CASH' ? 'Espèces' : e.payment_method === 'CHECK' ? 'Chèque' : 'Virement'}
                      {e.cash_session_id && <span className="text-xs text-muted"> · caisse</span>}
                    </td>
                    <td className="money text-right font-semibold">{Number(e.amount).toFixed(2)}</td>
                    <td><DeleteButton onClick={() => setPendingDelete(e)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Supprimer cette dépense ?"
        message="La dépense sera définitivement supprimée. Si elle a été réglée en espèces, son mouvement de caisse sera également retiré."
        confirmLabel="Supprimer"
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
};
