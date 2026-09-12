import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from '../ui';
import { toast } from '../../stores/useToastStore';
import type { Product } from '../../repositories/ProductRepository';
import type { PriceHistoryEntry } from '../../repositories/PriceHistoryRepository';
import type { ProductBatch } from '../../repositories/ProductBatchRepository';

/**
 * §Phase 14 — Historique d'un produit.
 *
 * Onglets : Vue d'ensemble (stock + dépôts), Mouvements, Ventes/Achats,
 * Prix (historique), Lots. Toutes les valeurs proviennent de la base via IPC :
 * aucun calcul d'historique n'est refait ici.
 */

interface StatusBreakdown {
  warehouse_id: string;
  warehouse_name: string;
  quantity: number;
}

interface MovementRow {
  id: string;
  type: 'IN' | 'OUT';
  movement_type: string;
  quantity: number;
  unit_price?: number;
  date?: string;
  reference_doc?: string | null;
  warehouse_id?: string | null;
}

interface ProductHistoryModalProps {
  product: Product;
  onClose: () => void;
}

type TabKey = 'overview' | 'movements' | 'flows' | 'prices' | 'batches';

const TAB_LABELS: Record<TabKey, string> = {
  overview: "Vue d'ensemble",
  movements: 'Mouvements',
  flows: 'Ventes / Achats',
  prices: 'Prix',
  batches: 'Lots',
};

/** Catégorise un mouvement : les libellés viennent du type métier stocké. */
function isPurchase(type: string): boolean {
  return type.includes('PURCHASE') || type === 'RETURN_IN';
}
function isSale(type: string): boolean {
  return type.includes('SALE') || type.includes('CREDIT') || type === 'RETURN_OUT';
}

