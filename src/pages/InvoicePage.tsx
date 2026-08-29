import React, { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useDocumentStore } from '../stores/useDocumentStore';
import { useProductStore } from '../stores/useProductStore';
import { useClientStore } from '../stores/useClientStore';
import { toast } from '../stores/useToastStore';
import type { Document, DocumentType } from '../repositories/DocumentRepository';

// ─── Constantes ──────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<DocumentType, { label: string; icon: string; color: string }> = {
  QUOTE:         { label: 'Devis',          icon: '📋', color: 'var(--primary)' },
  DELIVERY_NOTE: { label: 'Bon de livraison', icon: '🚚', color: 'var(--warning)' },
  INVOICE:       { label: 'Factures',       icon: '📄', color: 'var(--info)' },
  CREDIT_NOTE:   { label: 'Avoirs',         icon: '↩️', color: 'var(--success)' },
};

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  PAID:      { label: 'Payée',      color: 'var(--success)', bg: 'var(--success-soft)' },
  UNPAID:    { label: 'Impayée',    color: 'var(--danger)', bg: 'var(--danger-soft)' },
  PARTIAL:   { label: 'Partielle',  color: 'var(--warning)', bg: 'var(--warning-soft)' },
  DRAFT:     { label: 'Brouillon',  color: 'var(--text-secondary)', bg: 'var(--surface-2)' },
  CANCELLED: { label: 'Annulée',    color: 'var(--muted)', bg: 'var(--surface-2)' },
};

// ─── Modal de Retour Partiel (Avoir) ────────────────────────────────────────

