import React, { useEffect, useState } from 'react';
import { useClientStore } from '../stores/useClientStore';
import { toast } from '../stores/useToastStore';
import type { UpcomingDue } from '../repositories/DashboardRepository';

export const ClientCreditsPage: React.FC = () => {
  const { clients, loadClients } = useClientStore();
  const [dues, setDues] = useState<UpcomingDue[]>([]);
  const [dueDays, setDueDays] = useState(30);
  const [isLoading, setIsLoading] = useState(true);

  const load = async () => {
    setIsLoading(true);
    try {
      const d = await window.api.dashboard.getUpcomingDues(dueDays);
      setDues(d ?? []);
    } catch (e: any) {
      toast.error(`Impossible de charger les échéances : ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { loadClients(); }, []);
  useEffect(() => { load(); }, [dueDays]);

  const debtors = (clients ?? [])
    .filter((c: any) => (c.balance ?? 0) > 0)
    .map((c: any) => ({ id: c.id, name: c.name, balance: c.balance ?? 0 }))
    .sort((a: any, b: any) => b.balance - a.balance);

  const totalDebt = debtors.reduce((s: number, d: any) => s + d.balance, 0);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg)', height: '100vh', overflow: 'hidden' }}>
      <div className="page-header">
        <div>
          <h1>Crédits & échéances</h1>
          <div style={{ color: 'var(--muted)', marginTop: 4, fontSize: 13 }}>
            Dettes clients (نسيئة) et échéances à venir
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {[7, 30, 60].map(days => (
              <button
                key={days}
                onClick={() => setDueDays(days)}
                style={{
                  padding: '4px 12px',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 700,
                  background: dueDays === days ? 'var(--primary)' : 'var(--surface)',
                  color: dueDays === days ? '#fff' : 'var(--text-secondary)',
                }}
              >
                {days} j
              </button>
            ))}
          </div>
          <button className="btn btn-ghost" onClick={load}>Actualiser</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Résumé */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <div className="card" style={{ padding: '16px 18px' }}>
            <div className="text-sm" style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Total dû par les clients</div>
            <div className="money" style={{ fontSize: 22, fontWeight: 800, color: 'var(--danger)' }}>{totalDebt.toFixed(2)} MAD</div>
          </div>
          <div className="card" style={{ padding: '16px 18px' }}>
            <div className="text-sm" style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Clients débiteurs</div>
            <div className="money" style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)' }}>{debtors.length}</div>
          </div>
          <div className="card" style={{ padding: '16px 18px' }}>
            <div className="text-sm" style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Échéances ({dueDays} j)</div>
            <div className="money" style={{ fontSize: 22, fontWeight: 800, color: 'var(--warning)' }}>{dues.length}</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
          {/* Clients débiteurs */}
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
              <h3 style={{ margin: 0 }}>Clients avec solde dû</h3>
            </div>
            {debtors.length === 0 ? (
              <div className="state-box">
                <div className="state-text">Aucune dette client en cours.</div>
              </div>
            ) : (
              <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Client</th>
                      <th style={{ textAlign: 'right' }}>Solde</th>
                    </tr>
                  </thead>
                  <tbody>
                    {debtors.map((d: any) => (
                      <tr key={d.id}>
                        <td style={{ fontWeight: 600 }}>{d.name}</td>
                        <td className="money" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--danger)' }}>{d.balance.toFixed(2)} MAD</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Échéances */}
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
              <h3 style={{ margin: 0 }}>Échéances à venir</h3>
            </div>
            {isLoading ? (
              <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton skeleton-row" />)}
              </div>
            ) : dues.length === 0 ? (
              <div className="state-box">
                <div className="state-text">Aucune échéance dans cette fenêtre.</div>
              </div>
            ) : (
              <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Document</th>
                      <th>Client</th>
                      <th>Échéance</th>
                      <th style={{ textAlign: 'right' }}>Reste</th>
                      <th>Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dues.map((due) => {
                      const overdue = due.days_left < 0;
                      const urgent = !overdue && due.days_left <= 7;
                      return (
                        <tr key={due.id}>
                          <td style={{ fontWeight: 600 }}>{due.document_number}</td>
                          <td>{due.customer_name}</td>
                          <td className="text-sm text-muted" style={{ whiteSpace: 'nowrap' }}>{due.due_date?.split('T')[0]}</td>
                          <td className="money" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--danger)' }}>{due.remaining.toFixed(2)} MAD</td>
                          <td>
                            <span className={overdue ? 'badge badge-danger' : urgent ? 'badge badge-warning' : 'badge badge-muted'}>
                              {overdue ? `En retard (${Math.abs(due.days_left)}j)` : `J-${due.days_left}`}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
