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

// Palette du donut (modes de paiement) — cohérente avec le design system.
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

  // ─── Donut (Répartition des encaissements par mode de paiement) ────────────
  const donutChart = (() => {
    if (paymentsByMethod.length === 0) return <EmptyState icon="💳" text="Aucun encaissement ce mois-ci." />;
    const total = paymentsByMethod.reduce((s, p) => s + p.total, 0);
    if (total <= 0) return <EmptyState icon="💳" text="Aucun encaissement ce mois-ci." />;
    const label = (v: string) => PAYMENT_LABELS[v] ?? v;

    // Anneau creux → le centre reste propre, le total est lisible, les % ne
    // chevauchent jamais le texte central.
    const W = 320, H = 280;
    const cx = 130, cy = 130, r = 104, ir = 64;
    const midR = (r + ir) / 2;
    const ringW = r - ir;

    // ── Cas : un seul mode → anneau plein d'une couleur (100%) ──
    if (paymentsByMethod.length === 1) {
      const pm = paymentsByMethod[0];
      const color = CHART_COLORS[0];
      return (
        <div style={{ display: 'flex', gap: 28, alignItems: 'center', flexWrap: 'wrap' }}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: 320, height: 'auto', display: 'block' }} role="img" aria-label="Répartition des encaissements">
            <circle cx={cx} cy={cy} r={midR} fill="none" stroke={color} strokeWidth={ringW} />
            <text x={cx} y={cy - 6} textAnchor="middle" fontSize="11" style={{ fill: 'var(--muted)' }}>Total encaissé</text>
            <text x={cx} y={cy + 18} textAnchor="middle" fontSize="20" fontWeight="800" style={{ fill: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{total.toFixed(0)} MAD</text>
          </svg>
          <div className="flex items-center gap-3">
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: color, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{label(pm.payment_method)}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{pm.total.toFixed(2)} MAD · 100%</div>
            </div>
          </div>
        </div>
      );
    }

    // ── Cas : plusieurs modes → anneaux segmentés ──
    let acc = 0;
    const segments = paymentsByMethod.map((pm, i) => {
      const frac = pm.total / total;
      const start = acc;
      acc += frac;
      const color = CHART_COLORS[i % CHART_COLORS.length];
      const a0 = (start * 360) - 90, a1 = (acc * 360) - 90;
      const largeArc = a1 - a0 <= 180 ? 0 : 1;
      const ox0 = cx + r * Math.cos((a0 * Math.PI) / 180), oy0 = cy + r * Math.sin((a0 * Math.PI) / 180);
      const ox1 = cx + r * Math.cos((a1 * Math.PI) / 180), oy1 = cy + r * Math.sin((a1 * Math.PI) / 180);
      const ix1 = cx + ir * Math.cos((a1 * Math.PI) / 180), iy1 = cy + ir * Math.sin((a1 * Math.PI) / 180);
      const ix0 = cx + ir * Math.cos((a0 * Math.PI) / 180), iy0 = cy + ir * Math.sin((a0 * Math.PI) / 180);
      const path = `M ${ox0} ${oy0} A ${r} ${r} 0 ${largeArc} 1 ${ox1} ${oy1} L ${ix1} ${iy1} A ${ir} ${ir} 0 ${largeArc} 0 ${ix0} ${iy0} Z`;
      const pct = Math.round(frac * 100);
      const midFrac = start + frac / 2;
      const midA = (midFrac * 360 - 90) * Math.PI / 180;
      const tx = cx + midR * Math.cos(midA), ty = cy + midR * Math.sin(midA);
      return { pm, color, path, pct, tx, ty };
    });

    return (
      <div style={{ display: 'flex', gap: 28, alignItems: 'center', flexWrap: 'wrap' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: 320, height: 'auto', display: 'block' }} role="img" aria-label="Répartition des encaissements par mode de paiement">
          {segments.map(seg => (
            <g key={seg.pm.payment_method}>
              <path d={seg.path} style={{ fill: seg.color }} />
              {seg.pct >= 6 && (
                <text x={seg.tx} y={seg.ty} textAnchor="middle" fontSize="12" fontWeight="800" fill="var(--surface)" style={{ fontFamily: 'var(--font-mono)', pointerEvents: 'none' }}>{seg.pct}%</text>
              )}
              <title>{`${label(seg.pm.payment_method)} : ${seg.pm.total.toFixed(2)} MAD (${seg.pct}%)`}</title>
            </g>
          ))}
          <text x={cx} y={cy - 6} textAnchor="middle" fontSize="11" style={{ fill: 'var(--muted)' }}>Total encaissé</text>
          <text x={cx} y={cy + 18} textAnchor="middle" fontSize="20" fontWeight="800" style={{ fill: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{total.toFixed(0)} MAD</text>
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {paymentsByMethod.map((pm, i) => (
            <div key={pm.payment_method} className="flex items-center gap-3">
              <span style={{ width: 12, height: 12, borderRadius: '50%', background: CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{label(pm.payment_method)}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{pm.total.toFixed(2)} MAD · {Math.round((pm.total / total) * 100)}%</div>
              </div>
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
              {/* Top produits du mois — liste épurée (pas de graphique à barres) */}
              <Card padding>
                <h3 style={{ margin: '0 0 14px' }}>Top produits du mois</h3>
                {topProducts.length === 0 ? (
                  <div className="state-box"><div className="state-text">Aucune vente ce mois-ci.</div></div>
                ) : topProducts.map((p, i) => (
                  <div key={p.product_id} className="flex items-center gap-3" style={{ padding: '9px 0', borderBottom: i < topProducts.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <RankBadge rank={i + 1} />
                    <div className="flex-1" style={{ minWidth: 0 }}>
                      <div className="text-sm font-semibold" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.designation}</div>
                      <div className="text-xs text-muted">{p.reference} · {p.total_qty} u.</div>
                    </div>
                    <div className="money text-xs" style={{ color: 'var(--success)', whiteSpace: 'nowrap' }}>{p.total_revenue.toFixed(2)} MAD</div>
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
                    <div className="money text-sm font-semibold" style={{ color: 'var(--primary)', whiteSpace: 'nowrap' }}>{c.total_revenue.toFixed(2)} MAD</div>
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