const PartialReturnModal: React.FC<{
  doc: Document;
  onClose: () => void;
  onConfirm: (returnItems: Array<{ product_id: string; quantity: number }>, reason: string) => void;
}> = ({ doc, onClose, onConfirm }) => {
  const [reason, setReason] = useState('Retour marchandise');
  const [returnQty, setReturnQty] = useState<Record<string, number>>({});
  const [returnAll, setReturnAll] = useState(false);

  const items = doc.items ?? [];

  // Initialiser les quantités à retourner
  useEffect(() => {
    const initial: Record<string, number> = {};
    items.forEach(item => { initial[item.product_id] = item.quantity; });
    setReturnQty(initial);
  }, [doc.id]);

  const handleToggleAll = () => {
    if (returnAll) {
      // Désélectionner tout
      const zeroed: Record<string, number> = {};
      items.forEach(item => { zeroed[item.product_id] = 0; });
      setReturnQty(zeroed);
      setReturnAll(false);
    } else {
      // Tout sélectionner
      const all: Record<string, number> = {};
      items.forEach(item => { all[item.product_id] = item.quantity; });
      setReturnQty(all);
      setReturnAll(true);
    }
  };

  const updateQty = (productId: string, qty: number, maxQty: number) => {
    const clamped = Math.max(0, Math.min(qty, maxQty));
    setReturnQty(prev => ({ ...prev, [productId]: clamped }));
    // Vérifier si tout est sélectionné
    const updated = { ...returnQty, [productId]: clamped };
    const allSelected = items.every(it => updated[it.product_id] === it.quantity);
    setReturnAll(allSelected);
  };

  const selectedItems = items.filter(it => (returnQty[it.product_id] ?? 0) > 0);
  const totalReturn = selectedItems.reduce((sum, it) => {
    const qty = returnQty[it.product_id] ?? 0;
    return sum + qty * it.unit_price * (1 - it.discount / 100);
  }, 0);

  const isFullReturn = items.every(it => (returnQty[it.product_id] ?? 0) >= it.quantity);

  const handleConfirm = () => {
    const returnItems = selectedItems.map(it => ({
      product_id: it.product_id,
      quantity: returnQty[it.product_id] ?? 0,
    }));
    onConfirm(returnItems, reason);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-xl)', width: '700px', maxHeight: '85vh', overflowY: 'auto', boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ padding: '24px 28px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '24px' }}>↩️</span>
          <div>
            <h2 style={{ margin: 0, color: 'var(--text)' }}>Créer un Avoir</h2>
            <div style={{ color: 'var(--text-secondary)', fontSize: '14px', marginTop: '4px' }}>Facture : {doc.document_number}</div>
          </div>
        </div>

        <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Motif */}
          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '14px', color: 'var(--text-secondary)' }}>Motif du retour</label>
            <input type="text" value={reason} onChange={e => setReason(e.target.value)}
              placeholder="Ex: Produit défectueux, Annulation commande..."
              className="input" />
          </div>

          {/* Sélection retour total/partiel */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button onClick={handleToggleAll}
              style={{ padding: '8px 16px', borderRadius: '8px', border: '2px solid', fontWeight: '600', fontSize: '14px', cursor: 'pointer',
                borderColor: returnAll ? 'var(--success)' : 'var(--border-strong)', background: returnAll ? 'var(--success-soft)' : 'var(--surface)', color: returnAll ? 'var(--success)' : 'var(--text-secondary)' }}>
              {returnAll ? '✓ Tout retourner' : 'Tout sélectionner'}
            </button>
            <span style={{ fontSize: '13px', color: 'var(--muted)' }}>
              {isFullReturn ? 'Retour total — la facture sera annulée' : 'Retour partiel — la facture reste active'}
            </span>
          </div>

          {/* Lignes de retour */}
          <div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr style={{ background: 'var(--surface-2)', textAlign: 'left' }}>
                  <th style={{ padding: '10px', borderBottom: '2px solid var(--border)' }}>Produit</th>
                  <th style={{ padding: '10px', width: '80px', borderBottom: '2px solid var(--border)', textAlign: 'center' }}>Qté facture</th>
                  <th style={{ padding: '10px', width: '100px', borderBottom: '2px solid var(--border)', textAlign: 'center' }}>Qté retour</th>
                  <th style={{ padding: '10px', width: '110px', borderBottom: '2px solid var(--border)', textAlign: 'right' }}>P.U.</th>
                  <th style={{ padding: '10px', width: '110px', borderBottom: '2px solid var(--border)', textAlign: 'right' }}>Total retour</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  const qty = returnQty[item.product_id] ?? 0;
                  const lineTotal = qty * item.unit_price * (1 - item.discount / 100);
                  return (
                    <tr key={item.id} style={{ borderBottom: '1px solid var(--border)', background: qty > 0 ? 'var(--success-soft)' : 'transparent' }}>
                      <td style={{ padding: '8px 10px' }}><strong>{item.product_ref}</strong> {item.product_name}</td>
                      <td style={{ padding: '8px', textAlign: 'center', color: 'var(--text-secondary)' }}>{item.quantity}</td>
                      <td style={{ padding: '4px 8px' }}>
                        <input type="number" min="0" max={item.quantity} value={qty}
                          onChange={e => updateQty(item.product_id, Number(e.target.value), item.quantity)}
                          className="input" />
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right', color: 'var(--text-secondary)' }}>{item.unit_price.toFixed(2)} MAD</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: '600', color: qty > 0 ? 'var(--danger)' : 'var(--text-secondary)' }}>
                        {lineTotal.toFixed(2)} MAD
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--surface-2)', fontWeight: 'bold' }}>
                  <td colSpan={4} style={{ padding: '12px 10px', textAlign: 'right', fontSize: '16px' }}>TOTAL AVOIR :</td>
                  <td style={{ padding: '12px 10px', textAlign: 'right', fontSize: '18px', color: 'var(--danger)' }}>{totalReturn.toFixed(2)} MAD</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '20px 28px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            {isFullReturn
              ? '⚠️ La facture originale sera annulée.'
              : '✅ La facture originale restera active.'}
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button onClick={onClose}
              className="btn btn-secondary">
              Annuler
            </button>
            <button onClick={handleConfirm} disabled={selectedItems.length === 0}
              className="btn btn-danger" >
              ↩️ Créer l'avoir ({totalReturn.toFixed(2)} MAD)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Formulaire de Création de Document ──────────────────────────────────────

