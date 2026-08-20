import React, { useEffect, useState } from 'react';
import { useClientStore } from '../stores/useClientStore';
import { toast } from '../stores/useToastStore';
import { Button, Card, CardHeader, PageHeader, StatCard } from '../components/ui';
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
    <div className="page-shell">
      <PageHeader
        title="Crédits & échéances"
        subtitle="Dettes clients (نسيئة) et échéances à venir"
        actions={
          <>
            <div className="flex gap-1">
              {[7, 30, 60].map(days => (
                <button
                  key={days}
                  onClick={() => setDueDays(days)}
                  className={`btn btn-sm ${dueDays === days ? 'btn-primary' : 'btn-secondary'}`}
                >
                  {days} j
                </button>
              ))}
            </div>
            <Button variant="ghost" onClick={load}>Actualiser</Button>
          </>
        }
      />

      <div className="page-content">
        <div className="stat-grid">
          <StatCard label="Total dû par les clients" value={`${totalDebt.toFixed(2)} MAD`} tone="danger" />
          <StatCard label="Clients débiteurs" value={debtors.length} />
          <StatCard label={`Échéances (${dueDays} j)`} value={dues.length} tone="warning" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
          <Card overflow>
            <CardHeader>
              <h3 style={{ margin: 0 }}>Clients avec solde dû</h3>
            </CardHeader>
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
                      <th className="text-right">Solde</th>
                    </tr>
                  </thead>
                  <tbody>
                    {debtors.map((d: any) => (
                      <tr key={d.id}>
                        <td className="font-semibold">{d.name}</td>
                        <td className="money text-right font-semibold text-danger">{d.balance.toFixed(2)} MAD</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card overflow>
            <CardHeader>
              <h3 style={{ margin: 0 }}>Échéances à venir</h3>
            </CardHeader>
            {isLoading ? (
              <div className="card-body flex gap-3" style={{ flexDirection: 'column' }}>
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
                      <th className="text-right">Reste</th>
                      <th>Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dues.map((due) => {
                      const overdue = due.days_left < 0;
                      const urgent = !overdue && due.days_left <= 7;
                      return (
                        <tr key={due.id}>
                          <td className="font-semibold">{due.document_number}</td>
                          <td>{due.customer_name}</td>
                          <td className="text-sm text-muted" style={{ whiteSpace: 'nowrap' }}>{due.due_date?.split('T')[0]}</td>
                          <td className="money text-right font-semibold text-danger">{due.remaining.toFixed(2)} MAD</td>
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
          </Card>
        </div>
      </div>
    </div>
  );
};
