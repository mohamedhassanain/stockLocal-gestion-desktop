import React, { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useStockStore } from '../stores/useStockStore';
import { useProductStore } from '../stores/useProductStore';
import { DataTable } from '../components/ui/DataTable';
import { toast } from '../stores/useToastStore';
import { Button, Card, CardHeader, Badge, Select, PageHeader } from '../components/ui';
import { stockLevelClass } from '../components/ui/statusMaps';

export type ExitType = 'VENTE' | 'CASSE' | 'PERTE' | 'RETOUR';

interface GlobalMovement {
  id: string;
  product_id: string;
  type: 'IN' | 'OUT';
  movement_type: string;
  quantity: number;
  unit_price: number;
  date?: string;
  reference_doc?: string;
  notes?: string;
  product_ref?: string;
  product_name?: string;
}

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  PURCHASE_IN: 'Entrée achat',
  SALE_OUT: 'Vente',
  RETURN_IN: 'Retour client',
  RETURN_OUT: 'Retour fournisseur',
  ADJUSTMENT_IN: 'Ajustement +',
  ADJUSTMENT_OUT: 'Ajustement −',
  TRANSFER_IN: 'Transfert reçu',
  TRANSFER_OUT: 'Transfert envoyé',
  DAMAGE_OUT: 'Casse',
  LOSS_OUT: 'Perte',
  OPENING_BALANCE: 'Stock initial',
};

const HISTORY_PAGE_SIZE = 200;

