import React, { useEffect, useState } from 'react';
import { usePurchaseStore } from '../stores/usePurchaseStore';
import { useSupplierStore } from '../stores/useSupplierStore';
import { useProductStore } from '../stores/useProductStore';
import { toast } from '../stores/useToastStore';
import type { PurchaseOrder, PurchaseStatus } from '../stores/usePurchaseStore';

// ─── Constantes ──────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<PurchaseStatus, { label: string; color: string; bg: string }> = {
  DRAFT:     { label: 'Brouillon',   color: '#374151', bg: '#f3f4f6' },
  CONFIRMED: { label: 'Confirmée',   color: '#1e40af', bg: '#dbeafe' },
  RECEIVED:  { label: 'Réceptionnée', color: '#065f46', bg: '#d1fae5' },
  CANCELLED: { label: 'Annulée',     color: '#6b7280', bg: '#f3f4f6' },
};

// ─── Formulaire Nouvelle Commande ────────────────────────────────────────────

const NewOrderModal: React.FC<{
  onClose: () => void;
  onSave: (data: any) => void;
}> = ({ onClose, onSave }) => {
  const { suppliers, loadSuppliers } = useSupplierStore();
  const { products, loadProducts } = useProductStore();
  const [supplierId, setSupplierId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<Array<{ product_id: string; quantity: number; unit_price: number; _name?: string }>>([]);
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
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: 'white', borderRadius: '16px', width: '800px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 25px 50px rgba(0,0,0,0.4)', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ padding: '24px 28px 20px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '24px' }}>🛒</span>
          <h2 style={{ margin: 0, color: '#0f172a' }}>Nouvelle Commande d'Achat</h2>
        </div>

        <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Informations générales */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '14px', color: '#374151' }}>Fournisseur *</label>
              <select value={supplierId} onChange={e => setSupplierId(e.target.value)}
                style={{ width: '100%', padding: '12px', fontSize: '15px', border: '2px solid #e5e7eb', borderRadius: '8px' }}>
                <option value="">— Sélectionnez un fournisseur —</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '14px', color: '#374151' }}>Date *</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                style={{ width: '100%', padding: '12px', fontSize: '15px', border: '2px solid #e5e7eb', borderRadius: '8px', boxSizing: 'border-box' }} />
            </div>
            <div style={{ gridColumn: '1 / 3' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '14px', color: '#374151' }}>Notes</label>
              <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Remarques, instructions..."
                style={{ width: '100%', padding: '12px', fontSize: '15px', border: '2px solid #e5e7eb', borderRadius: '8px', boxSizing: 'border-box' }} />
            </div>
          </div>

          {/* Recherche produit */}
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: '#374151' }}>Ajouter un produit</label>
            <input type="text" placeholder="Tapez une référence ou désignation..."
              value={productSearch} onChange={e => setProductSearch(e.target.value)}
              style={{ width: '100%', padding: '12px', fontSize: '15px', border: '2px solid #e5e7eb', borderRadius: '8px', boxSizing: 'border-box' }} />
            {productSearch && filteredProducts.length > 0 && (
              <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', marginTop: '6px', maxHeight: '180px', overflowY: 'auto', background: 'white', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                {filteredProducts.slice(0, 8).map(p => (
                  <div key={p.id} onClick={() => addLine(p)}
                    style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <span><strong>{p.reference}</strong> — {p.designation}</span>
                    <span style={{ color: '#6b7280' }}>{p.purchase_price?.toFixed(2) ?? '—'} MAD</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Lignes de produits */}
          {items.length > 0 && (
            <div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', textAlign: 'left' }}>
                    <th style={{ padding: '10px', borderBottom: '2px solid #e5e7eb' }}>Produit</th>
                    <th style={{ padding: '10px', width: '100px', borderBottom: '2px solid #e5e7eb', textAlign: 'center' }}>Qté</th>
                    <th style={{ padding: '10px', width: '130px', borderBottom: '2px solid #e5e7eb', textAlign: 'right' }}>P.U. (MAD)</th>
                    <th style={{ padding: '10px', width: '120px', borderBottom: '2px solid #e5e7eb', textAlign: 'right' }}>Total</th>
                    <th style={{ padding: '10px', width: '40px', borderBottom: '2px solid #e5e7eb' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => {
                    const lineTotal = item.quantity * item.unit_price;
                    return (
                      <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '8px 10px' }}>{item._name}</td>
                        <td style={{ padding: '4px 8px' }}>
                          <input type="number" min="1" value={item.quantity} onChange={e => updateLine(idx, 'quantity', Number(e.target.value))}
                            style={{ width: '100%', padding: '6px', textAlign: 'center', border: '1px solid #d1d5db', borderRadius: '6px' }} />
                        </td>
                        <td style={{ padding: '4px 8px' }}>
                          <input type="number" min="0" step="0.01" value={item.unit_price} onChange={e => updateLine(idx, 'unit_price', Number(e.target.value))}
                            style={{ width: '100%', padding: '6px', textAlign: 'right', border: '1px solid #d1d5db', borderRadius: '6px' }} />
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: '600' }}>{lineTotal.toFixed(2)}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                          <button onClick={() => removeLine(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: '18px' }}>×</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: '#f8fafc', fontWeight: 'bold' }}>
                    <td colSpan={3} style={{ padding: '12px 10px', textAlign: 'right', fontSize: '16px' }}>TOTAL :</td>
                    <td style={{ padding: '12px 10px', textAlign: 'right', fontSize: '18px', color: '#0f172a' }}>{total.toFixed(2)} MAD</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '20px 28px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button onClick={onClose} style={{ padding: '12px 24px', background: '#f3f4f6', border: 'none', borderRadius: '8px', fontSize: '15px', cursor: 'pointer' }}>Annuler</button>
          <button onClick={handleSave} disabled={!supplierId || items.length === 0}
            style={{ padding: '12px 28px', background: !supplierId || items.length === 0 ? '#9ca3af' : '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: 'bold', cursor: !supplierId || items.length === 0 ? 'not-allowed' : 'pointer' }}>
            🛒 Créer la commande
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Détail d'une commande ───────────────────────────────────────────────────

const OrderDetailPanel: React.FC<{
  order: PurchaseOrder;
  onConfirm: (id: string) => void;
  onReceive: (id: string) => void;
  onCancel: (id: string) => void;
  onDelete: (id: string) => void;
}> = ({ order, onConfirm, onReceive, onCancel, onDelete }) => {
  const statusInfo = STATUS_LABELS[order.status] || STATUS_LABELS.DRAFT;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Résumé */}
      <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '22px', fontWeight: 'bold', color: '#0f172a' }}>{order.order_number}</div>
            <div style={{ color: '#6b7280', marginTop: '4px' }}>{order.supplier_name} · {order.date?.split('T')[0]}</div>
          </div>
          <span style={{ padding: '6px 14px', borderRadius: '20px', fontSize: '13px', fontWeight: '700', background: statusInfo.bg, color: statusInfo.color }}>{statusInfo.label}</span>
        </div>
        <div style={{ marginTop: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div style={{ textAlign: 'center', padding: '12px', background: '#f8fafc', borderRadius: '8px' }}>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>Total</div>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#0f172a' }}>{order.total?.toFixed(2) ?? '0.00'} MAD</div>
          </div>
          <div style={{ textAlign: 'center', padding: '12px', background: '#f8fafc', borderRadius: '8px' }}>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>Articles</div>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#0f172a' }}>{order.items?.length ?? 0}</div>
          </div>
        </div>
      </div>

      {/* Lignes produits */}
      {(order.items ?? []).length > 0 && (
        <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h3 style={{ marginTop: 0 }}>Produits</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Produit</th>
                <th style={{ padding: '8px', textAlign: 'center', borderBottom: '1px solid #e5e7eb' }}>Qté</th>
                <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>P.U.</th>
                <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>Total</th>
                {order.status === 'CONFIRMED' && (
                  <th style={{ padding: '8px', textAlign: 'center', borderBottom: '1px solid #e5e7eb' }}>Qté reçue</th>
                )}
              </tr>
            </thead>
            <tbody>
              {(order.items ?? []).map(item => (
                <tr key={item.id ?? item.product_id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '8px 10px' }}><strong>{item.product_ref}</strong> {item.product_name}</td>
                  <td style={{ padding: '8px', textAlign: 'center' }}>{item.quantity}</td>
                  <td style={{ padding: '8px', textAlign: 'right' }}>{item.unit_price?.toFixed(2)}</td>
                  <td style={{ padding: '8px', textAlign: 'right', fontWeight: '600' }}>{item.total?.toFixed(2) ?? (item.quantity * item.unit_price).toFixed(2)} MAD</td>
                  {order.status === 'CONFIRMED' && (
                    <td style={{ padding: '8px', textAlign: 'center', color: '#10b981', fontWeight: '600' }}>{item.received_qty ?? 0}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Notes */}
      {order.notes && (
        <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h3 style={{ marginTop: 0 }}>Notes</h3>
          <p style={{ margin: 0, color: '#374151' }}>{order.notes}</p>
        </div>
      )}

      {/* Boutons d'action */}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        {order.status === 'DRAFT' && (
          <>
            <button onClick={() => onConfirm(order.id)}
              style={{ flex: 1, padding: '14px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: 'bold', cursor: 'pointer' }}>
              ✅ Confirmer la commande
            </button>
            <button onClick={() => onDelete(order.id)}
              style={{ flex: 1, padding: '14px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: 'bold', cursor: 'pointer' }}>
              🗑️ Supprimer
            </button>
          </>
        )}
        {order.status === 'CONFIRMED' && (
          <>
            <button onClick={() => onReceive(order.id)}
              style={{ flex: 1, padding: '14px', background: '#10b981', color: 'white', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: 'bold', cursor: 'pointer' }}>
              📦 Réceptionner la commande
            </button>
            <button onClick={() => onCancel(order.id)}
              style={{ flex: 1, padding: '14px', background: '#f59e0b', color: 'white', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: 'bold', cursor: 'pointer' }}>
              ❌ Annuler
            </button>
          </>
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
    createOrder, confirmOrder, receiveOrder, cancelOrder, deleteOrder,
  } = usePurchaseStore();

  const [showNewForm, setShowNewForm] = useState(false);

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

  const handleCancel = async (id: string) => {
    if (!window.confirm('Êtes-vous sûr de vouloir annuler cette commande ?')) return;
    try {
      await cancelOrder(id);
      toast.success('Commande annulée.');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Êtes-vous sûr de vouloir supprimer cette commande ?')) return;
    try {
      await deleteOrder(id);
      toast.success('Commande supprimée.');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#f8fafc', height: '100vh', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '20px 28px 16px', background: 'white', borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h1 style={{ margin: 0, fontSize: '26px', color: '#0f172a', flex: 1 }}>🛒 Commandes d'Achat</h1>
          <button onClick={() => setShowNewForm(true)}
            style={{ padding: '10px 22px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: 'bold', cursor: 'pointer' }}>
            + Nouvelle commande
          </button>
        </div>
      </div>

      {/* Barre de recherche */}
      <div style={{ padding: '12px 28px', background: 'white', borderBottom: '1px solid #e5e7eb' }}>
        <input type="text" placeholder="Rechercher par numéro, fournisseur..."
          value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
          style={{ width: '100%', padding: '12px 16px', fontSize: '16px', border: '2px solid #e5e7eb', borderRadius: '8px', boxSizing: 'border-box', outline: 'none' }} />
      </div>

      {/* Contenu */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Liste commandes */}
        <div style={{ width: '360px', borderRight: '1px solid #e5e7eb', overflowY: 'auto', background: 'white', flexShrink: 0 }}>
          {isLoading && <div style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>Chargement...</div>}
          {orders.length === 0 && !isLoading && (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: '#9ca3af' }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>🛒</div>
              <div>Aucune commande d'achat trouvée.</div>
            </div>
          )}
          {orders.map(order => {
            const statusInfo = STATUS_LABELS[order.status] || STATUS_LABELS.DRAFT;
            const isSelected = selectedOrder?.id === order.id;
            return (
              <div key={order.id} onClick={() => selectOrder(order)}
                style={{ padding: '14px 20px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', background: isSelected ? '#eff6ff' : 'transparent', borderLeft: isSelected ? '4px solid #3b82f6' : '4px solid transparent', transition: 'all 0.15s' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <span style={{ fontWeight: '700', fontSize: '15px', color: '#0f172a' }}>{order.order_number}</span>
                  <span style={{ padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: '700', background: statusInfo.bg, color: statusInfo.color }}>{statusInfo.label}</span>
                </div>
                <div style={{ fontSize: '13px', color: '#374151', marginTop: '4px' }}>{order.supplier_name}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
                  <span style={{ fontSize: '13px', color: '#9ca3af' }}>{order.date?.split('T')[0]}</span>
                  <span style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>{order.total?.toFixed(2) ?? '0.00'} MAD</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Détail */}
        <div style={{ flex: 1, padding: '24px', overflowY: 'auto' }}>
          {!selectedOrder ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#9ca3af', fontSize: '18px', flexDirection: 'column', gap: '12px' }}>
              <span style={{ fontSize: '64px' }}>🛒</span>
              ← Sélectionnez une commande pour voir les détails
            </div>
          ) : (
            <OrderDetailPanel
              order={selectedOrder}
              onConfirm={handleConfirm}
              onReceive={handleReceive}
              onCancel={handleCancel}
              onDelete={handleDelete}
            />
          )}
        </div>
      </div>

      {showNewForm && (
        <NewOrderModal onClose={() => setShowNewForm(false)} onSave={handleCreate} />
      )}
    </div>
  );
};
