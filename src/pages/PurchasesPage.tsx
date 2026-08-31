import React, { useEffect, useState } from 'react';
import { usePurchaseStore } from '../stores/usePurchaseStore';
import { useSupplierStore } from '../stores/useSupplierStore';
import { useProductStore } from '../stores/useProductStore';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import {
  Button,
  Card,
  Badge,
  Input,
  Select,
  PageHeader,
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  PURCHASE_STATUS_BADGE,
} from '../components/ui';
import { toast } from '../stores/useToastStore';
import type { PurchaseOrder, PurchaseStatus } from '../stores/usePurchaseStore';

const getPurchaseBadge = (status: PurchaseStatus) =>
  PURCHASE_STATUS_BADGE[status] ?? PURCHASE_STATUS_BADGE.DRAFT;

// ─── Formulaire Nouvelle Commande ────────────────────────────────────────────

const NewOrderModal: React.FC<{
  onClose: () => void;
  onSave: (data: any) => void;
  initial?: PurchaseOrder | null;
}> = ({ onClose, onSave, initial }) => {
  const { suppliers, loadSuppliers } = useSupplierStore();
  const { products, loadProducts } = useProductStore();
  const [supplierId, setSupplierId] = useState(initial?.supplier_id ?? '');
  const [date, setDate] = useState(initial?.date ? initial.date.split('T')[0] : new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [items, setItems] = useState<Array<{ product_id: string; quantity: number; unit_price: number; _name?: string }>>(
    (initial?.items ?? []).map(it => ({
      product_id: it.product_id,
      quantity: it.quantity,
      unit_price: it.unit_price ?? 0,
      _name: it.product_ref ? `${it.product_ref} — ${it.product_name}` : it.product_name ?? it.product_id,
    }))
  );
  const [productSearch, setProductSearch] = useState('');

  useEffect(() => {
    loadSuppliers();
    loadProducts();
  }, []);

  const filteredProducts = products.filter(p =>
    productSearch === '' ||
    p.designation.toLowerCase().includes(productSearch.toLowerCase()) ||
    p.reference.toLowerCase().includes(productSearch.toLowerCase())
  );

  const addLine = (product: any) => {
    setItems(prev => [...prev, {
      product_id: product.id,
      quantity: 1,
      unit_price: product.purchase_price ?? 0,
      _name: `${product.reference} — ${product.designation}`
    }]);
    setProductSearch('');
  };

  const updateLine = (idx: number, key: string, val: number) => {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, [key]: val } : item));
  };

  const removeLine = (idx: number) => {
    setItems(prev => prev.filter((_, i) => i !== idx));
  };

  const total = items.reduce((sum, it) => sum + it.quantity * it.unit_price, 0);

  const handleSave = () => {
    onSave({
      supplier_id: supplierId,
      date,
      notes,
      items: items.map(({ _name, ...rest }) => rest),
    });
  };

  return (
    <Modal open onClose={onClose} width={800}>
      <ModalHeader icon="🛒" title={initial ? 'Modifier la Commande d\'Achat' : 'Nouvelle Commande d\'Achat'} />

      <ModalBody>
        <div className="form-row">
          <Select label="Fournisseur *" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
            <option value="">— Sélectionnez un fournisseur —</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Input label="Date *" type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <Input label="Notes" type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Remarques, instructions..." />

        <div className="form-group">
          <label className="form-label">Ajouter un produit</label>
          <input
            type="text"
            className="input"
            placeholder="Tapez une référence ou désignation..."
            value={productSearch}
            onChange={e => setProductSearch(e.target.value)}
          />
          {productSearch && filteredProducts.length > 0 && (
            <div className="card card-body-compact" style={{ marginTop: 6, maxHeight: 180, overflowY: 'auto' }}>
              {filteredProducts.slice(0, 8).map(p => (
                <div key={p.id} onClick={() => addLine(p)} className="list-item" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span><strong>{p.reference}</strong> — {p.designation}</span>
                  <span className="money text-muted">{p.purchase_price?.toFixed(2) ?? '—'} MAD</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {items.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Produit</th>
                  <th className="text-center" style={{ width: 100 }}>Qté</th>
                  <th className="text-right" style={{ width: 130 }}>P.U. (MAD)</th>
                  <th className="text-right" style={{ width: 120 }}>Total</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => {
                  const lineTotal = item.quantity * item.unit_price;
                  return (
                    <tr key={idx}>
                      <td>{item._name}</td>
                      <td>
                        <input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={e => updateLine(idx, 'quantity', Number(e.target.value))}
                          className="input input-sm text-center"
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.unit_price}
                          onChange={e => updateLine(idx, 'unit_price', Number(e.target.value))}
                          className="input input-sm text-right"
                        />
                      </td>
                      <td className="money text-right font-semibold">{lineTotal.toFixed(2)}</td>
                      <td className="text-center">
                        <Button variant="ghost" size="sm" onClick={() => removeLine(idx)} className="text-danger">×</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className="text-right font-semibold" style={{ fontSize: 'var(--font-size-lg)' }}>TOTAL :</td>
                  <td className="money text-right font-semibold" style={{ fontSize: 'var(--font-size-xl)' }}>{total.toFixed(2)} MAD</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Annuler</Button>
        <Button onClick={handleSave} disabled={!supplierId || items.length === 0}>
          {initial ? '💾 Enregistrer les modifications' : '🛒 Créer la commande'}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

// ─── Détail d'une commande ───────────────────────────────────────────────────

const OrderDetailPanel: React.FC<{
  order: PurchaseOrder;
  onConfirm: (id: string) => void;
  onReceive: (id: string) => void;
  onCancel: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (order: PurchaseOrder) => void;
}> = ({ order, onConfirm, onReceive, onCancel, onDelete, onEdit }) => {
  const statusInfo = getPurchaseBadge(order.status);

  return (
    <div className="flex flex-col gap-4">
      <Card padding>
        <div className="flex justify-between items-center">
          <div>
            <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700 }}>{order.order_number}</div>
            <div className="text-muted text-sm" style={{ marginTop: 4 }}>{order.supplier_name} · {order.date?.split('T')[0]}</div>
          </div>
          <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
        </div>
        <div className="grid-3 mt-4">
          <div className="surface-muted text-center">
            <div className="text-xs text-muted">Total</div>
            <div className="money" style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700 }}>{order.total?.toFixed(2) ?? '0.00'} MAD</div>
          </div>
          <div className="surface-muted text-center">
            <div className="text-xs text-muted">Articles</div>
            <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700 }}>{order.items?.length ?? 0}</div>
          </div>
        </div>
      </Card>

      {(order.items ?? []).length > 0 && (
        <Card padding>
          <h3 style={{ marginTop: 0 }}>Produits</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Produit</th>
                <th className="text-center">Qté</th>
                <th className="text-right">P.U.</th>
                <th className="text-right">Total</th>
                {order.status === 'CONFIRMED' && <th className="text-center">Qté reçue</th>}
              </tr>
            </thead>
            <tbody>
              {(order.items ?? []).map(item => (
                <tr key={item.id ?? item.product_id}>
                  <td><strong>{item.product_ref}</strong> {item.product_name}</td>
                  <td className="qty text-center">{item.quantity}</td>
                  <td className="money text-right">{item.unit_price?.toFixed(2)}</td>
                  <td className="money text-right font-semibold">
                    {item.total?.toFixed(2) ?? (item.quantity * item.unit_price).toFixed(2)} MAD
                  </td>
                  {order.status === 'CONFIRMED' && (
                    <td className="qty text-center text-success font-semibold">{item.received_qty ?? 0}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {order.notes && (
        <Card padding>
          <h3 style={{ marginTop: 0 }}>Notes</h3>
          <p className="text-secondary" style={{ margin: 0 }}>{order.notes}</p>
        </Card>
      )}

      <div className="flex gap-3" style={{ flexWrap: 'wrap' }}>
        {order.status === 'DRAFT' && (
          <>
            <Button block onClick={() => onEdit(order)}>✏️ Modifier</Button>
            <Button block onClick={() => onConfirm(order.id)}>✅ Confirmer la commande</Button>
            <Button variant="danger" block onClick={() => onDelete(order.id)}>🗑️ Supprimer</Button>
          </>
        )}
        {order.status === 'CONFIRMED' && (
          <>
            <Button variant="success" block onClick={() => onReceive(order.id)}>📦 Réceptionner la commande</Button>
            <Button variant="secondary" block onClick={() => onCancel(order.id)} style={{ background: 'var(--warning)', color: 'var(--on-primary)', borderColor: 'transparent' }}>
              ❌ Annuler
            </Button>
          </>
        )}
        {order.status === 'RECEIVED' && (
          <div className="text-sm text-secondary" style={{ width: '100%', padding: '12px 0', lineHeight: 1.6 }}>
            📦 Commande <strong>réceptionnée</strong> — le stock a déjà été mis à jour. Elle ne peut plus être <strong>modifiée</strong> ni <strong>supprimée</strong>, sinon l'historique de stock deviendrait incohérent.
          </div>
        )}
        {order.status === 'CANCELLED' && (
          <div className="text-sm text-secondary" style={{ width: '100%', padding: '12px 0', lineHeight: 1.6 }}>
            ❌ Commande <strong>annulée</strong> — elle ne peut plus être ni modifiée, ni supprimée, ni réceptionnée.
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Page Principale ──────────────────────────────────────────────────────────

export const PurchasesPage: React.FC = () => {
  const {
    orders, selectedOrder, searchQuery, isLoading,
    setSearchQuery, loadOrders, selectOrder,
    createOrder, updateOrder, confirmOrder, receiveOrder, cancelOrder, deleteOrder,
  } = usePurchaseStore();

  const [showNewForm, setShowNewForm] = useState(false);
  const [editingOrder, setEditingOrder] = useState<PurchaseOrder | null>(null);

  useEffect(() => { loadOrders(); }, []);

  const handleCreate = async (data: any) => {
    try {
      await createOrder(data);
      setShowNewForm(false);
      toast.success('Commande d\'achat créée avec succès.');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleEdit = (order: PurchaseOrder) => {
    setEditingOrder(order);
  };

  const handleEditSave = async (data: any) => {
    if (!editingOrder) return;
    try {
      await updateOrder(editingOrder.id, data);
      setEditingOrder(null);
      toast.success('Commande d\'achat modifiée avec succès.');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleConfirm = async (id: string) => {
    try {
      await confirmOrder(id);
      toast.success('Commande confirmée.');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleReceive = async (id: string) => {
    try {
      await receiveOrder(id);
      toast.success('Commande réceptionnée : le stock a été mis à jour.');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const [pendingConfirm, setPendingConfirm] = useState<{
    title: string;
    message: React.ReactNode;
    danger?: boolean;
    confirmLabel: string;
    action: () => void;
  } | null>(null);

  const handleCancel = async (id: string) => {
    setPendingConfirm({
      title: 'Annuler cette commande ?',
      message: (
        <>
          La commande sera marquée <strong>annulée</strong> et ne pourra plus être réceptionnée.
        </>
      ),
      danger: true,
      confirmLabel: 'Annuler la commande',
      action: async () => {
        try {
          await cancelOrder(id);
          toast.success('Commande annulée.');
        } catch (e: any) {
          toast.error(e.message);
        }
      },
    });
  };

  const handleDelete = async (id: string) => {
    setPendingConfirm({
      title: 'Supprimer cette commande ?',
      message: (
        <>
          La commande sera <strong>définitivement supprimée</strong>. Cette action est irréversible.
        </>
      ),
      danger: true,
      confirmLabel: 'Supprimer définitivement',
      action: async () => {
        try {
          await deleteOrder(id);
          toast.success('Commande supprimée.');
        } catch (e: any) {
          toast.error(e.message);
        }
      },
    });
  };

  return (
    <div className="page-shell">
      <PageHeader
        icon="🛒"
        title="Commandes d'Achat"
        actions={
          <Button onClick={() => setShowNewForm(true)}>+ Nouvelle commande</Button>
        }
      />

      <div style={{ padding: '12px 28px', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        <input
          type="text"
          className="input input-lg"
          placeholder="Rechercher par numéro, fournisseur..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="flex flex-1" style={{ overflow: 'hidden' }}>
        <div style={{ width: 360, borderRight: '1px solid var(--border)', overflowY: 'auto', background: 'var(--surface)', flexShrink: 0 }}>
          {isLoading && <div className="state-box" style={{ padding: 20 }}>Chargement...</div>}
          {orders.length === 0 && !isLoading && (
            <div className="state-box">
              <div className="state-icon">🛒</div>
              <div className="state-text">Aucune commande d'achat trouvée.</div>
            </div>
          )}
          {orders.map(order => {
            const statusInfo = getPurchaseBadge(order.status);
            const isSelected = selectedOrder?.id === order.id;
            return (
              <div
                key={order.id}
                onClick={() => selectOrder(order)}
                className={isSelected ? 'list-item-selected' : ''}
                style={{
                  padding: '14px 20px',
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--border)',
                  borderLeft: isSelected ? '4px solid var(--primary)' : '4px solid transparent',
                  background: isSelected ? 'var(--primary-soft)' : 'transparent',
                  transition: 'all 0.15s',
                }}
              >
                <div className="flex justify-between items-center">
                  <span className="font-semibold">{order.order_number}</span>
                  <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                </div>
                <div className="text-sm text-secondary" style={{ marginTop: 4 }}>{order.supplier_name}</div>
                <div className="flex justify-between" style={{ marginTop: 6 }}>
                  <span className="text-sm text-muted">{order.date?.split('T')[0]}</span>
                  <span className="money font-semibold">{order.total?.toFixed(2) ?? '0.00'} MAD</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="page-content" style={{ flex: 1, padding: '24px' }}>
          {!selectedOrder ? (
            <div className="state-box" style={{ height: '100%' }}>
              <div className="state-icon">🛒</div>
              <div className="state-text">← Sélectionnez une commande pour voir les détails</div>
            </div>
          ) : (
            <OrderDetailPanel
              order={selectedOrder}
              onConfirm={handleConfirm}
              onReceive={handleReceive}
              onCancel={handleCancel}
              onDelete={handleDelete}
              onEdit={handleEdit}
            />
          )}
        </div>
      </div>

      {showNewForm && (
        <NewOrderModal onClose={() => setShowNewForm(false)} onSave={handleCreate} />
      )}

      {editingOrder && (
        <NewOrderModal
          initial={editingOrder}
          onClose={() => setEditingOrder(null)}
          onSave={handleEditSave}
        />
      )}

      {pendingConfirm && (
        <ConfirmDialog
          open
          title={pendingConfirm.title}
          message={pendingConfirm.message}
          danger={pendingConfirm.danger}
          confirmLabel={pendingConfirm.confirmLabel}
          onConfirm={() => {
            pendingConfirm.action();
            setPendingConfirm(null);
          }}
          onCancel={() => setPendingConfirm(null)}
        />
      )}
    </div>
  );
};