export const ProductHistoryModal: React.FC<ProductHistoryModalProps> = ({ product, onClose }) => {
  const [tab, setTab] = useState<TabKey>('overview');
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [breakdown, setBreakdown] = useState<StatusBreakdown[]>([]);
  const [prices, setPrices] = useState<PriceHistoryEntry[]>([]);
  const [batches, setBatches] = useState<ProductBatch[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [history, stockBreakdown, priceHistory, productBatches] = await Promise.all([
        window.api.stock.getHistory(product.id),
        window.api.stock.getWarehouseBreakdown(product.id),
        window.api.prices.getHistory(product.id),
        window.api.batches.listByProduct(product.id),
      ]);
      setMovements((history ?? []) as MovementRow[]);
      setBreakdown((stockBreakdown ?? []) as StatusBreakdown[]);
      setPrices((priceHistory ?? []) as PriceHistoryEntry[]);
      setBatches((productBatches ?? []) as ProductBatch[]);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Impossible de charger l'historique du produit.");
    } finally {
      setIsLoading(false);
    }
  }, [product.id]);

  useEffect(() => { void load(); }, [load]);

  const purchases = useMemo(() => movements.filter(m => isPurchase(m.movement_type)), [movements]);
  const sales = useMemo(() => movements.filter(m => isSale(m.movement_type)), [movements]);
  const otherMovements = useMemo(
    () => movements.filter(m => !isPurchase(m.movement_type) && !isSale(m.movement_type)),
    [movements],
  );

  const totalStock = breakdown.reduce((sum, b) => sum + Number(b.quantity ?? 0), 0);

  const renderMovementTable = (rows: MovementRow[]) => (
    rows.length === 0 ? (
      <div className="text-muted text-center" style={{ padding: 20 }}>Aucun mouvement.</div>
    ) : (
      <div style={{ maxHeight: 380, overflowY: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Référence du document</th>
              <th style={{ textAlign: 'right' }}>Quantité</th>
              <th style={{ textAlign: 'right' }}>Prix unitaire</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(m => (
              <tr key={m.id}>
                <td className="text-sm">{String(m.date ?? '').replace('T', ' ').slice(0, 16)}</td>
                <td className="text-sm font-semibold">{m.movement_type}</td>
                <td className="text-sm text-muted">{m.reference_doc ?? '—'}</td>
                <td
                  className="qty text-right"
                  style={{ color: m.type === 'IN' ? 'var(--success)' : 'var(--danger)' }}
                >
                  {m.type === 'IN' ? '+' : '−'}{Number(m.quantity ?? 0)}
                </td>
                <td className="money text-right">{Number(m.unit_price ?? 0).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  );

  return (
    <Modal open onClose={onClose} width={860}>
      <ModalHeader
        title={`Historique — ${product.designation}`}
        subtitle={`${product.reference}${product.barcode ? ` · ${product.barcode}` : ''}`}
      />
      <ModalBody>
        <div className="flex gap-2" style={{ flexWrap: 'wrap', marginBottom: 14 }}>
          {(Object.keys(TAB_LABELS) as TabKey[]).map(key => (
            <Button
              key={key}
              size="sm"
              variant={tab === key ? 'primary' : 'secondary'}
              onClick={() => setTab(key)}
            >
              {TAB_LABELS[key]}
            </Button>
          ))}
        </div>

        {isLoading ? (
          <div className="state-text" style={{ padding: 24 }}>Chargement de l'historique…</div>
        ) : (
          <>
            {/* ── Vue d'ensemble ── */}
            {tab === 'overview' && (
              <div>
                <div className="stat-grid" style={{ marginBottom: 14 }}>
                  <div className="card" style={{ padding: '12px 16px' }}>
                    <div className="text-xs text-muted">Stock total</div>
                    <div className="qty font-semibold" style={{ fontSize: 'var(--font-size-lg)' }}>{totalStock}</div>
                  </div>
                  <div className="card" style={{ padding: '12px 16px' }}>
                    <div className="text-xs text-muted">Seuil minimum</div>
                    <div className="qty font-semibold" style={{ fontSize: 'var(--font-size-lg)' }}>{product.min_stock}</div>
                  </div>
                  <div className="card" style={{ padding: '12px 16px' }}>
                    <div className="text-xs text-muted">Seuil maximum</div>
                    <div className="qty font-semibold" style={{ fontSize: 'var(--font-size-lg)' }}>
                      {Number(product.max_stock ?? 0) > 0 ? product.max_stock : '—'}
                    </div>
                  </div>
                  <div className="card" style={{ padding: '12px 16px' }}>
                    <div className="text-xs text-muted">Mouvements</div>
                    <div className="qty font-semibold" style={{ fontSize: 'var(--font-size-lg)' }}>{movements.length}</div>
                  </div>
                </div>

                <h4 className="text-sm font-semibold" style={{ margin: '0 0 8px' }}>Répartition par dépôt</h4>
                {breakdown.length === 0 ? (
                  <div className="text-muted text-center" style={{ padding: 16 }}>Aucun stock enregistré.</div>
                ) : (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Dépôt</th>
                        <th style={{ textAlign: 'right' }}>Quantité</th>
                      </tr>
                    </thead>
                    <tbody>
                      {breakdown.map(b => (
                        <tr key={b.warehouse_id}>
                          <td>{b.warehouse_name}</td>
                          <td className="qty text-right font-semibold">{Number(b.quantity ?? 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* ── Mouvements ── */}
            {tab === 'movements' && renderMovementTable(movements)}

            {/* ── Ventes / Achats ── */}
            {tab === 'flows' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div>
                  <h4 className="text-sm font-semibold" style={{ margin: '0 0 8px' }}>
                    Ventes ({sales.length})
                  </h4>
                  {renderMovementTable(sales)}
                </div>
                <div>
                  <h4 className="text-sm font-semibold" style={{ margin: '0 0 8px' }}>
                    Achats / entrées ({purchases.length})
                  </h4>
                  {renderMovementTable(purchases)}
                </div>
                {otherMovements.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold" style={{ margin: '0 0 8px' }}>
                      Autres mouvements ({otherMovements.length})
                    </h4>
                    {renderMovementTable(otherMovements)}
                  </div>
                )}
              </div>
            )}

            {/* ── Prix ── */}
            {tab === 'prices' && (
              <div>
                <div className="flex gap-3" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
                  <span className="badge badge-muted">Achat : {Number(product.purchase_price).toFixed(2)} MAD</span>
                  <span className="badge badge-primary">Vente : {Number(product.selling_price).toFixed(2)} MAD</span>
                  <span className="badge badge-info">Gros : {Number(product.wholesale_price).toFixed(2)} MAD</span>
                </div>
                {prices.length === 0 ? (
                  <div className="text-muted text-center" style={{ padding: 20 }}>
                    Aucun changement de prix enregistré.
                  </div>
                ) : (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th style={{ textAlign: 'right' }}>Prix d'achat</th>
                        <th style={{ textAlign: 'right' }}>Prix de vente</th>
                        <th style={{ textAlign: 'right' }}>Prix de gros</th>
                        <th>Motif / source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prices.map(p => (
                        <tr key={p.id}>
                          <td className="text-sm">{String(p.changed_at).replace('T', ' ').slice(0, 16)}</td>
                          <td className="money text-right">{Number(p.purchase_price).toFixed(2)}</td>
                          <td className="money text-right">{Number(p.selling_price).toFixed(2)}</td>
                          <td className="money text-right">{Number(p.wholesale_price).toFixed(2)}</td>
                          <td className="text-sm text-muted">{p.reason ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* ── Lots ── */}
            {tab === 'batches' && (
              <div>
                {!product.batch_managed && (
                  <div className="text-xs text-muted" style={{ marginBottom: 8 }}>
                    Ce produit n'est pas marqué « géré par lots » : les lots ci-dessous restent
                    indicatifs et n'influencent pas le stock.
                  </div>
                )}
                {batches.length === 0 ? (
                  <div className="text-muted text-center" style={{ padding: 20 }}>Aucun lot enregistré.</div>
                ) : (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>N° de lot</th>
                        <th style={{ textAlign: 'right' }}>Quantité</th>
                        <th>Expiration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batches.map(b => (
                        <tr key={b.id}>
                          <td className="text-sm font-semibold">{b.lot_number}</td>
                          <td className="qty text-right">{Number(b.quantity ?? 0)}</td>
                          <td className="text-sm">
                            {b.expiry_date ? new Date(b.expiry_date).toLocaleDateString('fr-MA') : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Fermer</Button>
      </ModalFooter>
    </Modal>
  );
};