const NewDocumentModal: React.FC<{
  type: DocumentType;
  onClose: () => void;
  onSave: (data: any) => void;
}> = ({ type, onClose, onSave }) => {
  const { clients, loadClients } = useClientStore();
  const { products, loadProducts } = useProductStore();
  const [entityId, setEntityId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<Array<{ product_id: string; quantity: number; unit_price: number; discount: number; _name?: string }>>([]);
  const [productSearch, setProductSearch] = useState('');

  useEffect(() => {
    loadClients();
    loadProducts();
  }, []);

  const filteredProducts = products.filter(p =>
    productSearch === '' || p.designation.toLowerCase().includes(productSearch.toLowerCase()) || p.reference.toLowerCase().includes(productSearch.toLowerCase())
  );

  const addLine = (product: any) => {
    setItems(prev => [...prev, {
      product_id: product.id,
      quantity: 1,
      unit_price: product.selling_price ?? 0,
      discount: 0,
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

  const total = items.reduce((sum, it) => sum + it.quantity * it.unit_price * (1 - it.discount / 100), 0);

  // Application automatique des remises par volume (tarification §6)
  const applyVolumeDiscount = (item: { product_id: string; quantity: number }, idx: number) => {
    const product = products.find(p => p.id === item.product_id);
    if (!product) return;
    const volumePrice = item.quantity >= 10 ? product.wholesale_price : item.quantity >= 3 ? (product.selling_price * 0.95) : product.selling_price;
    updateLine(idx, 'unit_price', Math.round(volumePrice * 100) / 100);
  };

  const handleSave = () => {
    onSave({ type, entity_id: entityId, date, due_date: dueDate || undefined, notes, items: items.map(({ _name, ...rest }) => rest) });
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-xl)', width: '800px', maxHeight: '90vh', overflowY: 'auto', boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ padding: '24px 28px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '24px' }}>{TYPE_LABELS[type].icon}</span>
          <h2 style={{ margin: 0, color: 'var(--text)' }}>Nouveau {TYPE_LABELS[type].label}</h2>
        </div>

        <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Informations générales */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '14px', color: 'var(--text-secondary)' }}>Client *</label>
              <select value={entityId} onChange={e => setEntityId(e.target.value)}
                className="select">
                <option value="">— Sélectionnez un client —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '14px', color: 'var(--text-secondary)' }}>Date *</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="input" />
            </div>
            {type === 'INVOICE' && (
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '14px', color: 'var(--text-secondary)' }}>Échéance</label>
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                  className="input" />
              </div>
            )}
            <div style={{ gridColumn: type === 'INVOICE' ? '2 / 3' : '1 / 3' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '14px', color: 'var(--text-secondary)' }}>Notes</label>
              <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Remarques, instructions..."
                className="input" />
            </div>
          </div>

          {/* Recherche produit */}
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '14px', color: 'var(--text-secondary)' }}>Ajouter un produit</label>
            <input type="text" placeholder="Tapez une référence ou désignation..."
              value={productSearch} onChange={e => setProductSearch(e.target.value)}
              className="input" />
            {productSearch && filteredProducts.length > 0 && (
              <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', marginTop: '6px', maxHeight: '180px', overflowY: 'auto', background: 'var(--surface)', boxShadow: 'var(--shadow-md)' }}>
                {filteredProducts.slice(0, 8).map(p => (
                  <div key={p.id} onClick={() => addLine(p)}
                    style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <span><strong>{p.reference}</strong> — {p.designation}</span>
                    <span style={{ color: 'var(--text-secondary)' }}>{p.selling_price?.toFixed(2)} MAD</span>
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
                  <tr style={{ background: 'var(--surface-2)', textAlign: 'left' }}>
                    <th style={{ padding: '10px', borderBottom: '2px solid var(--border)' }}>Produit</th>
                    <th style={{ padding: '10px', width: '80px', borderBottom: '2px solid var(--border)', textAlign: 'center' }}>Qté</th>
                    <th style={{ padding: '10px', width: '110px', borderBottom: '2px solid var(--border)', textAlign: 'right' }}>P.U. (MAD)</th>
                    <th style={{ padding: '10px', width: '80px', borderBottom: '2px solid var(--border)', textAlign: 'center' }}>Rem%</th>
                    <th style={{ padding: '10px', width: '110px', borderBottom: '2px solid var(--border)', textAlign: 'right' }}>Total</th>
                    <th style={{ padding: '10px', width: '40px', borderBottom: '2px solid var(--border)' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => {
                    const lineTotal = item.quantity * item.unit_price * (1 - item.discount / 100);
                    return (
                      <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 10px' }}>{item._name}</td>
                        <td style={{ padding: '4px 8px' }}>
                          <input type="number" min="1" value={item.quantity} onChange={e => { updateLine(idx, 'quantity', Number(e.target.value)); applyVolumeDiscount(item, idx); }}
                            className="input" />
                        </td>
                        <td style={{ padding: '4px 8px' }}>
                          <input type="number" min="0" step="0.01" value={item.unit_price} onChange={e => updateLine(idx, 'unit_price', Number(e.target.value))}
                            className="input" />
                        </td>
                        <td style={{ padding: '4px 8px' }}>
                          <input type="number" min="0" max="100" value={item.discount} onChange={e => updateLine(idx, 'discount', Number(e.target.value))}
                            className="input" />
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: '600' }}>{lineTotal.toFixed(2)}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                          <button onClick={() => removeLine(idx)} className="btn btn-ghost" style={{ color: 'var(--danger)', fontSize: '18px' }}>×</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: 'var(--surface-2)', fontWeight: 'bold' }}>
                    <td colSpan={4} style={{ padding: '12px 10px', textAlign: 'right', fontSize: '16px' }}>TOTAL HT :</td>
                    <td style={{ padding: '12px 10px', textAlign: 'right', fontSize: '18px', color: 'var(--text)' }}>{total.toFixed(2)} MAD</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '20px 28px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button onClick={onClose} className="btn btn-secondary">Annuler</button>
          <button onClick={handleSave} disabled={!entityId || items.length === 0}
            className="btn btn-primary">
            Enregistrer {TYPE_LABELS[type].label}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Détail d'un document ─────────────────────────────────────────────────────

const DocumentDetailPanel: React.FC<{
  doc: Document;
  onPayment: (amount: number, method: string) => void;
  onConvert?: () => void;
  onPrint: () => void;
  onCreditNote?: () => void;
}> = ({ doc, onPayment, onConvert, onPrint, onCreditNote }) => {
  const [payAmount, setPayAmount] = useState(0);
  const [payMethod, setPayMethod] = useState('CASH');
  const remaining = doc.total_incl_tax - (doc.amount_paid ?? 0);
  const statusInfo = STATUS_LABELS[doc.status] || STATUS_LABELS.DRAFT;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Résumé */}
      <div className="card card-body">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '22px', fontWeight: 'bold', color: 'var(--text)' }}>{doc.document_number}</div>
            <div style={{ color: 'var(--text-secondary)', marginTop: '4px' }}>{doc.customer_name} · {doc.date?.split('T')[0]}</div>
          </div>
          <span style={{ padding: '6px 14px', borderRadius: '20px', fontSize: '13px', fontWeight: '700', background: statusInfo.bg, color: statusInfo.color }}>{statusInfo.label}</span>
        </div>
        <div style={{ marginTop: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
          <div style={{ textAlign: 'center', padding: '12px', background: 'var(--surface-2)', borderRadius: 'var(--radius-md)' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Total HT</div>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: 'var(--text)' }}>{doc.total_excl_tax?.toFixed(2)} MAD</div>
          </div>
          <div style={{ textAlign: 'center', padding: '12px', background: 'var(--success-soft)', borderRadius: 'var(--radius-md)' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Payé</div>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: 'var(--success)' }}>{(doc.amount_paid ?? 0).toFixed(2)} MAD</div>
          </div>
          <div style={{ textAlign: 'center', padding: '12px', background: remaining > 0 ? 'var(--danger-soft)' : 'var(--success-soft)', borderRadius: 'var(--radius-md)' }}>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Reste dû</div>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: remaining > 0 ? 'var(--danger)' : 'var(--success)' }}>{remaining.toFixed(2)} MAD</div>
          </div>
        </div>
      </div>

      {/* Lignes produits */}
      {(doc.items ?? []).length > 0 && (
        <div className="card card-body">
          <h3 style={{ marginTop: 0 }}>Produits</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ background: 'var(--surface-2)' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Produit</th>
                <th style={{ padding: '8px', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>Qté</th>
                <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid var(--border)' }}>P.U.</th>
                <th style={{ padding: '8px', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>Rem%</th>
                <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid var(--border)' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {(doc.items ?? []).map(item => (
                <tr key={item.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 10px' }}><strong>{item.product_ref}</strong> {item.product_name}</td>
                  <td style={{ padding: '8px', textAlign: 'center' }}>{item.quantity}</td>
                  <td style={{ padding: '8px', textAlign: 'right' }}>{item.unit_price.toFixed(2)}</td>
                  <td style={{ padding: '8px', textAlign: 'center' }}>{item.discount}%</td>
                  <td style={{ padding: '8px', textAlign: 'right', fontWeight: '600' }}>{item.total.toFixed(2)} MAD</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Paiement (uniquement si document pas encore payé) */}
      {doc.status !== 'PAID' && doc.status !== 'CANCELLED' && doc.type !== 'CREDIT_NOTE' && (
        <div className="card card-body">
          <h3 style={{ marginTop: 0 }}>Encaisser un paiement</h3>
          <div style={{ display: 'flex', gap: '12px' }}>
            <input type="number" placeholder={`Max : ${remaining.toFixed(2)} MAD`} value={payAmount || ''}
              onChange={e => setPayAmount(Number(e.target.value))}
              className="input" />
            <select value={payMethod} onChange={e => setPayMethod(e.target.value)}
              className="select">
              <option value="CASH">💵 Espèces</option>
              <option value="CHECK">🏦 Chèque</option>
              <option value="TRANSFER">📤 Virement</option>
            </select>
            <button onClick={() => { if (payAmount > 0) { onPayment(payAmount, payMethod); setPayAmount(0); } }}
              className="btn btn-success">
              ✓ Encaisser
            </button>
          </div>
        </div>
      )}

      {/* Boutons d'action */}
      <div style={{ display: 'flex', gap: '12px' }}>
        <button onClick={onPrint}
          className="btn btn-secondary" style={{ flex: 1 }}>
          🖨️ Imprimer / Export PDF
        </button>
        {doc.type === 'DELIVERY_NOTE' && onConvert && (
          <button onClick={onConvert}
            className="btn btn-primary" style={{ flex: 1 }}>
            📄 Convertir en Facture
          </button>
        )}
        {doc.type === 'INVOICE' && doc.status !== 'CANCELLED' && onCreditNote && (
          <button onClick={onCreditNote}
            className="btn btn-danger" style={{ flex: 1 }}>
            ↩️ Créer un Avoir
          </button>
        )}
      </div>
    </div>
  );
};

// ─── Page Principale ──────────────────────────────────────────────────────────

export const InvoicePage: React.FC<{ initialType?: DocumentType }> = ({ initialType }) => {
  const { documents, selectedDocument, activeType, searchQuery, isLoading, setActiveType, setSearchQuery, loadDocuments, loadMoreDocuments, selectDocument, createDocument, addPayment, convertBL } = useDocumentStore();
  const [showNewForm, setShowNewForm] = useState(false);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const documentListRef = useRef<HTMLDivElement>(null);
  const documentVirtualizer = useVirtualizer({ count: documents.length, getScrollElement: () => documentListRef.current, estimateSize: () => 94, overscan: 8 });

  useEffect(() => {
    if (initialType) setActiveType(initialType);
  }, []);

  useEffect(() => { loadDocuments(); }, []);

  const handleCreate = async (data: any) => {
    try {
      await createDocument(data);
      setShowNewForm(false);
      toast.success('Document créé avec succès.');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handlePayment = async (amount: number, method: string) => {
    if (!selectedDocument) return;
    try {
      await addPayment(selectedDocument.id, amount, method as any);
      toast.success(`Paiement de ${amount.toFixed(2)} MAD encaissé.`);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleConvert = async () => {
    if (!selectedDocument) return;
    try {
      await convertBL(selectedDocument.id);
      toast.success('Bon de livraison converti en facture avec succès.');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handlePrint = async () => {
    if (!selectedDocument) return;
    try {
      const result = await window.api.documents.exportPdf(selectedDocument.id);
      if (!result.success) throw new Error(result.error);
      toast.success('PDF exporté avec succès.');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleCreditNoteClick = () => {
    setShowReturnModal(true);
  };

  const handleReturnConfirm = async (returnItems: Array<{ product_id: string; quantity: number }>, reason: string) => {
    if (!selectedDocument) return;
    try {
      const result = await window.api.documents.createCreditNote(selectedDocument.id, returnItems, reason);
      if (!result.success) throw new Error(result.error);
      toast.success(`Avoir ${result.data.document_number} créé avec succès.`);
      setShowReturnModal(false);
      await loadDocuments();
      // Sélectionner le nouvel avoir
      if (result.data?.id) {
        await selectDocument(result.data);
        setActiveType('CREDIT_NOTE');
      }
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="page-shell" style={{ height: '100vh' }}>
      {/* Header */}
      <div style={{ padding: '20px 28px 16px', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
          <h1 style={{ margin: 0, fontSize: '26px', color: 'var(--text)', flex: 1 }}>📄 Facturation</h1>
          <button onClick={() => setShowNewForm(true)} className="btn btn-primary">
            + Nouveau {TYPE_LABELS[activeType].label}
          </button>
        </div>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: '4px' }}>
          {(Object.entries(TYPE_LABELS) as [DocumentType, any][]).map(([type, { label, icon }]) => (
            <button key={type} onClick={() => setActiveType(type)}
              className={`btn ${activeType === type ? 'btn-primary' : 'btn-secondary'}`}>
              {icon} {label}
            </button>
          ))}
        </div>
      </div>

      {/* Barre de recherche */}
      <div style={{ padding: '12px 28px', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        <input type="text" placeholder={`Rechercher dans les ${TYPE_LABELS[activeType].label}...`}
          value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
          className="input" />
      </div>

      {/* Contenu */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Liste documents */}
        <div ref={documentListRef} onScroll={(event) => {
          const el = event.currentTarget;
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 240) loadMoreDocuments();
        }} style={{ width: '360px', borderRight: '1px solid var(--border)', overflowY: 'auto', background: 'var(--surface)', flexShrink: 0 }}>
          {isLoading && <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>Chargement...</div>}
          {documents.length === 0 && !isLoading && (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)' }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>{TYPE_LABELS[activeType].icon}</div>
              <div>Aucun {TYPE_LABELS[activeType].label} trouvé.</div>
            </div>
          )}
          <div style={{ height: `${documentVirtualizer.getTotalSize()}px`, position: 'relative' }}>
          {documentVirtualizer.getVirtualItems().map(virtualRow => { const doc = documents[virtualRow.index];
            const statusInfo = STATUS_LABELS[doc.status] || STATUS_LABELS.DRAFT;
            const isSelected = selectedDocument?.id === doc.id;
            return (
              <div key={doc.id} onClick={() => selectDocument(doc)}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)`, padding: '14px 20px', boxSizing: 'border-box', cursor: 'pointer', borderBottom: '1px solid var(--border)', background: isSelected ? 'var(--info-soft)' : 'transparent', borderLeft: isSelected ? `4px solid ${TYPE_LABELS[activeType].color}` : '4px solid transparent', transition: 'all 0.15s' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <span style={{ fontWeight: '700', fontSize: '15px', color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: '1 1 auto', minWidth: 0 }}>{doc.document_number}</span>
                  <span style={{ padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: '700', background: statusInfo.bg, color: statusInfo.color }}>{statusInfo.label}</span>
                </div>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{doc.customer_name}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
                  <span style={{ fontSize: '13px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{doc.date?.split('T')[0]}</span>
                  <span style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{doc.total_incl_tax?.toFixed(2)} MAD</span>
                </div>
              </div>
            );
          })}</div>
        </div>

        {/* Détail */}
        <div style={{ flex: 1, padding: '24px', overflowY: 'auto' }}>
          {!selectedDocument ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--muted)', fontSize: '18px', flexDirection: 'column', gap: '12px' }}>
              <span style={{ fontSize: '64px' }}>{TYPE_LABELS[activeType].icon}</span>
              ← Sélectionnez un document pour voir les détails
            </div>
          ) : (
            <DocumentDetailPanel
              doc={selectedDocument}
              onPayment={handlePayment}
              onConvert={selectedDocument.type === 'DELIVERY_NOTE' ? handleConvert : undefined}
              onPrint={handlePrint}
              onCreditNote={selectedDocument.type === 'INVOICE' ? handleCreditNoteClick : undefined}
            />
          )}
        </div>
      </div>

      {showNewForm && (
        <NewDocumentModal type={activeType} onClose={() => setShowNewForm(false)} onSave={handleCreate} />
      )}

      {showReturnModal && selectedDocument && (
        <PartialReturnModal
          doc={selectedDocument}
          onClose={() => setShowReturnModal(false)}
          onConfirm={handleReturnConfirm}
        />
      )}
    </div>
  );
};
