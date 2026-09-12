import React, { useEffect, useState } from 'react';
import { Button, Card, CardHeader, Input, Select } from '../ui';
import { toast } from '../../stores/useToastStore';
import type { Warehouse } from '../../stores/useWarehouseStore';

/**
 * Multi-dépôts — transferts de stock entre dépôts.
 *
 * Un transfert crée TOUJOURS, dans une seule transaction, un mouvement
 * TRANSFER_OUT (source) et TRANSFER_IN (destination) + une ligne d'historique.
 * Le stock source insuffisant est refusé avec un message clair.
 */

interface TransferRow {
  id: string;
  product_id: string;
  from_warehouse_id: string;
  to_warehouse_id: string;
  quantity: number;
  date?: string;
  notes?: string | null;
  product_ref?: string;
  product_name?: string;
  from_name?: string;
  to_name?: string;
}

interface ProductOption {
  id: string;
  reference: string;
  designation: string;
}

interface TransfersPanelProps {
  warehouses: Warehouse[];
}

export const TransfersPanel: React.FC<TransfersPanelProps> = ({ warehouses }) => {
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [productQuery, setProductQuery] = useState('');
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [productId, setProductId] = useState('');
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');

  const multi = warehouses.length > 1;

  const loadTransfers = async () => {
    setIsLoading(true);
    try {
      const rows = await window.api.transfers.getHistory(100);
      setTransfers((rows ?? []) as TransferRow[]);
    } catch (e: unknown) {
      toast.error(`Impossible de charger les transferts : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsLoading(false);
    }
  };

  const searchProducts = async (query: string) => {
    try {
      const rows = await window.api.products.search(query);
      setProducts((rows ?? []) as ProductOption[]);
    } catch {
      /* silencieux : la liste produits est optionnelle pour l'affichage */
    }
  };

  useEffect(() => {
    void loadTransfers();
    void searchProducts('');
  }, []);

  // Préremplir source = dépôt par défaut, destination = premier autre dépôt.
  useEffect(() => {
    if (!multi) return;
    const def = warehouses.find(w => w.is_default === 1) ?? warehouses[0];
    const other = warehouses.find(w => w.id !== def?.id);
    setFromId(prev => prev || def?.id || '');
    setToId(prev => prev || other?.id || '');
  }, [warehouses, multi]);

  const handleSubmit = async () => {
    if (!productId) { toast.warning('Choisissez un produit à transférer.'); return; }
    if (!fromId || !toId) { toast.warning('Choisissez les dépôts source et destination.'); return; }
    if (fromId === toId) { toast.warning('Le dépôt source et la destination doivent être différents.'); return; }
    if (!Number.isFinite(quantity) || quantity <= 0) { toast.warning('La quantité doit être supérieure à 0.'); return; }
    try {
      const result = await window.api.transfers.create({
        product_id: productId,
        from_warehouse_id: fromId,
        to_warehouse_id: toId,
        quantity,
        notes: notes.trim() || null,
      });
      if (!result.success) throw new Error(result.error);
      toast.success('Transfert effectué.');
      setQuantity(1);
      setNotes('');
      await loadTransfers();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Card padding>
      <CardHeader>
        <h3 style={{ margin: 0 }}>Transferts entre dépôts</h3>
        {!multi && <span className="text-sm text-muted">Créez un second dépôt pour transférer du stock.</span>}
      </CardHeader>

      {multi && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
          <div>
            <Input
              label="Rechercher un produit"
              value={productQuery}
              onChange={e => { setProductQuery(e.target.value); void searchProducts(e.target.value); }}
              placeholder="Référence ou désignation…"
            />
            <Select label="Produit *" value={productId} onChange={e => setProductId(e.target.value)}>
              <option value="">— Choisir —</option>
              {products.map(p => (
                <option key={p.id} value={p.id}>{p.reference} — {p.designation}</option>
              ))}
            </Select>
          </div>
          <div>
            <Select label="Dépôt source *" value={fromId} onChange={e => setFromId(e.target.value)}>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
            <Select label="Dépôt destination *" value={toId} onChange={e => setToId(e.target.value)}>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </div>
          <div>
            <Input
              label="Quantité *"
              type="number"
              min={1}
              value={quantity}
              onChange={e => setQuantity(Number(e.target.value))}
            />
            <Input
              label="Notes"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Optionnel"
            />
          </div>
        </div>
      )}

      {multi && (
        <div style={{ marginBottom: 16 }}>
          <Button variant="success" onClick={handleSubmit}>Transférer le stock</Button>
        </div>
      )}

      {isLoading ? (
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton skeleton-row" />)}
        </div>
      ) : transfers.length === 0 ? (
        <div className="state-box">
          <div className="state-text">Aucun transfert enregistré.</div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Produit</th>
                <th>De</th>
                <th>Vers</th>
                <th className="text-center">Quantité</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map(t => (
                <tr key={t.id}>
                  <td className="text-sm text-muted">{t.date ? new Date(t.date).toLocaleDateString('fr-MA') : '—'}</td>
                  <td>{t.product_ref ? <span className="text-muted">{t.product_ref} </span> : null}{t.product_name ?? '—'}</td>
                  <td className="text-sm">{t.from_name ?? '—'}</td>
                  <td className="text-sm">{t.to_name ?? '—'}</td>
                  <td className="qty text-center font-semibold">{t.quantity}</td>
                  <td className="text-sm text-muted">{t.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
};
