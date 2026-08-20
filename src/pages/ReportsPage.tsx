import React, { useEffect, useState } from 'react';
import { toast } from '../stores/useToastStore';
import { Button, Card, PageHeader, StatCard } from '../components/ui';
import type { DashboardStats, TopProduct, TopClient } from '../repositories/DashboardRepository';

const RankBadge: React.FC<{ rank: number; variant?: 'primary' | 'accent' }> = ({ rank, variant = 'primary' }) => (
  <span
    className="flex items-center text-xs font-semibold"
    style={{
      width: 24,
      height: 24,
      background: variant === 'accent' ? 'var(--accent)' : 'var(--primary)',
      color: 'var(--surface)',
      borderRadius: '50%',
      flexShrink: 0,
      justifyContent: 'center',
    }}
  >
    {rank}
  </span>
);

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
    <div className="page-shell">
      <PageHeader
        title="Rapports"
        subtitle={`Synthèse de gestion — ${new Date().toLocaleDateString('fr-MA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`}
        actions={
          <>
            <Button variant="success" onClick={handleReportCsv}>Export Excel</Button>
            <Button onClick={() => handleReportPdf(month)}>Rapport PDF du mois</Button>
            <Button variant="ghost" onClick={load}>Actualiser</Button>
          </>
        }
      />

      <div className="page-content">
        {isLoading ? (
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} padding style={{ height: 110 }}>
                <div className="skeleton skeleton-row" style={{ width: '60%' }} />
              </Card>
            ))}
          </div>
        ) : (
          <>
            <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              <StatCard label="CA du jour" value={`${(stats?.revenue_today ?? 0).toFixed(2)} MAD`} sub={`${stats?.sales_count_today ?? 0} facture(s)`} />
              <StatCard label="CA de la semaine" value={`${(stats?.revenue_week ?? 0).toFixed(2)} MAD`} sub="7 derniers jours" />
              <StatCard label="CA du mois" value={`${(stats?.revenue_month ?? 0).toFixed(2)} MAD`} sub={`${stats?.sales_count_month ?? 0} facture(s)`} />
              <StatCard label="Marge du mois" value={`${(stats?.gross_margin_month ?? 0).toFixed(2)} MAD`} sub="Marge brute" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              <Card padding>
                <h3 className="mb-3" style={{ margin: '0 0 14px' }}>Top produits du mois</h3>
                {topProducts.length === 0 ? (
                  <div className="state-box"><div className="state-text">Aucune vente ce mois-ci.</div></div>
                ) : topProducts.map((p, i) => (
                  <div key={p.product_id} className="flex items-center gap-3" style={{ padding: '9px 0', borderBottom: i < topProducts.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <RankBadge rank={i + 1} />
                    <div className="flex-1" style={{ minWidth: 0 }}>
                      <div className="text-sm font-semibold" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.designation}</div>
                      <div className="text-xs text-muted">{p.reference}</div>
                    </div>
                    <div className="text-right" style={{ flexShrink: 0 }}>
                      <div className="qty text-sm font-semibold">{p.total_qty} u.</div>
                      <div className="money text-xs text-success">{p.total_revenue.toFixed(2)} MAD</div>
                    </div>
                  </div>
                ))}
              </Card>

              <Card padding>
                <h3 style={{ margin: '0 0 14px' }}>Meilleurs clients</h3>
                {topClients.length === 0 ? (
                  <div className="state-box"><div className="state-text">Aucun client ce mois-ci.</div></div>
                ) : topClients.map((c, i) => (
                  <div key={c.customer_id} className="flex items-center gap-3" style={{ padding: '9px 0', borderBottom: i < topClients.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <RankBadge rank={i + 1} variant="accent" />
                    <div className="flex-1">
                      <div className="text-sm font-semibold">{c.name}</div>
                      <div className="text-xs text-muted">{c.invoice_count} facture(s)</div>
                    </div>
                    <div className="money text-sm font-semibold" style={{ color: 'var(--primary)' }}>{c.total_revenue.toFixed(2)} MAD</div>
                  </div>
                ))}
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
