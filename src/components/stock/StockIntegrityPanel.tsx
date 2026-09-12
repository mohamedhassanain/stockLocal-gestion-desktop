import React, { useState } from 'react';
import { Card, Button } from '../ui';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { toast } from '../../stores/useToastStore';

/**
 * §Phase 3.1 — Panneau de maintenance du stock.
 *
 * Flux volontairement NON destructif :
 *   1. « Vérifier la cohérence » → audit LECTURE SEULE (aucune écriture).
 *   2. Si des écarts existent → tableau avant / attendu / écart.
 *   3. « Recalculer le stock » → confirmation explicite → réparation CONTRÔLÉE,
 *      limitée aux couples (produit, dépôt) affichés, tracée dans l'audit.
 */
interface StockDiscrepancyRow {
  product_id: string;
  warehouse_id: string;
  product_ref?: string;
  product_name?: string;
  warehouse_name?: string;
  stored_qty: number;
  expected_qty: number;
  difference: number;
}

interface StockAuditResponse {
  success?: boolean;
  error?: string;
  checked?: number;
  discrepancyCount?: number;
  discrepancies?: StockDiscrepancyRow[];
}

export const StockIntegrityPanel: React.FC = () => {
  const [isChecking, setIsChecking] = useState(false);
  const [isRepairing, setIsRepairing] = useState(false);
  const [audit, setAudit] = useState<StockAuditResponse | null>(null);
  const [confirmRepair, setConfirmRepair] = useState(false);

  const rows = audit?.discrepancies ?? [];

  const runAudit = async () => {
    setIsChecking(true);
    try {
      const result = (await window.api.stock.auditBalances()) as StockAuditResponse;
      if (result?.success === false) {
        toast.error(result.error ?? 'Échec de la vérification du stock.');
        return;
      }
      setAudit(result);
      if ((result?.discrepancyCount ?? 0) === 0) {
        toast.success(`Stock cohérent : ${result?.checked ?? 0} solde(s) vérifié(s).`);
      } else {
        toast.error(`${result?.discrepancyCount} écart(s) détecté(s).`);
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Échec de la vérification du stock.');
    } finally {
      setIsChecking(false);
    }
  };

  const repair = async () => {
    setIsRepairing(true);
    try {
      const items = rows.map(r => ({ product_id: r.product_id, warehouse_id: r.warehouse_id }));
      const result = (await window.api.stock.repairBalances(items)) as {
        success?: boolean;
        error?: string;
        data?: { repaired?: number };
      };
      if (result?.success === false) {
        toast.error(result.error ?? 'Échec de la réparation du stock.');
        return;
      }
      toast.success(`Stock recalculé : ${result?.data?.repaired ?? 0} solde(s) corrigé(s).`);
      setAudit(null);
      await runAudit();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Échec de la réparation du stock.');
    } finally {
      setIsRepairing(false);
    }
  };

  return (
    <Card padding>
      <div className="flex items-center justify-between gap-3" style={{ flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>Cohérence du stock</h2>
          <div className="text-sm text-muted" style={{ marginTop: 4 }}>
            Compare le stock enregistré à la somme des mouvements. Aucune donnée n'est modifiée avant votre confirmation.
          </div>
        </div>
        <Button variant="secondary" onClick={runAudit} disabled={isChecking}>
          {isChecking ? 'Vérification...' : 'Vérifier la cohérence'}
        </Button>
      </div>

      {audit && rows.length === 0 && (
        <div className="state-box" style={{ marginTop: 16 }}>
          <div className="state-title">Aucun écart détecté</div>
          <div className="state-text">
            {audit.checked ?? 0} solde(s) produit/dépôt vérifié(s) — le stock correspond exactement aux mouvements.
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="text-sm" style={{ marginBottom: 8 }}>
            <strong>{rows.length}</strong> écart(s) détecté(s). Le recalcul réécrit le solde depuis les mouvements.
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Produit</th>
                  <th>Dépôt</th>
                  <th className="text-right">Stock enregistré</th>
                  <th className="text-right">Stock attendu</th>
                  <th className="text-right">Écart</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.product_id}|${r.warehouse_id}`}>
                    <td>{r.product_ref ? `${r.product_ref} — ${r.product_name ?? ''}` : r.product_name ?? r.product_id}</td>
                    <td className="text-sm">{r.warehouse_name ?? '—'}</td>
                    <td className="qty text-right">{r.stored_qty}</td>
                    <td className="qty text-right">{r.expected_qty}</td>
                    <td className="qty text-right" style={{ fontWeight: 700, color: 'var(--danger)' }}>
                      {r.difference > 0 ? `+${r.difference}` : r.difference}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-3" style={{ marginTop: 12 }}>
            <Button variant="danger" onClick={() => setConfirmRepair(true)} disabled={isRepairing}>
              {isRepairing ? 'Recalcul en cours...' : 'Recalculer le stock'}
            </Button>
          </div>
        </div>
      )}

      {confirmRepair && (
        <ConfirmDialog
          open
          danger
          title="Recalculer le stock ?"
          message={(
            <>
              Les <strong>{rows.length}</strong> solde(s) affiché(s) seront recalculés depuis l'historique des mouvements.
              <br />Les autres soldes ne sont pas modifiés. L'opération est tracée dans le journal d'audit.
            </>
          )}
          confirmLabel="Recalculer"
          onConfirm={() => { setConfirmRepair(false); repair(); }}
          onCancel={() => setConfirmRepair(false)}
        />
      )}
    </Card>
  );
};
