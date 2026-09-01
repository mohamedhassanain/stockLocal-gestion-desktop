import React, { useEffect, useState, useCallback } from 'react';
import { toast } from '../stores/useToastStore';
import { Button, Card, CardBody, CardHeader, PageHeader, StatCard } from '../components/ui';
import type { DashboardStats, TopProduct, TopClient, LowStockAlert, UpcomingDue, RevenuePoint, AlertSummary } from '../repositories/DashboardRepository';
import { formatAxisValue } from '../utils/chartFormat';

const EmptyState: React.FC<{ icon: string; text: string; good?: boolean }> = ({ icon, text, good }) => (
  <div className="text-center text-sm font-semibold" style={{ padding: 16, color: good ? 'var(--success)' : 'var(--muted)' }}>
    {good ? '✅' : icon} {text}
  </div>
);

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

/** Génère la liste complète des labels (jours ou mois) d'une période, pour que
 *  la courbe s'affiche TOUJOURS même si certains jours/mois n'ont pas de vente. */
function buildPeriodLabels(period: string): string[] {
  const now = new Date();
  const labels: string[] = [];
  if (period === 'week') {
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      labels.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
  } else if (period === 'month') {
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      labels.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
  } else {
    const months = period === 'year' ? 12 : period === '3months' ? 3 : 6;
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      labels.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
  }
  return labels;
}