const GlobalHistoryTab: React.FC = () => {
  const [movements, setMovements] = useState<GlobalMovement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: movements.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 46,
    overscan: 6,
  });

  const loadNext = async () => {
    const next = await window.api.stock.getAllHistory({ limit: HISTORY_PAGE_SIZE, offset: movements.length });
    const rows = (next ?? []) as GlobalMovement[];
    setMovements(prev => [...prev, ...rows]);
    return rows.length;
  };

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      await loadNext();
      setIsLoading(false);
    })();
  }, []);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 240) {
      loadNext().then(loaded => {
        if (loaded === 0 && !isLoading) {
          // Fin de l'historique : aucune action supplémentaire.
        }
      }).catch((err: any) => toast.error(`Erreur : ${err.message}`));
    }
  };

  return (
    <Card overflow className="align-self-stretch">
      <CardHeader>
        <h3 style={{ margin: 0 }}>Historique global des mouvements</h3>
        <span className="text-sm text-muted">{movements.length} mouvement(s) chargés</span>
      </CardHeader>
      {isLoading && movements.length === 0 ? (
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton skeleton-row" />)}
        </div>
      ) : movements.length === 0 ? (
        <div className="state-box">
          <div className="state-text">Aucun mouvement de stock enregistré.</div>
        </div>
      ) : (
        <div ref={scrollRef} onScroll={handleScroll} style={{ height: 480, overflowY: 'auto' }}>
          <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 36, display: 'flex', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', zIndex: 1 }}>
              <div style={{ flex: 1.2, padding: '8px 14px' }}>Produit</div>
              <div style={{ flex: 1, padding: '8px 14px' }}>Type</div>
              <div style={{ flex: 0.6, padding: '8px 14px', textAlign: 'center' }}>Qté</div>
              <div style={{ flex: 0.8, padding: '8px 14px', textAlign: 'right' }}>P.U.</div>
              <div style={{ flex: 0.9, padding: '8px 14px' }}>Réf doc</div>
              <div style={{ flex: 0.8, padding: '8px 14px' }}>Date</div>
            </div>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const m = movements[virtualRow.index];
              const isIn = m.type === 'IN';
              return (
                <div
                  key={m.id}
                  style={{
                    position: 'absolute', top: 0, left: 0, width: '100%', height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start + 36}px)`, display: 'flex', alignItems: 'center',
                    borderBottom: '1px solid var(--border)', fontSize: 14, boxSizing: 'border-box',
                  }}
                >
                  <div style={{ flex: 1.2, padding: '6px 14px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.product_ref && <span className="text-muted">{m.product_ref}</span>} {m.product_name ?? '—'}
                  </div>
                  <div style={{ flex: 1, padding: '6px 14px' }}>
                    <Badge variant={isIn ? 'success' : 'danger'} style={{ marginRight: 6 }}>
                      {isIn ? 'IN' : 'OUT'}
                    </Badge>
                    <span className="text-sm">{MOVEMENT_TYPE_LABELS[m.movement_type] ?? m.movement_type}</span>
                  </div>
                  <div className="qty" style={{ flex: 0.6, padding: '6px 14px', textAlign: 'center', fontWeight: 700 }}>{m.quantity}</div>
                  <div className="money" style={{ flex: 0.8, padding: '6px 14px', textAlign: 'right' }}>{m.unit_price?.toFixed(2) ?? '0.00'}</div>
                  <div className="text-sm text-muted" style={{ flex: 0.9, padding: '6px 14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.reference_doc || '—'}</div>
                  <div className="text-sm text-muted" style={{ flex: 0.8, padding: '6px 14px' }}>{m.date ? new Date(m.date).toLocaleDateString('fr-MA') : '—'}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
};

export const StockPage: React.FC = () => {
  const { currentProductStock, stockHistory, loadProductStock, addEntry, addExit, addInventory } = useStockStore();
  const { products, searchQuery, setSearchQuery, loadProducts } = useProductStore((state) => ({
    products: state.products,
    searchQuery: state.searchQuery,
    setSearchQuery: state.setSearchQuery,
    loadProducts: state.loadProducts,
  }));

  const [activeTab, setActiveTab] = useState<'operations' | 'history'>('operations');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [qty, setQty] = useState<number>(1);
  const [price, setPrice] = useState<number>(0);
  const [actualCount, setActualCount] = useState<number>(0);
  const [notes, setNotes] = useState('');
  const [exitType, setExitType] = useState<ExitType>('VENTE');
  const [blRef, setBlRef] = useState('');

  const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      loadProducts();
    }
  };

  const handleSelectProduct = (productId: string) => {
    setSelectedProductId(productId);
    loadProductStock(productId);
    const p = products.find(pr => pr.id === productId);
    if (p) setActualCount(p.current_stock ?? 0);
  };

  const handleAddEntry = async () => {
    if (!selectedProductId) return;
    try {
      await addEntry({
        product_id: selectedProductId,
        quantity: qty,
        unit_price: price,
        reference_doc: blRef || undefined,
        notes: notes || undefined,
      });
      toast.success('Entrée de stock ajoutée avec succès.');
      setQty(1);
      setNotes('');
      setBlRef('');
      loadProductStock(selectedProductId);
      loadProducts();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleAddExit = async () => {
    if (!selectedProductId) return;
    try {
      await addExit({
        product_id: selectedProductId,
        quantity: qty,
        unit_price: price,
        exitType,
        notes: notes || undefined,
      });
      toast.success(`Sortie (${exitType}) effectuée avec succès.`);
      setQty(1);
      setNotes('');
      loadProductStock(selectedProductId);
      loadProducts();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleInventory = async () => {
    if (!selectedProductId) return;
    try {
      await addInventory({
        product_id: selectedProductId,
        unit_price: 0,
      }, actualCount);
      toast.success('Inventaire enregistré (écart ajusté).');
      loadProductStock(selectedProductId);
      loadProducts();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const selectedProduct = products.find(p => p.id === selectedProductId);

  return (
    <div className="page-shell" style={{ overflowY: 'auto' }}>
      <PageHeader title="Gestion des Mouvements de Stock" />

      <div className="page-content">
        <input
          type="text"
          className="input input-lg w-full"
          placeholder="Scanner le code-barres ou taper la référence... (Entrée pour chercher)"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleSearch}
          autoFocus
        />

        <div style={{ display: 'flex', gap: 4 }}>
          {([
            { key: 'operations' as const, label: 'Opérations' },
            { key: 'history' as const, label: 'Historique global' },
          ]).map(tab => (
            <Button
              key={tab.key}
              variant={activeTab === tab.key ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </Button>
          ))}
        </div>

        {activeTab === 'history' ? (
          <GlobalHistoryTab />
        ) : (
          <div style={{ display: 'flex', gap: 20 }}>
            <Card padding className="flex-1">
              <h2 style={{ marginTop: 0 }}>Résultats</h2>
              <DataTable
                columns={[
                  { key: 'reference', label: 'Réf', sortable: true },
                  { key: 'designation', label: 'Désignation', sortable: true },
                  {
                    key: 'current_stock',
                    label: 'Stock',
                    sortable: true,
                    render: (p: any) => (
                      <span className={`${stockLevelClass(p.current_stock ?? 0, p.min_stock ?? 0)} font-semibold`}>
                        {p.current_stock ?? 0} {p.unit || 'PIÈCE'}
                      </span>
                    ),
                  },
                ]}
                rows={products as any}
                getRowId={(p: any) => p.id}
                searchableKeys={['reference', 'designation', 'barcode']}
                searchPlaceholder="Filtrer dans les résultats…"
                pageSize={10}
                onRowClick={(p: any) => handleSelectProduct(p.id)}
              />
            </Card>

            {selectedProductId && (
              <Card padding className="flex-1" style={{ flex: 1.4 }}>
                {selectedProduct && (
                  <div className="text-sm text-muted" style={{ marginBottom: 12 }}>
                    {selectedProduct.reference} — {selectedProduct.designation} ({selectedProduct.unit || 'PIÈCE'})
                  </div>
                )}
                <div style={{ fontSize: 24, marginBottom: 20 }}>
                  Stock Actuel :{' '}
                  <strong className={currentProductStock > 0 ? 'text-success' : 'text-danger'}>
                    {currentProductStock}
                  </strong>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <input
                      type="number"
                      className="input input-lg flex-1"
                      value={qty}
                      onChange={e => setQty(Number(e.target.value))}
                      placeholder="Quantité"
                    />
                    <input
                      type="number"
                      className="input input-lg flex-1"
                      value={price}
                      onChange={e => setPrice(Number(e.target.value))}
                      placeholder="Prix unitaire"
                    />
                  </div>
                  <input
                    type="text"
                    className="input"
                    value={blRef}
                    onChange={e => setBlRef(e.target.value)}
                    placeholder="Réf BL (entrée achat, optionnel)"
                  />
                  <Select value={exitType} onChange={e => setExitType(e.target.value as ExitType)}>
                    <option value="VENTE">Sortie : Vente</option>
                    <option value="CASSE">Sortie : Casse</option>
                    <option value="PERTE">Sortie : Perte</option>
                    <option value="RETOUR">Sortie : Retour</option>
                  </Select>
                  <input
                    type="text"
                    className="input"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Notes (optionnel)"
                  />

                  <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                    <Button variant="primary" size="lg" block onClick={handleAddEntry}>
                      + ENTREE (Achat)
                    </Button>
                    <Button variant="danger" size="lg" block onClick={handleAddExit}>
                      - SORTIE ({exitType})
                    </Button>
                  </div>

                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 15, marginTop: 5 }}>
                    <h3 style={{ margin: '0 0 10px' }}>📋 Inventaire (comptage physique)</h3>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <input
                        type="number"
                        className="input input-lg flex-1"
                        value={actualCount}
                        onChange={e => setActualCount(Number(e.target.value))}
                        placeholder="Quantité comptée"
                      />
                      <Button variant="primary" size="lg" block onClick={handleInventory}>
                        ✓ Valider l'inventaire
                      </Button>
                    </div>
                  </div>

                  {stockHistory.length > 0 && (
                    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 15 }}>
                      <h3 style={{ margin: '0 0 10px' }}>🕘 Historique des mouvements</h3>
                      <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                        {stockHistory.map(h => (
                          <div
                            key={h.id}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              padding: '8px 0',
                              borderBottom: '1px solid var(--border)',
                              fontSize: 14,
                            }}
                          >
                            <span>
                              <Badge
                                variant={h.type === 'IN' ? 'success' : h.type === 'OUT' ? 'danger' : 'primary'}
                                style={{ marginRight: 6 }}
                              >
                                {h.type === 'IN' ? 'ENTRÉE' : h.type === 'OUT' ? 'SORTIE' : 'INVENTAIRE'}
                              </Badge>
                              {h.notes ? h.notes.substring(0, 50) : `Qté: ${h.quantity}`}
                            </span>
                            <span className="text-sm text-muted" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                              {new Date(h.date ?? Date.now()).toLocaleDateString('fr-MA')}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
