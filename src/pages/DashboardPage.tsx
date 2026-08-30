import React, { useEffect, useState } from 'react';
import { toast } from '../stores/useToastStore';
import { Button, Card, CardBody, CardHeader, PageHeader, StatCard } from '../components/ui';
import type { DashboardStats, TopProduct, TopClient, LowStockAlert, UpcomingDue, MonthlyRevenue, AlertSummary } from '../repositories/DashboardRepository';

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

// ─── Page Tableau de Bord ─────────────────────────────────────────────────────
export const DashboardPage: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [topClients, setTopClients] = useState<TopClient[]>([]);
  const [lowStock, setLowStock] = useState<LowStockAlert[]>([]);
  const [dues, setDues] = useState<UpcomingDue[]>([]);
  const [monthlyRevenue, setMonthlyRevenue] = useState<MonthlyRevenue[]>([]);
  const [alertSummary, setAlertSummary] = useState<AlertSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [dueDays, setDueDays] = useState(30);

  const load = async () => {
    setIsLoading(true);
    try {
      const [s, tp, tc, ls, d, backups, mr, alerts] = await Promise.all([
        window.api.dashboard.getStats(),
        window.api.dashboard.getTopProducts(),
        window.api.dashboard.getTopClients(),
        window.api.dashboard.getLowStock(),
        window.api.dashboard.getUpcomingDues(dueDays),
        window.api.backup.list(),
        window.api.dashboard.getMonthlyRevenue(6),
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
  };

  useEffect(() => { load(); }, []);

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
        {monthlyRevenue.length > 0 && (
          <Card padding>
            <h3 className="section-title mb-3">
              <span>📈</span>Évolution du chiffre d'affaires (6 mois)
            </h3>
            <div className="flex items-center gap-2" style={{ height: 160, padding: '0 8px', alignItems: 'flex-end' }}>
              {(() => {
                const maxRevenue = Math.max(...monthlyRevenue.map(m => m.revenue), 1);
                return monthlyRevenue.map((m) => {
                  const heightPct = (m.revenue / maxRevenue) * 100;
                  const monthLabel = m.month.slice(5);
                  return (
                    <div key={m.month} className="flex flex-1 items-center gap-1" style={{ flexDirection: 'column' }}>
                      <div className="money text-xs font-semibold">{m.revenue.toFixed(0)}</div>
                      <div style={{ width: '100%', height: `${Math.max(heightPct, 4)}%`, background: 'linear-gradient(to top, var(--primary), var(--sidebar-active))', borderRadius: '6px 6px 0 0', minHeight: 4 }} />
                      <div className="money text-sm text-secondary font-semibold">{monthLabel}</div>
                    </div>
                  );
                });
              })()}
            </div>
            <div className="flex gap-4 text-sm text-secondary" style={{ marginTop: 12, justifyContent: 'center' }}>
              <span>📊 {monthlyRevenue.reduce((s, m) => s + m.invoice_count, 0)} factures au total</span>
              <span className="text-success">💹 Marge totale : {monthlyRevenue.reduce((s, m) => s + m.margin, 0).toFixed(2)} MAD</span>
            </div>
          </Card>
        )}

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
                    onClick={() => { setDueDays(days); load(); }}
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
