import React, { useEffect, useState } from 'react';
import { toast } from '../stores/useToastStore';
import type { LowStockAlert } from '../repositories/DashboardRepository';
import type { ExpiringBatch } from '../repositories/ProductBatchRepository';
import { useWarehouseStore } from '../stores/useWarehouseStore';
import { StockIntegrityPanel } from '../components/stock/StockIntegrityPanel';
// ⚠️ Import depuis le DOMAINE (module pur), JAMAIS depuis `services/StockAlertService` :
// ce service importe `StockAlertRepository` → `database/config/connection` (better-sqlite3),
// ce qui faisait planter l'évaluation du bundle renderer → fenêtre entièrement blanche.
import { STOCK_STATUS_LABELS, type StockStatusSummary } from '../domain/stock/StockStatus';

/**
 * Page Alertes (§3.2 + Phase 3) :
 *   - produits en rupture ou sous le seuil minimum de réapprovisionnement ;
 *   - produits proches de l'expiration (lots), avec seuils configurables.
 */
export const StockAlertsPage: React.FC = () => {
  const [alerts, setAlerts] = useState<LowStockAlert[]>([]);
  const [expiring, setExpiring] = useState<ExpiringBatch[]>([]);
  // §Phase 15 — classement rupture / critique / normal / surstock + commande suggérée.
  const [status, setStatus] = useState<StockStatusSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Fenêtre d'alerte d'expiration : 30 jours par défaut, 7 jours en option.
  const [expiryWithin, setExpiryWithin] = useState<number>(30);
  // Multi-dépôts : filtre des alertes de stock bas. '' = consolidé (tous dépôts).
  const [warehouseFilter, setWarehouseFilter] = useState<string>('');
  const warehouses = useWarehouseStore((s) => s.warehouses);

  const load = async () => {
    setIsLoading(true);
    try {
      const [lowStock, batches, stockStatus] = await Promise.all([
        window.api.dashboard.getLowStock(warehouseFilter || undefined),
        window.api.batches.getExpiring(expiryWithin),
        window.api.stock.getStatus(warehouseFilter || undefined),
      ]);
      setAlerts(lowStock ?? []);
      setExpiring((batches ?? []) as ExpiringBatch[]);
      setStatus((stockStatus ?? null) as StockStatusSummary | null);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(`Impossible de charger les alertes : ${message}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, [expiryWithin, warehouseFilter]);

  const goToProducts = () => {
    // Navigation simple : App gère la navigation via bouton (dispatch custom).
    window.dispatchEvent(new CustomEvent('navigate', { detail: 'products' }));
  };

  const expiryBadge = (daysLeft: number | null): { label: string; cls: string } => {
    if (daysLeft === null) return { label: 'Sans date', cls: 'badge-muted' };
    if (daysLeft < 0) return { label: `Expiré (${Math.abs(daysLeft)} j)`, cls: 'badge-danger' };
    if (daysLeft <= 7) return { label: `Expire dans ${daysLeft} j`, cls: 'badge-warning' };
    return { label: `Expire dans ${daysLeft} j`, cls: 'badge-info' };
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg)', height: '100vh', overflow: 'hidden' }}>
      <div className="page-header">
        <div>
          <h1>Alertes stock</h1>
          <div style={{ color: 'var(--muted)', marginTop: '4px', fontSize: '13px' }}>
            Produits en rupture ou sous le seuil minimum, et produits proches de l'expiration
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-primary" onClick={goToProducts}>Gérer les produits</button>
          <button className="btn btn-ghost" onClick={load}>Actualiser</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {/* ── Section 1 : stock bas / rupture ── */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>🔴 Stock bas / rupture</h2>
            {warehouses.length > 1 && (
              <select
                className="select"
                style={{ width: 'auto', minWidth: '200px' }}
                value={warehouseFilter}
                onChange={e => setWarehouseFilter(e.target.value)}
                aria-label="Filtrer par dépôt"
              >
                <option value="">Tous les dépôts (consolidé)</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            )}
          </div>
          {isLoading ? (
            <div className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="skeleton skeleton-row" />
              ))}
            </div>
          ) : alerts.length === 0 ? (
            <div className="card state-box">
              <div className="state-title">Tous les stocks sont suffisants</div>
              <div className="state-text">Aucun produit n'est en rupture ou sous son seuil minimum.</div>
            </div>
          ) : (
            <div className="card" style={{ overflow: 'hidden' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Référence</th>
                    <th>Désignation</th>
                    <th>Stock actuel</th>
                    <th>Seuil minimum</th>
                    <th>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.map((item) => (
                    <tr key={item.id}>
                      <td className="text-sm" style={{ fontWeight: 600 }}>{item.reference}</td>
                      <td>{item.designation}</td>
                      <td className="qty" style={{ fontWeight: 700 }}>{item.current_stock}</td>
                      <td className="qty">{item.min_stock}</td>
                      <td>
                        {item.current_stock <= 0
                          ? <span className="badge badge-danger">Rupture</span>
                          : <span className="badge badge-warning">Stock bas</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Section 2 : produits proches de l'expiration (lots) ── */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <h2 style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>⏳ Produits proches de l'expiration</h2>
            <select
              className="select"
              style={{ width: 'auto', minWidth: '180px' }}
              value={expiryWithin}
              onChange={e => setExpiryWithin(Number(e.target.value))}
              aria-label="Seuil d'expiration"
            >
              <option value={7}>Expire dans 7 jours ou moins</option>
              <option value={30}>Expire dans 30 jours ou moins</option>
              <option value={90}>Expire dans 90 jours ou moins</option>
            </select>
          </div>
          {isLoading ? (
            <div className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="skeleton skeleton-row" />
              ))}
            </div>
          ) : expiring.length === 0 ? (
            <div className="card state-box">
              <div className="state-title">Aucun lot proche de l'expiration</div>
              <div className="state-text">Les produits gérés par lots dont la date d'expiration approche apparaîtront ici.</div>
            </div>
          ) : (
            <div className="card" style={{ overflow: 'hidden' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Référence</th>
                    <th>Désignation</th>
                    <th>N° de lot</th>
                    <th>Quantité</th>
                    <th>Expiration</th>
                    <th>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {expiring.map((batch) => {
                    const badge = expiryBadge(batch.days_left);
                    return (
                      <tr key={batch.id}>
                        <td className="text-sm" style={{ fontWeight: 600 }}>{batch.product_ref ?? '—'}</td>
                        <td>{batch.product_name ?? '—'}</td>
                        <td className="text-sm">{batch.lot_number}</td>
                        <td className="qty" style={{ fontWeight: 700 }}>{batch.quantity}</td>
                        <td className="text-sm">
                          {batch.expiry_date ? new Date(batch.expiry_date).toLocaleDateString('fr-MA') : '—'}
                        </td>
                        <td><span className={`badge ${badge.cls}`}>{badge.label}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Section 3 : réapprovisionnement suggéré (§Phase 15) ── */}
        <div>
          <h2 style={{ margin: '0 0 12px', fontSize: 'var(--font-size-lg)' }}>🧠 Réapprovisionnement suggéré</h2>
          {isLoading ? (
            <div className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton skeleton-row" />)}
            </div>
          ) : !status ? (
            <div className="card state-box">
              <div className="state-text">Classement du stock indisponible.</div>
            </div>
          ) : (
            <>
              <div className="stat-grid" style={{ marginBottom: 12 }}>
                <div className="card" style={{ padding: '12px 16px' }}>
                  <div className="text-xs text-muted">Rupture</div>
                  <div className="font-semibold" style={{ fontSize: 'var(--font-size-lg)', color: 'var(--danger)' }}>{status.outOfStock}</div>
                </div>
                <div className="card" style={{ padding: '12px 16px' }}>
                  <div className="text-xs text-muted">Stock critique</div>
                  <div className="font-semibold" style={{ fontSize: 'var(--font-size-lg)', color: 'var(--warning)' }}>{status.critical}</div>
                </div>
                <div className="card" style={{ padding: '12px 16px' }}>
                  <div className="text-xs text-muted">Stock normal</div>
                  <div className="font-semibold" style={{ fontSize: 'var(--font-size-lg)', color: 'var(--success)' }}>{status.normal}</div>
                </div>
                <div className="card" style={{ padding: '12px 16px' }}>
                  <div className="text-xs text-muted">Surstock</div>
                  <div className="font-semibold" style={{ fontSize: 'var(--font-size-lg)', color: 'var(--info)' }}>{status.overstock}</div>
                </div>
              </div>

              {status.restockSuggestions.length === 0 ? (
                <div className="card state-box">
                  <div className="state-title">Aucune commande suggérée</div>
                  <div className="state-text">Tous les produits sont au-dessus de leur seuil minimum.</div>
                </div>
              ) : (
                <div className="card" style={{ overflow: 'hidden' }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Référence</th>
                        <th>Désignation</th>
                        <th>Stock</th>
                        <th>Min</th>
                        <th>Max</th>
                        <th>Statut</th>
                        <th style={{ textAlign: 'right' }}>Commande suggérée</th>
                      </tr>
                    </thead>
                    <tbody>
                      {status.restockSuggestions.map((item) => {
                        const cls = item.status === 'OUT_OF_STOCK' ? 'badge-danger' : 'badge-warning';
                        return (
                          <tr key={item.product_id}>
                            <td className="text-sm" style={{ fontWeight: 600 }}>{item.reference}</td>
                            <td>{item.designation}</td>
                            <td className="qty" style={{ fontWeight: 700 }}>{item.current_stock}</td>
                            <td className="qty">{item.min_stock}</td>
                            <td className="qty">{item.max_stock > 0 ? item.max_stock : '—'}</td>
                            <td><span className={`badge ${cls}`}>{STOCK_STATUS_LABELS[item.status]}</span></td>
                            <td className="qty" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--primary)' }}>
                              {item.suggestedOrder}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="text-xs text-muted" style={{ padding: '10px 16px' }}>
                    Suggestion indicative — aucune commande n'est créée automatiquement.
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Section 4 : cohérence du stock (audit + recalcul contrôlé, §Phase 3.1) ── */}
        <StockIntegrityPanel />
      </div>
    </div>
  );
};
