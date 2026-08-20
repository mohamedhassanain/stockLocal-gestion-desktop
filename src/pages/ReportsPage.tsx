import React, { useEffect, useState } from 'react';
import { toast } from '../stores/useToastStore';
import type { DashboardStats, TopProduct, TopClient } from '../repositories/DashboardRepository';

/** Page Rapports (§3.2) — consolidation de gestion + exports PDF/CSV. */
export const ReportsPage: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [topClients, setTopClients] = useState<TopClient[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = async () => {
    setIsLoading(true);
    try {
      const [s, tp, tc] = await Promise.all([
        window.api.dashboard.getStats(),
        window.api.dashboard.getTopProducts(),
        window.api.dashboard.getTopClients(),
      ]);
      setStats(s);
      setTopProducts(tp);
      setTopClients(tc);
    } catch (e: any) {
      toast.error(`Impossible de charger le rapport : ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleReportPdf = async (month?: string) => {
    try {
      const result = await window.api.reports.generate(month);
      if (!result.success) throw new Error(result.error);
      toast.success('Rapport PDF généré.');
    } catch (e: any) {
      toast.error(`Erreur : ${e.message}`);
    }
  };

  const handleReportCsv = async () => {
    try {
      const result = await window.api.reports.exportCsv({ stats, topProducts, topClients, lowStock: [], dues: [] });
      if (!result.success) throw new Error(result.error);
      toast.success(`Rapport Excel exporté : ${result.filePath}`);
    } catch (e: any) {
      toast.error(`Erreur : ${e.message}`);
    }
  };

  const month = new Date().toISOString().slice(0, 7);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg)', height: '100vh', overflow: 'hidden' }}>
      <div className="page-header">
        <div>
          <h1>Rapports</h1>
          <div style={{ color: 'var(--muted)', marginTop: '4px', fontSize: '13px' }}>
            Synthèse de gestion — {new Date().toLocaleDateString('fr-MA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-success" onClick={handleReportCsv}>Export Excel</button>
          <button className="btn btn-primary" onClick={() => handleReportPdf(month)}>Rapport PDF du mois</button>
          <button className="btn btn-ghost" onClick={load}>Actualiser</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {isLoading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="card" style={{ height: '110px' }}><div className="skeleton skeleton-row" style={{ width: '60%' }} /></div>
            ))}
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
              {[
                { label: 'CA du jour', value: stats?.revenue_today ?? 0, sub: `${stats?.sales_count_today ?? 0} facture(s)` },
                { label: 'CA de la semaine', value: stats?.revenue_week ?? 0, sub: '7 derniers jours' },
                { label: 'CA du mois', value: stats?.revenue_month ?? 0, sub: `${stats?.sales_count_month ?? 0} facture(s)` },
                { label: 'Marge du mois', value: stats?.gross_margin_month ?? 0, sub: 'Marge brute' },
              ].map((kpi) => (
                <div key={kpi.label} className="card" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{kpi.label}</span>
                  <span className="money" style={{ fontSize: '22px', fontWeight: '800', color: 'var(--text)' }}>
                    {kpi.value.toFixed(2)} MAD
                  </span>
                  <span style={{ fontSize: '12px', color: 'var(--muted)' }}>{kpi.sub}</span>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              <div className="card" style={{ padding: '20px' }}>
                <h3 style={{ margin: '0 0 14px' }}>Top produits du mois</h3>
                {topProducts.length === 0 ? (
                  <div className="state-box"><div className="state-text">Aucune vente ce mois-ci.</div></div>
                ) : topProducts.map((p, i) => (
                  <div key={p.product_id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '9px 0', borderBottom: i < topProducts.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <span style={{ width: '24px', height: '24px', background: 'var(--primary)', color: '#fff', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: '700', flexShrink: 0 }}>{i + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: '600', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.designation}</div>
                      <div style={{ fontSize: '11px', color: 'var(--muted)' }}>{p.reference}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div className="qty" style={{ fontWeight: '700', fontSize: '13px' }}>{p.total_qty} u.</div>
                      <div className="money" style={{ fontSize: '12px', color: 'var(--success)' }}>{p.total_revenue.toFixed(2)} MAD</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="card" style={{ padding: '20px' }}>
                <h3 style={{ margin: '0 0 14px' }}>Meilleurs clients</h3>
                {topClients.length === 0 ? (
                  <div className="state-box"><div className="state-text">Aucun client ce mois-ci.</div></div>
                ) : topClients.map((c, i) => (
                  <div key={c.customer_id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '9px 0', borderBottom: i < topClients.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <span style={{ width: '24px', height: '24px', background: 'var(--accent)', color: '#fff', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: '700', flexShrink: 0 }}>{i + 1}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: '600', fontSize: '13px' }}>{c.name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--muted)' }}>{c.invoice_count} facture(s)</div>
                    </div>
                    <div className="money" style={{ fontWeight: '700', color: 'var(--primary)', fontSize: '13px' }}>{c.total_revenue.toFixed(2)} MAD</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
