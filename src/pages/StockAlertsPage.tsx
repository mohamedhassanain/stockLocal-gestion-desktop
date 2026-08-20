import React, { useEffect, useState } from 'react';
import { toast } from '../stores/useToastStore';
import type { LowStockAlert } from '../repositories/DashboardRepository';

/** Page Alertes stock (§3.2) — produits en rupture ou sous le seuil minimum. */
export const StockAlertsPage: React.FC = () => {
  const [alerts, setAlerts] = useState<LowStockAlert[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = async () => {
    setIsLoading(true);
    try {
      const data = await window.api.dashboard.getLowStock();
      setAlerts(data ?? []);
    } catch (e: any) {
      toast.error(`Impossible de charger les alertes : ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const goToProducts = () => {
    // Navigation simple : App gère la navigation via bouton (dispatch custom).
    window.dispatchEvent(new CustomEvent('navigate', { detail: 'products' }));
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg)', height: '100vh', overflow: 'hidden' }}>
      <div className="page-header">
        <div>
          <h1>Alertes stock</h1>
          <div style={{ color: 'var(--muted)', marginTop: '4px', fontSize: '13px' }}>
            Produits en rupture ou sous le seuil minimum de réapprovisionnement
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-primary" onClick={goToProducts}>Gérer les produits</button>
          <button className="btn btn-ghost" onClick={load}>Actualiser</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
        {isLoading ? (
          <div className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {Array.from({ length: 5 }).map((_, i) => (
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
    </div>
  );
};
