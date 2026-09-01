import React, { useEffect, useState } from 'react';
import { toast } from '../stores/useToastStore';
import { Button, Card, PageHeader, StatCard } from '../components/ui';
import type { DashboardStats, TopProduct, TopClient, PaymentMethodTotal } from '../repositories/DashboardRepository';

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

// Palette pour le graphique à barres (produits) & le donut (modes de paiement).
// Cohérente avec le design system, mais contrastée pour distinguer chaque part.
const CHART_COLORS = ['var(--primary)', 'var(--accent)', 'var(--info)', 'var(--success)', 'var(--warning)', 'var(--danger)'];

// Libellés lisibles pour payment_method (vérifié : CASH, CHECK, TRANSFER dans database.sql).
const PAYMENT_LABELS: Record<string, string> = { CASH: 'Espèces', CHECK: 'Chèque', TRANSFER: 'Virement' };

const EmptyState: React.FC<{ icon: string; text: string }> = ({ icon, text }) => (
  <div className="text-center text-sm font-semibold" style={{ padding: 16, color: 'var(--muted)' }}>
    {icon} {text}
  </div>
);

/** Page Rapports (§3.2) — consolidation de gestion + exports PDF/CSV. */
export const ReportsPage: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [topClients, setTopClients] = useState<TopClient[]>([]);
  const [paymentsByMethod, setPaymentsByMethod] = useState<PaymentMethodTotal[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = async () => {
    setIsLoading(true);
    try {
      const [s, tp, tc, pm] = await Promise.all([
        window.api.dashboard.getStats(),
        window.api.dashboard.getTopProducts(),
        window.api.dashboard.getTopClients(),
        window.api.dashboard.getPaymentsByMethod(),
      ]);
      setStats(s);
      setTopProducts(tp);
      setTopClients(tc);
      setPaymentsByMethod(pm);
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

  // ─── Graphique à barres colorées (Top produits) ───────────────────────────
  const barChart = (() => {
    if (topProducts.length === 0) return <EmptyState icon="🏆" text="Aucune vente ce mois-ci." />;
    const maxRevenue = Math.max(...topProducts.map(p => p.total_revenue), 1);
    const W = 520, H = 200, PAD_L = 56, PAD_B = 30, PAD_T = 18;
    const plotW = W - PAD_L - 10, plotH = H - PAD_T - PAD_B;
    const barGap = 14;
    const barW = Math.max(16, (plotW - barGap * (topProducts.length - 1)) / topProducts.length);
    return (
      <div style={{ overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', minWidth: 320 }} role="img" aria-label="Top produits du mois">
          {/* Grille horizontale légère + labels */}
          {[0, 0.25, 0.5, 0.75, 1].map(f => {
            const y = H - PAD_B - f * plotH;
            const val = f * maxRevenue;
            return (
              <g key={f}>
                <line x1={PAD_L} y1={y} x2={W - 10} y2={y} style={{ stroke: 'var(--border)' }} strokeDasharray="3 3" strokeWidth="1" />
                <text x={PAD_L - 8} y={y + 4} textAnchor="end" fontSize="11" style={{ fill: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                  {val >= 1000 ? `${(val / 1000).toFixed(val >= 10000 ? 0 : 1)}k` : val.toFixed(0)}
                </text>
              </g>
            );
          })}
          {/* Axe X */}
          <line x1={PAD_L} y1={H - PAD_B} x2={W - 10} y2={H - PAD_B} style={{ stroke: 'var(--border-strong)' }} strokeWidth="1" />
          {topProducts.map((p, i) => {
            const barH = (p.total_revenue / maxRevenue) * plotH;
            const x = PAD_L + i * (barW + barGap);
            const y = H - PAD_B - barH;
            const color = CHART_COLORS[i % CHART_COLORS.length];
            return (
              <g key={p.product_id}>
                <title>{`${p.designation} : ${p.total_revenue.toFixed(2)} MAD`}</title>
                <rect x={x} y={y} width={barW} height={Math.max(barH, 2)} style={{ fill: color }} rx="4" />
                <text x={x + barW / 2} y={y - 6} textAnchor="middle" fontSize="10" fontWeight="600" style={{ fill: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{p.total_revenue.toFixed(0)}</text>
                <text x={x + barW / 2} y={H - PAD_B + 14} textAnchor="middle" fontSize="10" style={{ fill: 'var(--muted)' }}>{p.designation.length > 14 ? p.designation.slice(0, 13) + '…' : p.designation}</text>
              </g>
            );
          })}
        </svg>
      </div>
    );
  })();

  // ─── Donut (Répartition des encaissements par mode de paiement) ────────────
  const donutChart = (() => {
    if (paymentsByMethod.length === 0) return <EmptyState icon="💳" text="Aucun encaissement ce mois-ci." />;
    const W = 300, H = 260, cx = 150, cy = 110, r = 90;
    const total = paymentsByMethod.reduce((s, p) => s + p.total, 0);
    if (total <= 0) return <EmptyState icon="💳" text="Aucun encaissement ce mois-ci." />;
    let acc = 0;
    const segments = paymentsByMethod.map((pm, i) => {
      const frac = pm.total / total;
      const start = acc;
      acc += frac;
      const color = CHART_COLORS[i % CHART_COLORS.length];
      // Angles en degrés, convertis en radians pour les arcs SVG (path).
      const a0 = (start * 360) - 90, a1 = (acc * 360) - 90;
      const x0 = cx + r * Math.cos((a0 * Math.PI) / 180), y0 = cy + r * Math.sin((a0 * Math.PI) / 180);
      const x1 = cx + r * Math.cos((a1 * Math.PI) / 180), y1 = cy + r * Math.sin((a1 * Math.PI) / 180);
      const largeArc = a1 - a0 <= 180 ? 0 : 1;
      const path = `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${largeArc} 1 ${x1} ${y1} Z`;
      const pct = Math.round(frac * 100);
      // Texte du pourcentage au milieu du segment (à ~60% du rayon).
      const midA = ((start + acc / 2) * 360 - 90) * Math.PI / 180;
      const tx = cx + r * 0.62 * Math.cos(midA), ty = cy + r * 0.62 * Math.sin(midA);
      return { pm, color, path, pct, tx, ty };
    });
    const label = (v: string) => PAYMENT_LABELS[v] ?? v;
    return (
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: 300, height: 'auto', display: 'block' }} role="img" aria-label="Répartition des encaissements par mode de paiement">
          {segments.map(seg => (
            <g key={seg.pm.payment_method}>
              <path d={seg.path} style={{ fill: seg.color, stroke: 'var(--surface)', strokeWidth: 2 }} />
              {seg.pct >= 5 && <text x={seg.tx} y={seg.ty} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--surface)" style={{ fontFamily: 'var(--font-mono)' }}>{seg.pct}%</text>}
              <title>{`${label(seg.pm.payment_method)} : ${seg.pm.total.toFixed(2)} MAD (${seg.pct}%)`}</title>
            </g>
          ))}
          <text x={cx} y={cy - 4} textAnchor="middle" fontSize="11" style={{ fill: 'var(--muted)' }}>Total encaissé</text>
          <text x={cx} y={cy + 16} textAnchor="middle" fontSize="16" fontWeight="800" style={{ fill: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{total.toFixed(0)} MAD</text>
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {paymentsByMethod.map((pm, i) => (
            <div key={pm.payment_method} className="flex items-center gap-2 text-sm">
              <span style={{ width: 12, height: 12, borderRadius: 3, background: CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{label(pm.payment_method)}</span>
              <span className="money text-xs" style={{ color: 'var(--text-secondary)' }}>{pm.total.toFixed(2)} MAD</span>
            </div>
          ))}
        </div>
      </div>
    );
  })();

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
                {barChart}
                {/* Liste textuelle complémentaire (pour les détails qty/référence) */}
                {topProducts.length > 0 && (
                  <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                    {topProducts.map((p, i) => (
                      <div key={p.product_id} className="flex items-center gap-3" style={{ padding: '7px 0' }}>
                        <RankBadge rank={i + 1} />
                        <div className="flex-1" style={{ minWidth: 0 }}>
                          <div className="text-sm font-semibold" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.designation}</div>
                          <div className="text-xs text-muted">{p.reference} · {p.total_qty} u.</div>
                        </div>
                        <div className="money text-xs text-success">{p.total_revenue.toFixed(2)} MAD</div>
                      </div>
                    ))}
                  </div>
                )}
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

            {/* Donut : Répartition des encaissements par mode de paiement */}
            <Card padding>
              <h3 style={{ margin: '0 0 14px' }}>💳 Répartition des encaissements par mode de paiement</h3>
              {donutChart}
            </Card>
          </>
        )}
      </div>
    </div>
  );
};
