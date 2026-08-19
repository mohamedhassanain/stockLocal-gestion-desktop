import React, { useEffect, useState } from 'react';
import type { DashboardStats, TopProduct, TopClient, LowStockAlert, UpcomingDue, MonthlyRevenue, AlertSummary } from '../repositories/DashboardRepository';

// ─── KPI Card ────────────────────────────────────────────────────────────────
const KpiCard: React.FC<{
  icon: string; label: string; value: string; sub?: string;
  color: string; bgColor: string;
}> = ({ icon, label, value, sub, color, bgColor }) => (
  <div style={{ background: 'white', borderRadius: '14px', padding: '22px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', borderTop: `4px solid ${color}`, flex: 1, minWidth: '180px' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
      <span style={{ fontSize: '28px', background: bgColor, padding: '8px', borderRadius: '10px' }}>{icon}</span>
      <span style={{ fontSize: '13px', color: '#6b7280', fontWeight: '600' }}>{label}</span>
    </div>
    <div style={{ fontSize: '26px', fontWeight: '800', color: '#0f172a', lineHeight: 1 }}>{value}</div>
    {sub && <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '6px' }}>{sub}</div>}
  </div>
);

// ─── Section avec titre ───────────────────────────────────────────────────────
const Section: React.FC<{ title: string; icon: string; children: React.ReactNode }> = ({ title, icon, children }) => (
  <div style={{ background: 'white', borderRadius: '14px', padding: '22px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
    <h3 style={{ margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: '8px', color: '#0f172a', fontSize: '16px' }}>
      <span>{icon}</span>{title}
    </h3>
    {children}
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
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
        <div style={{ textAlign: 'center', color: '#6b7280' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⏳</div>
          <div style={{ fontSize: '18px' }}>Chargement du tableau de bord...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: '#f1f5f9', height: '100vh' }}>
      {/* Header */}
      <div style={{ padding: '28px 32px 20px', background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)', color: 'white' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '28px', fontWeight: '800' }}>📊 Tableau de Bord</h1>
            <div style={{ color: '#94a3b8', marginTop: '6px', fontSize: '14px' }}>
              {new Date().toLocaleDateString('fr-MA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            {lastBackup && <div style={{ fontSize: '12px', color: '#64748b', background: '#1e293b', padding: '6px 12px', borderRadius: '8px' }}>💾 Dernière sauvegarde : {lastBackup}</div>}
            <button onClick={handleExportCsv}
              style={{ padding: '10px 20px', background: '#16a34a', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '700', cursor: 'pointer' }}>
              📊 Export Excel
            </button>
            <button onClick={handleReport}
              style={{ padding: '10px 20px', background: '#f59e0b', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '700', cursor: 'pointer' }}>
              📄 Rapport PDF
            </button>
            <button onClick={handleBackupNow}
              style={{ padding: '10px 20px', background: '#22c55e', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '700', cursor: 'pointer' }}>
              💾 Sauvegarder maintenant
            </button>
            <button onClick={load}
              style={{ padding: '10px 16px', background: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', fontSize: '14px', cursor: 'pointer' }}>
              🔄 Actualiser
            </button>
          </div>
        </div>
      </div>

      <div style={{ padding: '24px 32px', display: 'flex', flexDirection: 'column', gap: '24px' }}>

        {/* KPI Cards */}
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <KpiCard icon="💰" label="CA Aujourd'hui" value={`${stats?.revenue_today.toFixed(2) ?? '0.00'} MAD`} sub={`${stats?.sales_count_today ?? 0} facture(s)`} color="#3b82f6" bgColor="#eff6ff" />
          <KpiCard icon="📅" label="CA Cette Semaine" value={`${stats?.revenue_week.toFixed(2) ?? '0.00'} MAD`} color="#8b5cf6" bgColor="#f5f3ff" />
          <KpiCard icon="📈" label="CA Ce Mois" value={`${stats?.revenue_month.toFixed(2) ?? '0.00'} MAD`} sub={`${stats?.sales_count_month ?? 0} facture(s)`} color="#10b981" bgColor="#f0fdf4" />
          <KpiCard icon="💹" label="Marge Brute (mois)" value={`${stats?.gross_margin_month.toFixed(2) ?? '0.00'} MAD`} color="#f59e0b" bgColor="#fffbeb" />
          <KpiCard icon="📦" label="Valeur du Stock" value={`${stats?.total_stock_value.toFixed(2) ?? '0.00'} MAD`} color="#6366f1" bgColor="#eef2ff" />
          <KpiCard icon="💹" label="Bénéfice Estimé (mois)" value={`${(stats?.gross_margin_month ?? 0).toFixed(2)} MAD`} sub={`Marge sur ${stats?.sales_count_month ?? 0} factures`} color="#10b981" bgColor="#f0fdf4" />
          <KpiCard icon="⚠️" label="Impayés" value={`${stats?.unpaid_total.toFixed(2) ?? '0.00'} MAD`} color="#ef4444" bgColor="#fef2f2" />
        </div>

        {/* Ligne 1.5 : Résumé des alertes */}
        {alertSummary && (
          <div style={{ display: 'flex', gap: '12px' }}>
            {[
              { label: 'Stock bas', count: alertSummary.low_stock_count, icon: '📦', color: '#f59e0b', bg: '#fffbeb' },
              { label: 'Impayés', count: alertSummary.unpaid_count, icon: '💰', color: '#ef4444', bg: '#fef2f2' },
              { label: 'En retard', count: alertSummary.overdue_count, icon: '⏰', color: '#dc2626', bg: '#fee2e2' },
              { label: 'Échéance J-7', count: alertSummary.expiring_soon_count, icon: '📅', color: '#f97316', bg: '#fff7ed' },
            ].map(a => (
              <div key={a.label} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px', padding: '16px 20px', background: a.bg, borderRadius: '12px', border: `2px solid ${a.color}20` }}>
                <span style={{ fontSize: '28px' }}>{a.icon}</span>
                <div>
                  <div style={{ fontSize: '24px', fontWeight: '800', color: a.color }}>{a.count}</div>
                  <div style={{ fontSize: '13px', color: '#6b7280', fontWeight: '600' }}>{a.label}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Ligne 2 : Évolution du CA */}
        {monthlyRevenue.length > 0 && (
          <Section title="Évolution du Chiffre d'Affaires (6 mois)" icon="📈">
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', height: '180px', padding: '0 8px' }}>
              {(() => {
                const maxRevenue = Math.max(...monthlyRevenue.map(m => m.revenue), 1);
                return monthlyRevenue.map((m) => {
                  const heightPct = (m.revenue / maxRevenue) * 100;
                  const monthLabel = m.month.slice(5); // "MM"
                  return (
                    <div key={m.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                      <div style={{ fontSize: '11px', fontWeight: '700', color: '#0f172a' }}>{m.revenue.toFixed(0)}</div>
                      <div style={{ width: '100%', height: `${Math.max(heightPct, 4)}%`, background: 'linear-gradient(to top, #3b82f6, #60a5fa)', borderRadius: '6px 6px 0 0', transition: 'height 0.3s', minHeight: '4px' }} />
                      <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: '600' }}>{monthLabel}</div>
                    </div>
                  );
                });
              })()}
            </div>
            <div style={{ marginTop: '12px', display: 'flex', gap: '16px', justifyContent: 'center' }}>
              <span style={{ fontSize: '12px', color: '#6b7280' }}>📊 {monthlyRevenue.reduce((s, m) => s + m.invoice_count, 0)} factures au total</span>
              <span style={{ fontSize: '12px', color: '#10b981' }}>💹 Marge totale : {monthlyRevenue.reduce((s, m) => s + m.margin, 0).toFixed(2)} MAD</span>
            </div>
          </Section>
        )}

        {/* Ligne 3 : Top Produits + Top Clients */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          <Section title="Top Produits du mois" icon="🏆">
            {topProducts.length === 0
              ? <div style={{ color: '#9ca3af', textAlign: 'center', padding: '20px' }}>Aucune vente ce mois-ci.</div>
              : topProducts.map((p, i) => (
                <div key={p.product_id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: i < topProducts.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                  <span style={{ width: '24px', height: '24px', background: ['#f59e0b', '#94a3b8', '#b45309', '#6b7280', '#6b7280'][i], color: 'white', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: '700', flexShrink: 0 }}>{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: '600', fontSize: '14px', color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.designation}</div>
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>{p.reference}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontWeight: '700', color: '#0f172a' }}>{p.total_qty} unités</div>
                    <div style={{ fontSize: '12px', color: '#10b981' }}>{p.total_revenue.toFixed(2)} MAD</div>
                  </div>
                </div>
              ))}
          </Section>

          <Section title="Meilleurs Clients du mois" icon="🤝">
            {topClients.length === 0
              ? <div style={{ color: '#9ca3af', textAlign: 'center', padding: '20px' }}>Aucun client ce mois-ci.</div>
              : topClients.map((c, i) => (
                <div key={c.customer_id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: i < topClients.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                  <span style={{ width: '24px', height: '24px', background: ['#3b82f6', '#8b5cf6', '#10b981', '#6b7280', '#6b7280'][i], color: 'white', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: '700', flexShrink: 0 }}>{i + 1}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: '600', fontSize: '14px', color: '#111827' }}>{c.name}</div>
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>{c.invoice_count} facture(s)</div>
                  </div>
                  <div style={{ fontWeight: '700', color: '#3b82f6' }}>{c.total_revenue.toFixed(2)} MAD</div>
                </div>
              ))}
          </Section>
        </div>

        {/* Ligne 3 : Alertes Stock + Échéances */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          <Section title={`Alertes Stock (${lowStock.length})`} icon="🚨">
            {lowStock.length === 0
              ? <div style={{ color: '#10b981', textAlign: 'center', padding: '20px', fontWeight: '600' }}>✅ Tous les stocks sont suffisants.</div>
              : lowStock.map(item => (
                <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
                  <div>
                    <div style={{ fontWeight: '600', fontSize: '14px', color: '#111827' }}>{item.designation}</div>
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>{item.reference}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ background: item.current_stock <= 0 ? '#fee2e2' : '#fef3c7', color: item.current_stock <= 0 ? '#991b1b' : '#92400e', padding: '4px 10px', borderRadius: '12px', fontSize: '13px', fontWeight: '700' }}>
                      {item.current_stock <= 0 ? '🔴 Rupture' : `⚠️ ${item.current_stock} / ${item.min_stock}`}
                    </span>
                  </div>
                </div>
              ))}
          </Section>

          <Section
            title={`Échéances (${dueDays} prochains jours)`}
            icon="📅"
          >
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              {[7, 30].map(days => (
                <button key={days} onClick={() => { setDueDays(days); load(); }}
                  style={{ padding: '6px 14px', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '700', background: dueDays === days ? '#0f172a' : '#f3f4f6', color: dueDays === days ? 'white' : '#6b7280' }}>
                  {days} jours
                </button>
              ))}
            </div>
            {dues.length === 0
              ? <div style={{ color: '#10b981', textAlign: 'center', padding: '20px', fontWeight: '600' }}>✅ Aucune échéance à venir.</div>
              : dues.map(due => {
                const overdue = due.days_left < 0;
                const urgent = due.days_left >= 0 && due.days_left <= 7;
                return (
                  <div key={due.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <div>
                      <div style={{ fontWeight: '600', fontSize: '14px', color: '#111827' }}>{due.document_number}</div>
                      <div style={{ fontSize: '12px', color: '#6b7280' }}>{due.customer_name} · {due.due_date?.split('T')[0]}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: '700', color: '#ef4444', fontSize: '14px' }}>{due.remaining.toFixed(2)} MAD</div>
                      <span style={{ background: overdue ? '#fee2e2' : urgent ? '#fef3c7' : '#f1f5f9', color: overdue ? '#991b1b' : urgent ? '#92400e' : '#374151', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: '700' }}>
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
