import React, { useEffect, useState } from 'react';
import { useDocumentStore } from '../stores/useDocumentStore';
import { useProductStore } from '../stores/useProductStore';
import { useClientStore } from '../stores/useClientStore';
import type { Document, DocumentType } from '../repositories/DocumentRepository';

// ─── Constantes ──────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<DocumentType, { label: string; icon: string; color: string }> = {
  QUOTE:         { label: 'Devis',          icon: '📋', color: '#8b5cf6' },
  DELIVERY_NOTE: { label: 'Bon de livraison', icon: '🚚', color: '#f59e0b' },
  INVOICE:       { label: 'Factures',       icon: '📄', color: '#3b82f6' },
  CREDIT_NOTE:   { label: 'Avoirs',         icon: '↩️', color: '#10b981' },
};

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  PAID:      { label: 'Payée',      color: '#065f46', bg: '#d1fae5' },
  UNPAID:    { label: 'Impayée',    color: '#991b1b', bg: '#fee2e2' },
  PARTIAL:   { label: 'Partielle',  color: '#92400e', bg: '#fef3c7' },
  DRAFT:     { label: 'Brouillon',  color: '#374151', bg: '#f3f4f6' },
  CANCELLED: { label: 'Annulée',    color: '#6b7280', bg: '#f3f4f6' },
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

  const handleSave = () => {
    onSave({ type, entity_id: entityId, date, due_date: dueDate || undefined, notes, items: items.map(({ _name, ...rest }) => rest) });
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: 'white', borderRadius: '16px', width: '800px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 25px 50px rgba(0,0,0,0.4)', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ padding: '24px 28px 20px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '24px' }}>{TYPE_LABELS[type].icon}</span>
          <h2 style={{ margin: 0, color: '#0f172a' }}>Nouveau {TYPE_LABELS[type].label}</h2>
        </div>

        <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Informations générales */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '14px', color: '#374151' }}>Client *</label>
              <select value={entityId} onChange={e => setEntityId(e.target.value)}
                style={{ width: '100%', padding: '12px', fontSize: '15px', border: '2px solid #e5e7eb', borderRadius: '8px' }}>
                <option value="">— Sélectionnez un client —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '14px', color: '#374151' }}>Date *</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                style={{ width: '100%', padding: '12px', fontSize: '15px', border: '2px solid #e5e7eb', borderRadius: '8px', boxSizing: 'border-box' }} />
            </div>
            {type === 'INVOICE' && (
              <div>
                <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '14px', color: '#374151' }}>Échéance</label>
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                  style={{ width: '100%', padding: '12px', fontSize: '15px', border: '2px solid #e5e7eb', borderRadius: '8px', boxSizing: 'border-box' }} />
              </div>
            )}
            <div style={{ gridColumn: type === 'INVOICE' ? '2 / 3' : '1 / 3' }}>
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
                    <span style={{ color: '#6b7280' }}>{p.selling_price?.toFixed(2)} MAD</span>
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
                    <th style={{ padding: '10px', width: '80px', borderBottom: '2px solid #e5e7eb', textAlign: 'center' }}>Qté</th>
                    <th style={{ padding: '10px', width: '110px', borderBottom: '2px solid #e5e7eb', textAlign: 'right' }}>P.U. (MAD)</th>
                    <th style={{ padding: '10px', width: '80px', borderBottom: '2px solid #e5e7eb', textAlign: 'center' }}>Rem%</th>
                    <th style={{ padding: '10px', width: '110px', borderBottom: '2px solid #e5e7eb', textAlign: 'right' }}>Total</th>
                    <th style={{ padding: '10px', width: '40px', borderBottom: '2px solid #e5e7eb' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => {
                    const lineTotal = item.quantity * item.unit_price * (1 - item.discount / 100);
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
                        <td style={{ padding: '4px 8px' }}>
                          <input type="number" min="0" max="100" value={item.discount} onChange={e => updateLine(idx, 'discount', Number(e.target.value))}
                            style={{ width: '100%', padding: '6px', textAlign: 'center', border: '1px solid #d1d5db', borderRadius: '6px' }} />
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
                    <td colSpan={4} style={{ padding: '12px 10px', textAlign: 'right', fontSize: '16px' }}>TOTAL HT :</td>
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
          <button onClick={handleSave} disabled={!entityId || items.length === 0}
            style={{ padding: '12px 28px', background: !entityId || items.length === 0 ? '#9ca3af' : TYPE_LABELS[type].color, color: 'white', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: 'bold', cursor: !entityId || items.length === 0 ? 'not-allowed' : 'pointer' }}>
            Enregistrer {TYPE_LABELS[type].label}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Détail d'un document ─────────────────────────────────────────────────────

const DocumentDetailPanel: React.FC<{ doc: Document; onPayment: (amount: number, method: string) => void; onConvert?: () => void; onPrint: () => void; onCreditNote?: () => void }> = ({ doc, onPayment, onConvert, onPrint, onCreditNote }) => {
  const [payAmount, setPayAmount] = useState(0);
  const [payMethod, setPayMethod] = useState('CASH');
  const remaining = doc.total_incl_tax - (doc.amount_paid ?? 0);
  const statusInfo = STATUS_LABELS[doc.status] || STATUS_LABELS.DRAFT;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Résumé */}
      <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '22px', fontWeight: 'bold', color: '#0f172a' }}>{doc.document_number}</div>
            <div style={{ color: '#6b7280', marginTop: '4px' }}>{doc.customer_name} · {doc.date?.split('T')[0]}</div>
          </div>
          <span style={{ padding: '6px 14px', borderRadius: '20px', fontSize: '13px', fontWeight: '700', background: statusInfo.bg, color: statusInfo.color }}>{statusInfo.label}</span>
        </div>
        <div style={{ marginTop: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
          <div style={{ textAlign: 'center', padding: '12px', background: '#f8fafc', borderRadius: '8px' }}>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>Total HT</div>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#0f172a' }}>{doc.total_excl_tax?.toFixed(2)} MAD</div>
          </div>
          <div style={{ textAlign: 'center', padding: '12px', background: '#f0fdf4', borderRadius: '8px' }}>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>Payé</div>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#10b981' }}>{(doc.amount_paid ?? 0).toFixed(2)} MAD</div>
          </div>
          <div style={{ textAlign: 'center', padding: '12px', background: remaining > 0 ? '#fef2f2' : '#f0fdf4', borderRadius: '8px' }}>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>Reste dû</div>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: remaining > 0 ? '#ef4444' : '#10b981' }}>{remaining.toFixed(2)} MAD</div>
          </div>
        </div>
      </div>

      {/* Lignes produits */}
      {(doc.items ?? []).length > 0 && (
        <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h3 style={{ marginTop: 0 }}>Produits</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Produit</th>
                <th style={{ padding: '8px', textAlign: 'center', borderBottom: '1px solid #e5e7eb' }}>Qté</th>
                <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>P.U.</th>
                <th style={{ padding: '8px', textAlign: 'center', borderBottom: '1px solid #e5e7eb' }}>Rem%</th>
                <th style={{ padding: '8px', textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {(doc.items ?? []).map(item => (
                <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
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
      {doc.status !== 'PAID' && doc.status !== 'CANCELLED' && (
        <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h3 style={{ marginTop: 0 }}>Encaisser un paiement</h3>
          <div style={{ display: 'flex', gap: '12px' }}>
            <input type="number" placeholder={`Max : ${remaining.toFixed(2)} MAD`} value={payAmount || ''}
              onChange={e => setPayAmount(Number(e.target.value))}
              style={{ flex: 1, padding: '12px', fontSize: '16px', border: '2px solid #e5e7eb', borderRadius: '8px' }} />
            <select value={payMethod} onChange={e => setPayMethod(e.target.value)}
              style={{ padding: '12px', fontSize: '15px', border: '2px solid #e5e7eb', borderRadius: '8px' }}>
              <option value="CASH">💵 Espèces</option>
              <option value="CHECK">🏦 Chèque</option>
              <option value="TRANSFER">📤 Virement</option>
            </select>
            <button onClick={() => { if (payAmount > 0) { onPayment(payAmount, payMethod); setPayAmount(0); } }}
              style={{ padding: '12px 20px', background: '#10b981', color: 'white', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: 'bold', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              ✓ Encaisser
            </button>
          </div>
        </div>
      )}

      {/* Boutons d'action */}
      <div style={{ display: 'flex', gap: '12px' }}>
        <button onClick={onPrint}
          style={{ flex: 1, padding: '14px', background: '#0f172a', color: 'white', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: 'bold', cursor: 'pointer' }}>
          🖨️ Imprimer / Export PDF
        </button>
        {doc.type === 'DELIVERY_NOTE' && onConvert && (
          <button onClick={onConvert}
            style={{ flex: 1, padding: '14px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: 'bold', cursor: 'pointer' }}>
            📄 Convertir en Facture
          </button>
        )}
        {doc.type === 'INVOICE' && doc.status !== 'CANCELLED' && onCreditNote && (
          <button onClick={onCreditNote}
            style={{ flex: 1, padding: '14px', background: '#dc2626', color: 'white', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: 'bold', cursor: 'pointer' }}>
            ↩️ Créer un Avoir
          </button>
        )}
      </div>
    </div>
  );
};

// ─── Page Principale ──────────────────────────────────────────────────────────

export const InvoicePage: React.FC = () => {
  const { documents, selectedDocument, activeType, searchQuery, isLoading, setActiveType, setSearchQuery, loadDocuments, selectDocument, createDocument, addPayment, convertBL } = useDocumentStore();
  const [showNewForm, setShowNewForm] = useState(false);

  useEffect(() => { loadDocuments(); }, []);

  const handleCreate = async (data: any) => {
    try {
      await createDocument(data);
      setShowNewForm(false);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handlePayment = async (amount: number, method: string) => {
    if (!selectedDocument) return;
    try {
      await addPayment(selectedDocument.id, amount, method as any);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleConvert = async () => {
    if (!selectedDocument) return;
    try {
      await convertBL(selectedDocument.id);
      alert('Bon de livraison converti en facture avec succès !');
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handlePrint = async () => {
    if (!selectedDocument) return;
    try {
      const result = await window.api.documents.exportPdf(selectedDocument.id);
      if (!result.success) throw new Error(result.error);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleCreditNote = async () => {
    if (!selectedDocument) return;
    const reason = prompt('Motif de l\'avoir (retour, annulation...) :', 'Retour marchandise') ?? 'Retour marchandise';
    if (reason === null) return;
    if (!confirm(`Créer un avoir pour ${selectedDocument.document_number} ? La facture sera annulée.`)) return;
    try {
      const result = await window.api.documents.createCreditNote(selectedDocument.id, reason);
      if (!result.success) throw new Error(result.error);
      alert(`Avoir ${result.data.document_number} créé avec succès !`);
      loadDocuments();
    } catch (e: any) {
      alert(e.message);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#f8fafc', height: '100vh', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '20px 28px 16px', background: 'white', borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
          <h1 style={{ margin: 0, fontSize: '26px', color: '#0f172a', flex: 1 }}>📄 Facturation</h1>
          <button onClick={() => setShowNewForm(true)}
            style={{ padding: '10px 22px', background: TYPE_LABELS[activeType].color, color: 'white', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: 'bold', cursor: 'pointer' }}>
            + Nouveau {TYPE_LABELS[activeType].label}
          </button>
        </div>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: '4px' }}>
          {(Object.entries(TYPE_LABELS) as [DocumentType, any][]).map(([type, { label, icon }]) => (
            <button key={type} onClick={() => setActiveType(type)}
              style={{ padding: '8px 18px', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: '600', background: activeType === type ? TYPE_LABELS[type].color : '#f3f4f6', color: activeType === type ? 'white' : '#6b7280', transition: 'all 0.15s' }}>
              {icon} {label}
            </button>
          ))}
        </div>
      </div>

      {/* Barre de recherche */}
      <div style={{ padding: '12px 28px', background: 'white', borderBottom: '1px solid #e5e7eb' }}>
        <input type="text" placeholder={`Rechercher dans les ${TYPE_LABELS[activeType].label}...`}
          value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
          style={{ width: '100%', padding: '12px 16px', fontSize: '16px', border: '2px solid #e5e7eb', borderRadius: '8px', boxSizing: 'border-box', outline: 'none' }} />
      </div>

      {/* Contenu */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Liste documents */}
        <div style={{ width: '360px', borderRight: '1px solid #e5e7eb', overflowY: 'auto', background: 'white', flexShrink: 0 }}>
          {isLoading && <div style={{ padding: '20px', textAlign: 'center', color: '#6b7280' }}>Chargement...</div>}
          {documents.length === 0 && !isLoading && (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: '#9ca3af' }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>{TYPE_LABELS[activeType].icon}</div>
              <div>Aucun {TYPE_LABELS[activeType].label} trouvé.</div>
            </div>
          )}
          {documents.map(doc => {
            const statusInfo = STATUS_LABELS[doc.status] || STATUS_LABELS.DRAFT;
            const isSelected = selectedDocument?.id === doc.id;
            return (
              <div key={doc.id} onClick={() => selectDocument(doc)}
                style={{ padding: '14px 20px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', background: isSelected ? '#eff6ff' : 'transparent', borderLeft: isSelected ? `4px solid ${TYPE_LABELS[activeType].color}` : '4px solid transparent', transition: 'all 0.15s' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <span style={{ fontWeight: '700', fontSize: '15px', color: '#0f172a' }}>{doc.document_number}</span>
                  <span style={{ padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: '700', background: statusInfo.bg, color: statusInfo.color }}>{statusInfo.label}</span>
                </div>
                <div style={{ fontSize: '13px', color: '#374151', marginTop: '4px' }}>{doc.customer_name}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
                  <span style={{ fontSize: '13px', color: '#9ca3af' }}>{doc.date?.split('T')[0]}</span>
                  <span style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>{doc.total_incl_tax?.toFixed(2)} MAD</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Détail */}
        <div style={{ flex: 1, padding: '24px', overflowY: 'auto' }}>
          {!selectedDocument ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#9ca3af', fontSize: '18px', flexDirection: 'column', gap: '12px' }}>
              <span style={{ fontSize: '64px' }}>{TYPE_LABELS[activeType].icon}</span>
              ← Sélectionnez un document pour voir les détails
            </div>
          ) : (
            <DocumentDetailPanel
              doc={selectedDocument}
              onPayment={handlePayment}
              onConvert={selectedDocument.type === 'DELIVERY_NOTE' ? handleConvert : undefined}
              onPrint={handlePrint}
              onCreditNote={selectedDocument.type === 'INVOICE' ? handleCreditNote : undefined}
            />
          )}
        </div>
      </div>

      {showNewForm && (
        <NewDocumentModal type={activeType} onClose={() => setShowNewForm(false)} onSave={handleCreate} />
      )}
    </div>
  );
};