// ─── Page Tableau de Bord ─────────────────────────────────────────────────────
export const DashboardPage: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [topClients, setTopClients] = useState<TopClient[]>([]);
  const [lowStock, setLowStock] = useState<LowStockAlert[]>([]);
  const [dues, setDues] = useState<UpcomingDue[]>([]);
  const [monthlyRevenue, setMonthlyRevenue] = useState<RevenuePoint[]>([]);
  const [alertSummary, setAlertSummary] = useState<AlertSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [dueDays, setDueDays] = useState(30);
  const [revenuePeriod, setRevenuePeriod] = useState('6months');
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [s, tp, tc, ls, d, backups, mr, alerts] = await Promise.all([
        window.api.dashboard.getStats(),
        window.api.dashboard.getTopProducts(),
        window.api.dashboard.getTopClients(),
        window.api.dashboard.getLowStock(),
        window.api.dashboard.getUpcomingDues(dueDays),
        window.api.backup.list(),
        window.api.dashboard.getRevenue(revenuePeriod),
        window.api.dashboard.getAlertSummary(),
      ]);
      setStats(s);
      setTopProducts(tp);
      setTopClients(tc);
      setLowStock(ls);
      setDues(d);
      setMonthlyRevenue(mr);
      setAlertSummary(alerts);
      if (backups.length > 0) setLastBackup(backups[0].date);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  }, [dueDays, revenuePeriod]);

  useEffect(() => { load(); }, [load]);

  const handleBackupNow = async () => {
    try {
      const result = await window.api.backup.now();
      if (result.success) {
        toast.success(`Sauvegarde créée : ${result.path}`);
        load();
      } else {
        toast.error(result.error);
      }
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleReport = async () => {
    try {
      const result = await window.api.reports.generate();
      if (!result.success) throw new Error(result.error);
      toast.success('Rapport PDF généré avec succès.');
    } catch (e: any) {
      toast.error(`Erreur : ${e.message}`);
    }
  };

  const handleExportCsv = async () => {
    try {
      const result = await window.api.reports.exportCsv({
        stats,
        topProducts,
        topClients,
        lowStock,
        dues,
      });
      if (!result.success) throw new Error(result.error);
      toast.success(`Rapport Excel (CSV) exporté : ${result.filePath}`);
    } catch (e: any) {
      toast.error(`Erreur : ${e.message}`);
    }
  };

  // Navigation vers une autre page (événement écouté par App). `status` filtre les factures.
  const navigate = (page: string, status?: string) => {
    window.dispatchEvent(new CustomEvent('navigate', { detail: status ? { page, status } : page }));
  };

  if (isLoading) {
    return (
      <div className="page-shell">
        <div className="flex flex-1 items-center" style={{ justifyContent: 'center' }}>
          <div className="text-center text-secondary">
            <div style={{ fontSize: 40, marginBottom: 12 }}>⏳</div>
            <div className="font-semibold" style={{ fontSize: 15 }}>Chargement du tableau de bord…</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <PageHeader
        icon="📊"
        title="Tableau de bord"
        subtitle={new Date().toLocaleDateString('fr-MA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        actions={
          <>
            {lastBackup && (
              <span className="badge badge-muted text-sm" style={{ whiteSpace: 'nowrap' }}>
                💾 Dernière sauvegarde : {lastBackup}
              </span>
            )}
            <Button variant="success" onClick={handleExportCsv}>📊 Export Excel</Button>
            <Button variant="secondary" onClick={handleReport}>📄 Rapport PDF</Button>
            <Button onClick={handleBackupNow}>💾 Sauvegarder</Button>
            <Button variant="ghost" onClick={load}>🔄 Actualiser</Button>
          </>
        }
      />

      <div className="page-content">
        {/* KPI Cards */}
        <div className="flex gap-3" style={{ flexWrap: 'wrap' }}>
          <StatCard icon="💰" label="CA Aujourd'hui" value={`${stats?.revenue_today.toFixed(2) ?? '0.00'} MAD`} sub={`${stats?.sales_count_today ?? 0} facture(s)`} tone="primary" onClick={() => navigate('invoices')} />
          <StatCard icon="📈" label="CA Ce Mois" value={`${stats?.revenue_month.toFixed(2) ?? '0.00'} MAD`} sub={`${stats?.sales_count_month ?? 0} facture(s)`} tone="success" onClick={() => navigate('invoices')} />
          <StatCard icon="💹" label="Marge (mois)" value={`${stats?.gross_margin_month.toFixed(2) ?? '0.00'} MAD`} softBg="var(--accent-soft)" onClick={() => navigate('reports')} />
          <StatCard icon="📦" label="Valeur du stock" value={`${stats?.total_stock_value.toFixed(2) ?? '0.00'} MAD`} tone="info" onClick={() => navigate('stock')} />
          <StatCard icon="⚠️" label="Impayés clients" value={`${stats?.unpaid_total.toFixed(2) ?? '0.00'} MAD`} sub="Factures non soldées" tone="danger" onClick={() => navigate('invoices', 'UNPAID')} />
          <StatCard icon="🏭" label="Dettes fournisseurs" value={`${stats?.supplier_debt_total.toFixed(2) ?? '0.00'} MAD`} sub="Crédits fournisseurs en cours" tone="warning" onClick={() => navigate('suppliers')} />
        </div>

        {/* Résumé des alertes */}
        {alertSummary && (
          <div className="stat-grid">
            <StatCard label="Stock bas" value={alertSummary.low_stock_count} icon="📦" tone="warning" />
            <StatCard label="Impayés" value={alertSummary.unpaid_count} icon="💰" tone="danger" />
            <StatCard label="En retard" value={alertSummary.overdue_count} icon="⏰" tone="danger" />
            <StatCard label="Échéance J-7" value={alertSummary.expiring_soon_count} icon="📅" tone="warning" />
          </div>
        )}

        {/* Évolution du CA */}
        <Card padding>
          <div className="flex justify-between items-center" style={{ flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <h3 className="section-title" style={{ margin: 0 }}>
              <span>📈</span>Évolution du chiffre d'affaires
            </h3>
            <div className="flex gap-1">
              {([['week', 'Semaine'], ['month', 'Mois'], ['3months', '3 mois'], ['6months', '6 mois'], ['year', '1 an']] as const).map(([period, label]) => (
                <button
                  key={period}
                  onClick={() => setRevenuePeriod(period)}
                  className={`btn btn-sm ${revenuePeriod === period ? 'btn-primary' : 'btn-secondary'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {(() => {
            const labels = buildPeriodLabels(revenuePeriod);
            const points = labels.map(label => {
              const found = monthlyRevenue.find(m => m.label === label);
              return { label, revenue: found?.revenue ?? 0, margin: found?.margin ?? 0, invoice_count: found?.invoice_count ?? 0 };
            });
            const totalInvoices = points.reduce((s, p) => s + p.invoice_count, 0);
            const totalMargin = points.reduce((s, p) => s + p.margin, 0);

            // ─── Graphique en LIGNE (SVG fait main — aucune dépendance) ──────
            const CHART_W = 640;
            const CHART_H = 220;
            const PAD_LEFT = 56;
            const PAD_RIGHT = 18;
            const PAD_TOP = 16;
            const PAD_BOTTOM = 30;
            const PLOT_INSET_BOTTOM = 8; // évite qu'une ligne à 0 soit « écrasée » contre l'axe
            const plotLeft = PAD_LEFT;
            const plotRight = CHART_W - PAD_RIGHT;
            const plotTop = PAD_TOP;
            const plotBottom = CHART_H - PAD_BOTTOM - PLOT_INSET_BOTTOM;
            const plotW = plotRight - plotLeft;
            const plotH = plotBottom - plotTop;

            const dataMax = Math.max(...points.map(p => p.revenue), 0);
            const scaleMax = dataMax > 0 ? dataMax : 1; // évite div/0 et reste lisible si tout à 0

            const xFor = (i: number) => points.length === 1 ? plotLeft + plotW / 2 : plotLeft + (i / (points.length - 1)) * plotW;
            const yFor = (v: number) => plotBottom - (v / scaleMax) * plotH;

            const ySteps = [0, 0.25, 0.5, 0.75, 1];

            const maxXLabels = 7;
            const xLabelStep = Math.max(1, Math.ceil(points.length / maxXLabels));
            const showXLabel = (i: number) => i % xLabelStep === 0 || i === points.length - 1;
            const showValueLabels = points.length <= 12;

            const linePoints = points.map((p, i) => `${xFor(i)},${yFor(p.revenue)}`).join(' ');

            const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
              if (points.length === 0) return;
              const rect = e.currentTarget.getBoundingClientRect();
              if (rect.width === 0) return;
              const svgX = ((e.clientX - rect.left) / rect.width) * CHART_W;
              const idx = points.length === 1 ? 0 : Math.round(((svgX - plotLeft) / plotW) * (points.length - 1));
              setHoverIndex(Math.max(0, Math.min(points.length - 1, idx)));
            };
            const handleMouseLeave = () => setHoverIndex(null);

            const footer = (
              <div className="flex gap-4 text-sm text-secondary" style={{ marginTop: 12, justifyContent: 'center' }}>
                <span>📊 {totalInvoices} factures au total</span>
                <span className="text-success">💹 Marge totale : {totalMargin.toFixed(2)} MAD</span>
              </div>
            );

            // Cas explicite : aucune vente sur toute la période → état vide clair.
            if (dataMax === 0) {
              return (
                <>
                  <div style={{ overflowX: 'auto' }}>
                    <svg
                      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
                      style={{ width: '100%', height: 'auto', display: 'block', minWidth: 320 }}
                      role="img"
                      aria-label="Évolution du chiffre d'affaires"
                    >
                      {/* Axe X (bas) + unique repère Y à 0 */}
                      <line x1={plotLeft} y1={CHART_H - PAD_BOTTOM} x2={plotRight} y2={CHART_H - PAD_BOTTOM} style={{ stroke: 'var(--border-strong)' }} strokeWidth="1" />
                      <text x={plotLeft - 8} y={CHART_H - PAD_BOTTOM + 4} textAnchor="end" fontSize="11" style={{ fill: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>0</text>
                      {/* Ligne plate à 0 (discrète, pointillée) */}
                      <line x1={plotLeft} y1={plotBottom} x2={plotRight} y2={plotBottom} style={{ stroke: 'var(--primary)' }} strokeWidth="2.5" strokeDasharray="4 4" />
                      {/* Marqueurs à 0 */}
                      {points.map((p, i) => (
                        <rect key={p.label} x={xFor(i) - 4} y={plotBottom - 4} width="8" height="8" style={{ fill: 'var(--primary)' }} />
                      ))}
                    </svg>
                  </div>
                  <EmptyState icon="📈" text="Aucune vente enregistrée sur cette période." />
                  {footer}
                </>
              );
            }

            return (
              <>
                <div style={{ overflowX: 'auto' }}>
                  <svg
                    viewBox={`0 0 ${CHART_W} ${CHART_H}`}
                    style={{ width: '100%', height: 'auto', display: 'block', minWidth: 320 }}
                    role="img"
                    aria-label="Évolution du chiffre d'affaires"
                    onMouseMove={handleMouseMove}
                    onMouseLeave={handleMouseLeave}
                  >
                    {/* Grille horizontale + valeurs axe Y */}
                    {ySteps.map((f) => {
                      const y = plotBottom - f * plotH;
                      const val = f * scaleMax;
                      return (
                        <g key={f}>
                          <line x1={plotLeft} y1={y} x2={plotRight} y2={y} style={{ stroke: 'var(--border)' }} strokeDasharray="3 3" strokeWidth="1" />
                          <text x={plotLeft - 8} y={y + 4} textAnchor="end" fontSize="11" style={{ fill: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{formatAxisValue(val, scaleMax)}</text>
                        </g>
                      );
                    })}
                    {/* Grille verticale */}
                    {points.map((_, i) => (
                      <line key={i} x1={xFor(i)} y1={plotTop} x2={xFor(i)} y2={plotBottom} style={{ stroke: 'var(--border)' }} strokeDasharray="3 3" strokeWidth="1" />
                    ))}
                    {/* Axe X (bas) */}
                    <line x1={plotLeft} y1={CHART_H - PAD_BOTTOM} x2={plotRight} y2={CHART_H - PAD_BOTTOM} style={{ stroke: 'var(--border-strong)' }} strokeWidth="1" />

                    {/* Ligne continue reliant les points */}
                    {points.length > 1 && (
                      <polyline points={linePoints} fill="none" style={{ stroke: 'var(--primary)' }} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
                    )}

                    {/* Marqueurs carrés + tooltip, et valeur affichée si peu de points */}
                    {points.map((p, i) => (
                      <g key={p.label}>
                        <rect x={xFor(i) - 4} y={yFor(p.revenue) - 4} width="8" height="8" style={{ fill: 'var(--primary)' }} />
                        {showValueLabels && (
                          <text x={xFor(i)} y={yFor(p.revenue) - 10} textAnchor="middle" fontSize="11" fontWeight="600" style={{ fill: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{p.revenue.toFixed(0)}</text>
                        )}
                      </g>
                    ))}

                    {/* Labels axe X (sous-ensemble pour éviter le chevauchement) */}
                    {points.map((p, i) => (
                      showXLabel(i) && (
                        <text key={`x-${p.label}`} x={xFor(i)} y={CHART_H - 8} textAnchor="middle" fontSize="11" style={{ fill: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{p.label.slice(5)}</text>
                      )
                    ))}
                    {/* Tooltip au survol */}
                    {hoverIndex !== null && (() => {
                      const h = points[hoverIndex];
                      if (!h) return null;
                      const tx = xFor(hoverIndex);
                      const ty = yFor(h.revenue);
                      const boxW = 170, boxH = 78;
                      let boxX = tx + boxW + 10 > plotRight ? tx - boxW - 10 : tx + 10;
                      boxX = Math.max(plotLeft, Math.min(boxX, CHART_W - boxW - 8));
                      const boxY = Math.max(plotTop, ty - boxH - 8);
                      return (
                        <g>
                          <line x1={tx} y1={plotTop} x2={tx} y2={plotBottom} style={{ stroke: 'var(--primary)' }} strokeWidth="1" strokeDasharray="4 4" opacity="0.45" />
                          <rect x={tx - 6} y={ty - 6} width="12" height="12" style={{ fill: 'var(--primary)', stroke: 'var(--surface)', strokeWidth: 2 }} />
                          <g>
                            <rect x={boxX} y={boxY} width={boxW} height={boxH} rx="6" style={{ fill: 'var(--surface)', stroke: 'var(--border)' }} />
                            <text x={boxX + 10} y={boxY + 17} fontSize="11" style={{ fill: 'var(--muted)' }}>{h.label}</text>
                            <text x={boxX + 10} y={boxY + 36} fontSize="12" fontWeight="700" style={{ fill: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{h.revenue.toFixed(2)} MAD</text>
                            <text x={boxX + 10} y={boxY + 54} fontSize="11" style={{ fill: 'var(--text-secondary)' }}>Marge : {h.margin.toFixed(2)} MAD</text>
                            <text x={boxX + 10} y={boxY + 70} fontSize="11" style={{ fill: 'var(--text-secondary)' }}>{h.invoice_count} facture(s)</text>
                          </g>
                        </g>
                      );
                    })()}
                  </svg>
                </div>
                {footer}
              </>
            );
          })()}
        </Card>

        {/* Top Produits + Top Clients */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <Card padding>
            <h3 className="section-title mb-3">
              <span>🏆</span>Top produits du mois
            </h3>
            {topProducts.length === 0
              ? <EmptyState icon="🏆" text="Aucune vente ce mois-ci." />
              : topProducts.map((p, i) => (
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
            <h3 className="section-title mb-3">
              <span>🤝</span>Meilleurs clients du mois
            </h3>
            {topClients.length === 0
              ? <EmptyState icon="🤝" text="Aucun client ce mois-ci." />
              : topClients.map((c, i) => (
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

        {/* Alertes Stock + Échéances */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <Card padding>
            <h3 className="section-title mb-3">
              <span>🚨</span>Alertes stock ({lowStock.length})
            </h3>
            {lowStock.length === 0
              ? <EmptyState icon="🚨" text="Tous les stocks sont suffisants." good />
              : lowStock.map((item, i) => (
                <div key={item.id} className="flex justify-between items-center" style={{ padding: '9px 0', borderBottom: i < lowStock.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <div>
                    <div className="text-sm font-semibold">{item.designation}</div>
                    <div className="text-xs text-muted">{item.reference}</div>
                  </div>
                  <span className={item.current_stock <= 0 ? 'badge badge-danger' : 'badge badge-warning'}>
                    {item.current_stock <= 0 ? '🔴 Rupture' : `⚠️ ${item.current_stock} / ${item.min_stock}`}
                  </span>
                </div>
              ))}
          </Card>

          <Card overflow>
            <CardHeader>
              <h3 className="section-title" style={{ margin: 0 }}>
                <span>📅</span>Échéances ({dueDays} prochains jours)
              </h3>
              <div className="flex gap-1">
                {[7, 30].map(days => (
                  <button
                    key={days}
                    onClick={() => setDueDays(days)}
                    className={`btn btn-sm ${dueDays === days ? 'btn-primary' : 'btn-secondary'}`}
                  >
                    {days} j
                  </button>
                ))}
              </div>
            </CardHeader>
            <CardBody>
              {dues.length === 0
                ? <EmptyState icon="📅" text="Aucune échéance à venir." good />
                : dues.map((due, i) => {
                  const overdue = due.days_left < 0;
                  const urgent = due.days_left >= 0 && due.days_left <= 7;
                  return (
                    <div key={due.id} className="flex justify-between items-center" style={{ padding: '9px 0', borderBottom: i < dues.length - 1 ? '1px solid var(--border)' : 'none' }}>
                      <div>
                        <div className="text-sm font-semibold">{due.document_number}</div>
                        <div className="text-xs text-muted">{due.customer_name} · {due.due_date?.split('T')[0]}</div>
                      </div>
                      <div className="text-right">
                        <div className="money text-sm font-semibold text-danger">{due.remaining.toFixed(2)} MAD</div>
                        <span className={overdue ? 'badge badge-danger' : urgent ? 'badge badge-warning' : 'badge badge-muted'}>
                          {overdue ? `En retard (${Math.abs(due.days_left)}j)` : `J-${due.days_left}`}
                        </span>
                      </div>
                    </div>
                  );
                })}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
};
