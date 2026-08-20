import React, { useEffect, useState } from 'react';
import type { DashboardStats, TopProduct, TopClient, LowStockAlert, UpcomingDue, MonthlyRevenue, AlertSummary } from '../repositories/DashboardRepository';

// ─── KPI Card ────────────────────────────────────────────────────────────────
const KpiCard: React.FC<{
  icon: string; label: string; value: string; sub?: string;
  soft: string;
}> = ({ icon, label, value, sub, soft }) => (
  <div
    style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      padding: '18px 20px',
      boxShadow: 'var(--shadow-sm)',
      flex: '1 1 200px',
      minWidth: '190px',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <span
        style={{
          fontSize: '20px',
          width: '38px',
          height: '38px',
          borderRadius: '10px',
          background: soft,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </span>
    </div>
    <div style={{ fontSize: '22px', fontWeight: '800', color: 'var(--text)', lineHeight: 1.1 }}>{value}</div>
    {sub && <div style={{ fontSize: '12px', color: 'var(--muted)' }}>{sub}</div>}
  </div>
);

// ─── Section avec titre ───────────────────────────────────────────────────────
const Section: React.FC<{ title: string; icon: string; children: React.ReactNode; right?: React.ReactNode }> = ({ title, icon, children, right }) => (
  <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', padding: '20px' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
      <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text)', fontSize: '15px', fontWeight: '700' }}>
        <span>{icon}</span>{title}
      </h3>
      {right}
    </div>
    {children}
  </div>
);

const EmptyState: React.FC<{ icon: string; text: string; good?: boolean }> = ({ icon, text, good }) => (
  <div style={{ padding: '20px', textAlign: 'center', color: good ? 'var(--success)' : 'var(--muted)', fontWeight: '600', fontSize: '13px' }}>
    {good ? '✅' : icon} {text}
  </div>
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
    const result = await window.api.backup.now();
    if (result.success) {
      alert(`✅ Sauvegarde créée : ${result.path}`);
      load();
    } else {
      alert(`❌ Erreur : ${result.error}`);
    }
  };

  const handleReport = async () => {
    try {
      const result = await window.api.reports.generate();
      if (!result.success) throw new Error(result.error);
    } catch (e: any) {
      alert(`❌ Erreur : ${e.message}`);
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
      alert(`✅ Rapport Excel (CSV) exporté : ${result.filePath}`);
    } catch (e: any) {
      alert(`❌ Erreur : ${e.message}`);
    }
  };

  if (isLoading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>⏳</div>
          <div style={{ fontSize: '15px', fontWeight: '600' }}>Chargement du tableau de bord…</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg)', height: '100vh', overflow: 'hidden' }}>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span>📊</span>Tableau de bord
          </h1>
          <div style={{ color: 'var(--muted)', marginTop: '4px', fontSize: '13px' }}>
            {new Date().toLocaleDateString('fr-MA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {lastBackup && (
            <span className="badge badge-muted" style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>
              💾 Dernière sauvegarde : {lastBackup}
            </span>
          )}
          <button className="btn btn-success" onClick={handleExportCsv}>📊 Export Excel</button>
          <button className="btn btn-secondary" onClick={handleReport}>📄 Rapport PDF</button>
          <button className="btn btn-primary" onClick={handleBackupNow}>💾 Sauvegarder</button>
          <button className="btn btn-ghost" onClick={load}>🔄 Actualiser</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

        {/* KPI Cards */}
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <KpiCard icon="💰" label="CA Aujourd'hui" value={`${stats?.revenue_today.toFixed(2) ?? '0.00'} MAD`} sub={`${stats?.sales_count_today ?? 0} facture(s)`} soft="#eff6ff" />
          <KpiCard icon="📈" label="CA Ce Mois" value={`${stats?.revenue_month.toFixed(2) ?? '0.00'} MAD`} sub={`${stats?.sales_count_month ?? 0} facture(s)`} soft="#f0fdf4" />
          <KpiCard icon="💹" label="Marge (mois)" value={`${stats?.gross_margin_month.toFixed(2) ?? '0.00'} MAD`} soft="#fffbeb" />
          <KpiCard icon="📦" label="Valeur du stock" value={`${stats?.total_stock_value.toFixed(2) ?? '0.00'} MAD`} soft="#f5f3ff" />
          <KpiCard icon="⚠️" label="Impayés" value={`${stats?.unpaid_total.toFixed(2) ?? '0.00'} MAD`} sub="Factures non soldées" soft="#fef2f2" />
        </div>

        {/* Résumé des alertes */}
        {alertSummary && (
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            {[
              { label: 'Stock bas', count: alertSummary.low_stock_count, icon: '📦', color: '#d97706', bg: '#fffbeb' },
              { label: 'Impayés', count: alertSummary.unpaid_count, icon: '💰', color: '#dc2626', bg: '#fef2f2' },
              { label: 'En retard', count: alertSummary.overdue_count, icon: '⏰', color: '#b91c1c', bg: '#fee2e2' },
              { label: 'Échéance J-7', count: alertSummary.expiring_soon_count, icon: '📅', color: '#ea580c', bg: '#fff7ed' },
            ].map(a => (
              <div key={a.label} style={{ flex: '1 1 180px', display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 16px', background: a.bg, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }}>
                <span style={{ fontSize: '22px' }}>{a.icon}</span>
                <div>
                  <div style={{ fontSize: '20px', fontWeight: '800', color: a.color, lineHeight: 1.1 }}>{a.count}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '600' }}>{a.label}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Évolution du CA */}
        {monthlyRevenue.length > 0 && (
          <Section title="Évolution du chiffre d'affaires (6 mois)" icon="📈">
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', height: '170px', padding: '0 8px' }}>
              {(() => {
                const maxRevenue = Math.max(...monthlyRevenue.map(m => m.revenue), 1);
                return monthlyRevenue.map((m) => {
                  const heightPct = (m.revenue / maxRevenue) * 100;
                  const monthLabel = m.month.slice(5);
                  return (
                    <div key={m.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                      <div style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text)' }}>{m.revenue.toFixed(0)}</div>
                      <div style={{ width: '100%', height: `${Math.max(heightPct, 4)}%`, background: 'linear-gradient(to top, #2563eb, #60a5fa)', borderRadius: '6px 6px 0 0', minHeight: '4px' }} />
                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '600' }}>{monthLabel}</div>
                    </div>
                  );
                });
              })()}
            </div>
            <div style={{ marginTop: '12px', display: 'flex', gap: '16px', justifyContent: 'center', fontSize: '12px', color: 'var(--text-secondary)' }}>
              <span>📊 {monthlyRevenue.reduce((s, m) => s + m.invoice_count, 0)} factures au total</span>
              <span style={{ color: 'var(--success)' }}>💹 Marge totale : {monthlyRevenue.reduce((s, m) => s + m.margin, 0).toFixed(2)} MAD</span>
            </div>
          </Section>
        )}

        {/* Top Produits + Top Clients */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          <Section title="Top produits du mois" icon="🏆">
            {topProducts.length === 0
              ? <EmptyState icon="🏆" text="Aucune vente ce mois-ci." />
              : topProducts.map((p, i) => (
                <div key={p.product_id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '9px 0', borderBottom: i < topProducts.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <span style={{ width: '24px', height: '24px', background: ['#d97706', '#64748b', '#b45309', '#6b7280', '#94a3b8'][i], color: '#fff', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: '700', flexShrink: 0 }}>{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: '600', fontSize: '13px', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.designation}</div>
                    <div style={{ fontSize: '11px', color: 'var(--muted)' }}>{p.reference}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontWeight: '700', color: 'var(--text)', fontSize: '13px' }}>{p.total_qty} u.</div>
                    <div style={{ fontSize: '12px', color: 'var(--success)' }}>{p.total_revenue.toFixed(2)} MAD</div>
                  </div>
                </div>
              ))}
          </Section>

          <Section title="Meilleurs clients du mois" icon="🤝">
            {topClients.length === 0
              ? <EmptyState icon="🤝" text="Aucun client ce mois-ci." />
              : topClients.map((c, i) => (
                <div key={c.customer_id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '9px 0', borderBottom: i < topClients.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <span style={{ width: '24px', height: '24px', background: ['#2563eb', '#8b5cf6', '#16a34a', '#64748b', '#94a3b8'][i], color: '#fff', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: '700', flexShrink: 0 }}>{i + 1}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: '600', fontSize: '13px', color: 'var(--text)' }}>{c.name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--muted)' }}>{c.invoice_count} facture(s)</div>
                  </div>
                  <div style={{ fontWeight: '700', color: 'var(--primary)', fontSize: '13px' }}>{c.total_revenue.toFixed(2)} MAD</div>
                </div>
              ))}
          </Section>
        </div>

        {/* Alertes Stock + Échéances */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          <Section title={`Alertes stock (${lowStock.length})`} icon="🚨">
            {lowStock.length === 0
              ? <EmptyState icon="🚨" text="Tous les stocks sont suffisants." good />
              : lowStock.map((item, i) => (
                <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: i < lowStock.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <div>
                    <div style={{ fontWeight: '600', fontSize: '13px', color: 'var(--text)' }}>{item.designation}</div>
                    <div style={{ fontSize: '11px', color: 'var(--muted)' }}>{item.reference}</div>
                  </div>
                  <span className={item.current_stock <= 0 ? 'badge badge-danger' : 'badge badge-warning'}>
                    {item.current_stock <= 0 ? '🔴 Rupture' : `⚠️ ${item.current_stock} / ${item.min_stock}`}
                  </span>
                </div>
              ))}
          </Section>

          <Section
            title={`Échéances (${dueDays} prochains jours)`}
            icon="📅"
            right={
              <div style={{ display: 'flex', gap: '4px' }}>
                {[7, 30].map(days => (
                  <button
                    key={days}
                    onClick={() => { setDueDays(days); load(); }}
                    style={{
                      padding: '4px 12px',
                      border: '1px solid var(--border-strong)',
                      borderRadius: 'var(--radius-md)',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: '700',
                      background: dueDays === days ? 'var(--primary)' : 'var(--surface)',
                      color: dueDays === days ? '#fff' : 'var(--text-secondary)',
                    }}
                  >
                    {days} j
                  </button>
                ))}
              </div>
            }
          >
            {dues.length === 0
              ? <EmptyState icon="📅" text="Aucune échéance à venir." good />
              : dues.map((due, i) => {
                const overdue = due.days_left < 0;
                const urgent = due.days_left >= 0 && due.days_left <= 7;
                return (
                  <div key={due.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: i < dues.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <div>
                      <div style={{ fontWeight: '600', fontSize: '13px', color: 'var(--text)' }}>{due.document_number}</div>
                      <div style={{ fontSize: '11px', color: 'var(--muted)' }}>{due.customer_name} · {due.due_date?.split('T')[0]}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: '700', color: 'var(--danger)', fontSize: '13px' }}>{due.remaining.toFixed(2)} MAD</div>
                      <span className={overdue ? 'badge badge-danger' : urgent ? 'badge badge-warning' : 'badge badge-muted'}>
                        {overdue ? `En retard (${Math.abs(due.days_left)}j)` : `J-${due.days_left}`}
                      </span>
                    </div>
                  </div>
                );
              })}
          </Section>
        </div>

      </div>
    </div>
  );
};
