import React, { useEffect, useState } from 'react';
import { toast } from '../stores/useToastStore';
import type { PurchaseOrder, PurchaseOrderItem } from '../repositories/PurchaseOrderRepository';

interface ReceivingLine {
  id: string;
  product_ref?: string;
  product_name?: string;
  quantity: number;
  received_qty: number;
  unit_price: number;
}

interface Receiving {
  order_number: string;
  supplier_name?: string;
  date: string;
  status: 'CONFIRMED' | 'RECEIVED';
  lines: ReceivingLine[];
  totalValue: number;
  totalReceivedValue: number;
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  CONFIRMED: { label: 'Partielle', cls: 'badge-warning' },
  RECEIVED: { label: 'Réceptionnée', cls: 'badge-success' },
};

const formatDate = (d?: string): string =>
  d ? new Date(d).toLocaleDateString('fr-MA') : '—';

const ReceivingRow: React.FC<{ receiving: Receiving }> = ({ receiving }) => {
  const [expanded, setExpanded] = useState(false);
  const badge = STATUS_BADGE[receiving.status] ?? STATUS_BADGE.CONFIRMED;

  return (
    <div className="card" style={{ marginBottom: 12, overflow: 'hidden' }}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(e => !e)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(x => !x); } }}
        style={{ padding: '14px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 16 }}
      >
        <span style={{ color: 'var(--muted)' }}>{expanded ? '▾' : '▸'}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: 15 }}>{receiving.order_number}</div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            {receiving.supplier_name ?? '—'} · {formatDate(receiving.date)}
          </div>
        </div>
        <span className={`badge ${badge.cls}`}>{badge.label}</span>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div className="money" style={{ fontWeight: 700, color: 'var(--text)' }}>
            {receiving.totalReceivedValue.toFixed(2)} MAD
          </div>
          <div className="text-xs text-muted">/ {receiving.totalValue.toFixed(2)} MAD</div>
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '4px 18px 14px' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Produit</th>
                <th style={{ textAlign: 'center' }}>Qté</th>
                <th style={{ textAlign: 'center' }}>Reçue</th>
                <th style={{ textAlign: 'right' }}>P.U.</th>
                <th style={{ textAlign: 'right' }}>Valeur reçue</th>
              </tr>
            </thead>
            <tbody>
              {receiving.lines.map((line: ReceivingLine) => (
                <tr key={line.id}>
                  <td style={{ fontWeight: 600 }}>
                    {line.product_ref && <span className="text-muted">{line.product_ref}</span>} {line.product_name ?? '—'}
                  </td>
                  <td className="qty" style={{ textAlign: 'center' }}>{line.quantity}</td>
                  <td className="qty" style={{ textAlign: 'center', color: line.received_qty >= line.quantity ? 'var(--success)' : 'var(--warning)', fontWeight: 700 }}>
                    {line.received_qty}
                  </td>
                  <td className="money" style={{ textAlign: 'right' }}>{line.unit_price.toFixed(2)}</td>
                  <td className="money" style={{ textAlign: 'right' }}>{(line.received_qty * line.unit_price).toFixed(2)} MAD</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export const ReceivingsPage: React.FC = () => {
  const [receivings, setReceivings] = useState<Receiving[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const load = async () => {
    setIsLoading(true);
    try {
      const orders = await window.api.purchases.getReceivings();
      const mapped: Receiving[] = (orders ?? []).map((o: PurchaseOrder) => {
        const items = (o.items ?? []) as PurchaseOrderItem[];
        return {
          order_number: o.order_number,
          supplier_name: o.supplier_name,
          date: o.date,
          status: o.status as 'CONFIRMED' | 'RECEIVED',
          lines: items.map(i => ({
            id: i.id,
            product_ref: i.product_ref,
            product_name: i.product_name,
            quantity: i.quantity,
            received_qty: i.received_qty,
            unit_price: i.unit_price,
          })),
          totalValue: items.reduce((s, i) => s + i.quantity * i.unit_price, 0),
          totalReceivedValue: items.reduce((s, i) => s + i.received_qty * i.unit_price, 0),
        };
      });
      setReceivings(mapped);
    } catch (e: any) {
      toast.error(`Impossible de charger les réceptions : ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const pendingCount = receivings.filter(r => r.status === 'CONFIRMED').length;

  const q = searchQuery.trim().toLowerCase();
  const filteredReceivings = q
    ? receivings.filter(r =>
        r.order_number.toLowerCase().includes(q) ||
        (r.supplier_name ?? '').toLowerCase().includes(q) ||
        r.lines.some(l =>
          (l.product_ref ?? '').toLowerCase().includes(q) ||
          (l.product_name ?? '').toLowerCase().includes(q)
        )
      )
    : receivings;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg)', height: '100vh', overflow: 'hidden' }}>
      <div className="page-header">
        <div>
          <h1>Réceptions</h1>
          <div style={{ color: 'var(--muted)', marginTop: 4, fontSize: 13 }}>
            Commandes fournisseurs réceptionnées (partielles ou totales)
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {pendingCount > 0 && <span className="badge badge-warning">{pendingCount} réception(s) en attente</span>}
          <button className="btn btn-ghost" onClick={load}>Actualiser</button>
        </div>
      </div>

      <div style={{ padding: '12px 28px', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        <input
          type="text"
          className="input input-lg"
          placeholder="Rechercher par numéro, fournisseur, produit..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
        {isLoading ? (
          <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton skeleton-row" />)}
          </div>
        ) : receivings.length === 0 ? (
          <div className="card state-box">
            <div className="state-icon">📦</div>
            <div className="state-title">Aucune réception</div>
            <div className="state-text">Les commandes confirmées puis réceptionnées apparaîtront ici.</div>
          </div>
        ) : filteredReceivings.length === 0 ? (
          <div className="card state-box">
            <div className="state-icon">🔍</div>
            <div className="state-title">Aucun résultat</div>
            <div className="state-text">Aucune réception ne correspond à « {searchQuery} ».</div>
          </div>
        ) : (
          filteredReceivings.map(r => <ReceivingRow key={r.order_number} receiving={r} />)
        )}
      </div>
    </div>
  );
};
