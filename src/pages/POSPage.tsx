import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useProductStore } from '../stores/useProductStore';
import { useClientStore } from '../stores/useClientStore';
import { toast } from '../stores/useToastStore';
import type { Product } from '../repositories/ProductRepository';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CartItem {
  product_id: string;
  reference: string;
  designation: string;
  quantity: number;
  unit_price: number;
  discount: number;
  current_stock: number;
}

type PaymentMethod = 'CASH' | 'CHECK' | 'TRANSFER';

// ─── Page Point de Vente ──────────────────────────────────────────────────────

export const POSPage: React.FC = () => {
  const { products, loadProducts } = useProductStore();
  const { clients, loadClients } = useClientStore();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [showPayment, setShowPayment] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [cashGiven, setCashGiven] = useState<number>(0);
  const [showReceipt, setShowReceipt] = useState(false);
  const [lastSale, setLastSale] = useState<{ docNumber: string; total: number; items: CartItem[] } | null>(null);
  const barcodeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadProducts();
    loadClients();
    barcodeRef.current?.focus();
  }, []);

  // Re-focus barcode input on any key press
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!showPayment && !showReceipt && e.key !== 'Tab' && e.key !== 'F2' && e.key !== 'Escape') {
        barcodeRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showPayment, showReceipt]);

  // ─── Cart operations ──────────────────────────────────────────────────────

  const addToCart = useCallback((product: Product) => {
    if (product.status !== 'ACTIVE') {
      toast.error(`Produit "${product.designation}" n'est pas actif.`);
      return;
    }
    const stock = product.current_stock ?? 0;
    if (stock <= 0) {
      toast.warning(`Stock insuffisant pour "${product.designation}" (stock: ${stock}).`);
      return;
    }

    setCart(prev => {
      const existing = prev.find(c => c.product_id === product.id);
      if (existing) {
        if (existing.quantity >= stock) {
          toast.warning(`Stock insuffisant : "${product.designation}" n'a que ${stock} unité(s) disponible(s).`);
          return prev;
        }
        return prev.map(c =>
          c.product_id === product.id ? { ...c, quantity: c.quantity + 1 } : c
        );
      }
      return [...prev, {
        product_id: product.id,
        reference: product.reference,
        designation: product.designation,
        quantity: 1,
        unit_price: product.selling_price,
        discount: 0,
        current_stock: stock,
      }];
    });
  }, []);

  const updateCartQuantity = (productId: string, qty: number) => {
    setCart(prev => prev.map(c => {
      if (c.product_id !== productId) return c;
      const newQty = Math.max(1, Math.min(qty, c.current_stock));
      return { ...c, quantity: newQty };
    }));
  };

  const updateCartDiscount = (productId: string, discount: number) => {
    setCart(prev => prev.map(c =>
      c.product_id === productId ? { ...c, discount: Math.max(0, Math.min(100, discount)) } : c
    ));
  };

  const updateCartPrice = (productId: string, price: number) => {
    setCart(prev => prev.map(c =>
      c.product_id === productId ? { ...c, unit_price: Math.max(0, price) } : c
    ));
  };

  const removeFromCart = (productId: string) => {
    setCart(prev => prev.filter(c => c.product_id !== productId));
  };

  const clearCart = () => {
    setCart([]);
    setSelectedClientId('');
    setCashGiven(0);
  };

  // ─── Totals ───────────────────────────────────────────────────────────────

  const subtotal = cart.reduce((sum, it) => sum + it.quantity * it.unit_price * (1 - it.discount / 100), 0);
  const change = paymentMethod === 'CASH' ? Math.max(0, cashGiven - subtotal) : 0;

  // ─── Barcode handling ──────────────────────────────────────────────────────

  const handleBarcodeSubmit = () => {
    const code = barcodeInput.trim();
    if (!code) return;

    // Try barcode first
    const product = products.find(p => p.barcode === code);
    if (product) {
      addToCart(product);
      setBarcodeInput('');
      return;
    }

    // Try reference
    const byRef = products.find(p => p.reference.toLowerCase() === code.toLowerCase());
    if (byRef) {
      addToCart(byRef);
      setBarcodeInput('');
      return;
    }

    // Not found — switch to text search
    setProductSearch(code);
    setBarcodeInput('');
  };

  // ─── Filtered products for search ──────────────────────────────────────────

  const filteredProducts = products.filter(p =>
    p.status === 'ACTIVE' && (
      productSearch === '' ||
      p.designation.toLowerCase().includes(productSearch.toLowerCase()) ||
      p.reference.toLowerCase().includes(productSearch.toLowerCase()) ||
      (p.barcode && p.barcode.includes(productSearch))
    )
  );

  // ─── Validation & payment ──────────────────────────────────────────────────

  const canValidate = cart.length > 0;

  const handleValidateSale = async () => {
    if (cart.length === 0) return;

    try {
      // Create invoice with stock management
      const result = await window.api.documents.create({
        type: 'INVOICE',
        entity_id: selectedClientId || '',
        date: new Date().toISOString().split('T')[0],
        notes: `Vente caisse — ${paymentMethod}`,
        items: cart.map(c => ({
          product_id: c.product_id,
          quantity: c.quantity,
          unit_price: c.unit_price,
          discount: c.discount,
        })),
      });

      if (!result.success) throw new Error(result.error);

      // Record payment
      if (paymentMethod === 'CASH' && cashGiven >= subtotal) {
        const payResult = await window.api.documents.addPayment({
          document_id: result.data.id,
          amount: subtotal,
          payment_method: paymentMethod,
        });
        if (!payResult.success) throw new Error(payResult.error);
      } else if (paymentMethod !== 'CASH') {
        const payResult = await window.api.documents.addPayment({
          document_id: result.data.id,
          amount: subtotal,
          payment_method: paymentMethod,
        });
        if (!payResult.success) throw new Error(payResult.error);
      }

      setLastSale({
        docNumber: result.data.document_number,
        total: subtotal,
        items: [...cart],
      });
      setShowPayment(false);
      setShowReceipt(true);
      clearCart();
    } catch (e: any) {
      toast.error(`Erreur : ${e.message}`);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: '#f1f5f9' }}>

      {/* Header */}
      <div style={{ padding: '16px 28px', background: '#0f172a', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '24px' }}>🛒</span>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: '700' }}>Point de Vente</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <select value={selectedClientId} onChange={e => setSelectedClientId(e.target.value)}
            style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', fontSize: '14px' }}>
            <option value="">Client comptoir</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button onClick={clearCart}
            style={{ padding: '8px 16px', background: '#dc2626', color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
            🗑️ Vider
          </button>
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Left: Cart */}
        <div style={{ flex: 2, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Barcode input */}
          <div style={{ padding: '16px 24px', background: 'white', borderBottom: '1px solid #e5e7eb' }}>
            <div style={{ display: 'flex', gap: '12px' }}>
              <input ref={barcodeRef} type="text" value={barcodeInput}
                onChange={e => setBarcodeInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleBarcodeSubmit(); }}
                placeholder="📷 Scanner le code-barres ou taper la référence..."
                autoFocus
                style={{ flex: 1, padding: '14px 18px', fontSize: '18px', border: '2px solid #3b82f6', borderRadius: '10px', outline: 'none', boxSizing: 'border-box' }} />
              <button onClick={handleBarcodeSubmit}
                style={{ padding: '14px 24px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '10px', fontSize: '16px', fontWeight: '700', cursor: 'pointer' }}>
                Ajouter
              </button>
            </div>
          </div>

          {/* Cart items */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
            {cart.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#9ca3af', flexDirection: 'column', gap: '12px' }}>
                <span style={{ fontSize: '64px' }}>🛒</span>
                <div style={{ fontSize: '18px' }}>Le panier est vide</div>
                <div style={{ fontSize: '14px' }}>Scannez un produit ou recherchez-le ci-contre</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {cart.map(item => (
                  <div key={item.product_id}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 18px', background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: '700', fontSize: '15px', color: '#0f172a' }}>{item.reference}</div>
                      <div style={{ fontSize: '13px', color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.designation}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button onClick={() => updateCartQuantity(item.product_id, item.quantity - 1)}
                        style={{ width: '32px', height: '32px', borderRadius: '8px', border: '1px solid #d1d5db', background: '#f3f4f6', fontSize: '18px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                      <input type="number" min="1" max={item.current_stock} value={item.quantity}
                        onChange={e => updateCartQuantity(item.product_id, Number(e.target.value))}
                        style={{ width: '60px', padding: '6px', textAlign: 'center', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '15px', fontWeight: '700' }} />
                      <button onClick={() => updateCartQuantity(item.product_id, item.quantity + 1)}
                        style={{ width: '32px', height: '32px', borderRadius: '8px', border: '1px solid #d1d5db', background: '#f3f4f6', fontSize: '18px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                    </div>
                    <div style={{ width: '90px' }}>
                      <input type="number" min="0" step="0.01" value={item.unit_price}
                        onChange={e => updateCartPrice(item.product_id, Number(e.target.value))}
                        style={{ width: '100%', padding: '6px', textAlign: 'right', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px' }} />
                    </div>
                    <div style={{ width: '60px' }}>
                      <input type="number" min="0" max="100" value={item.discount}
                        onChange={e => updateCartDiscount(item.product_id, Number(e.target.value))}
                        style={{ width: '100%', padding: '6px', textAlign: 'center', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px' }} />
                    </div>
                    <div style={{ width: '110px', textAlign: 'right', fontWeight: '700', fontSize: '15px', color: '#0f172a' }}>
                      {(item.quantity * item.unit_price * (1 - item.discount / 100)).toFixed(2)} MAD
                    </div>
                    <button onClick={() => removeFromCart(item.product_id)}
                      style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '20px', cursor: 'pointer', padding: '4px' }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer totals */}
          {cart.length > 0 && (
            <div style={{ padding: '16px 24px', background: 'white', borderTop: '2px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <span style={{ fontSize: '14px', color: '#6b7280' }}>{cart.length} article(s)</span>
                <span style={{ margin: '0 12px', color: '#d1d5db' }}>|</span>
                <span style={{ fontSize: '14px', color: '#6b7280' }}>
                  {cart.reduce((s, c) => s + c.quantity, 0)} unité(s)
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '13px', color: '#6b7280' }}>TOTAL</div>
                  <div style={{ fontSize: '32px', fontWeight: '800', color: '#0f172a' }}>{subtotal.toFixed(2)} <span style={{ fontSize: '18px' }}>MAD</span></div>
                </div>
                <button onClick={() => setShowPayment(true)} disabled={!canValidate}
                  style={{ padding: '16px 36px', background: canValidate ? '#10b981' : '#9ca3af', color: 'white', border: 'none', borderRadius: '12px', fontSize: '18px', fontWeight: '800', cursor: canValidate ? 'pointer' : 'not-allowed' }}>
                  💳 Encaisser
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right: Product search */}
        <div style={{ width: '340px', background: 'white', borderLeft: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid #e5e7eb' }}>
            <input type="text" value={productSearch} onChange={e => setProductSearch(e.target.value)}
              placeholder="🔍 Rechercher un produit..."
              style={{ width: '100%', padding: '12px', fontSize: '15px', border: '2px solid #e5e7eb', borderRadius: '8px', boxSizing: 'border-box', outline: 'none' }} />
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
            {filteredProducts.slice(0, 50).map(p => {
              const stock = p.current_stock ?? 0;
              return (
                <div key={p.id} onClick={() => addToCart(p)}
                  style={{ padding: '12px', cursor: 'pointer', borderRadius: '10px', marginBottom: '4px', border: '1px solid #f1f5f9', transition: 'background 0.1s' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f0f9ff')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: '600', fontSize: '14px', color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.designation}</div>
                      <div style={{ fontSize: '12px', color: '#6b7280' }}>{p.reference}</div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: '8px' }}>
                      <div style={{ fontWeight: '700', fontSize: '14px', color: '#10b981' }}>{p.selling_price?.toFixed(2)} MAD</div>
                      <div style={{ fontSize: '11px', color: stock <= 0 ? '#ef4444' : stock <= (p.min_stock ?? 0) ? '#f59e0b' : '#6b7280' }}>
                        Stock: {stock}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Payment modal */}
      {showPayment && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'white', borderRadius: '20px', width: '480px', padding: '32px', boxShadow: '0 25px 50px rgba(0,0,0,0.4)' }}>
            <h2 style={{ margin: '0 0 24px', fontSize: '22px', color: '#0f172a' }}>💳 Encaissement</h2>

            <div style={{ textAlign: 'center', marginBottom: '24px' }}>
              <div style={{ fontSize: '14px', color: '#6b7280' }}>Total à payer</div>
              <div style={{ fontSize: '42px', fontWeight: '800', color: '#0f172a' }}>{subtotal.toFixed(2)} MAD</div>
            </div>

            {/* Payment method buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '20px' }}>
              {([['CASH', '💵 Espèces'], ['CHECK', '🏦 Chèque'], ['TRANSFER', '📤 Virement']] as const).map(([method, label]) => (
                <button key={method} onClick={() => setPaymentMethod(method)}
                  style={{ padding: '14px', borderRadius: '12px', border: `2px solid ${paymentMethod === method ? '#10b981' : '#e5e7eb'}`, background: paymentMethod === method ? '#f0fdf4' : 'white', fontWeight: '700', fontSize: '14px', cursor: 'pointer', color: paymentMethod === method ? '#065f46' : '#374151' }}>
                  {label}
                </button>
              ))}
            </div>

            {/* Cash input */}
            {paymentMethod === 'CASH' && (
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '14px', color: '#374151' }}>Montant reçu</label>
                <input type="number" min="0" step="0.01" value={cashGiven || ''}
                  onChange={e => setCashGiven(Number(e.target.value))}
                  placeholder={`Minimum : ${subtotal.toFixed(2)} MAD`}
                  autoFocus
                  style={{ width: '100%', padding: '14px', fontSize: '22px', fontWeight: '700', border: '2px solid #e5e7eb', borderRadius: '10px', boxSizing: 'border-box' }} />
                {cashGiven >= subtotal && (
                  <div style={{ marginTop: '8px', padding: '10px', background: '#f0fdf4', borderRadius: '8px', textAlign: 'center' }}>
                    <span style={{ fontSize: '14px', color: '#065f46', fontWeight: '600' }}>
                      💰 Monnaie : <strong>{change.toFixed(2)} MAD</strong>
                    </span>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
              <button onClick={() => { setShowPayment(false); setCashGiven(0); }}
                style={{ flex: 1, padding: '14px', background: '#f3f4f6', border: 'none', borderRadius: '10px', fontSize: '16px', cursor: 'pointer', fontWeight: '600' }}>
                Annuler
              </button>
              <button onClick={handleValidateSale}
                disabled={paymentMethod === 'CASH' && cashGiven < subtotal}
                style={{ flex: 2, padding: '14px', background: (paymentMethod === 'CASH' && cashGiven < subtotal) ? '#9ca3af' : '#10b981', color: 'white', border: 'none', borderRadius: '10px', fontSize: '16px', fontWeight: '800', cursor: (paymentMethod === 'CASH' && cashGiven < subtotal) ? 'not-allowed' : 'pointer' }}>
                ✓ Valider la vente
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receipt modal */}
      {showReceipt && lastSale && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'white', borderRadius: '20px', width: '400px', padding: '32px', boxShadow: '0 25px 50px rgba(0,0,0,0.4)', textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>✅</div>
            <h2 style={{ margin: '0 0 8px', color: '#065f46' }}>Vente enregistrée !</h2>
            <div style={{ fontSize: '15px', color: '#6b7280', marginBottom: '16px' }}>{lastSale.docNumber}</div>
            <div style={{ fontSize: '36px', fontWeight: '800', color: '#0f172a', marginBottom: '24px' }}>{lastSale.total.toFixed(2)} MAD</div>

            {/* Mini receipt */}
            <div style={{ background: '#f8fafc', borderRadius: '12px', padding: '16px', textAlign: 'left', marginBottom: '20px', fontFamily: 'monospace', fontSize: '13px' }}>
              {lastSale.items.map((it, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px dashed #e5e7eb' }}>
                  <span>{it.quantity}× {it.reference}</span>
                  <span>{(it.quantity * it.unit_price * (1 - it.discount / 100)).toFixed(2)}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: '700', fontSize: '15px', marginTop: '8px', paddingTop: '8px', borderTop: '2px solid #0f172a' }}>
                <span>TOTAL</span>
                <span>{lastSale.total.toFixed(2)} MAD</span>
              </div>
            </div>

            <button onClick={() => { setShowReceipt(false); setLastSale(null); barcodeRef.current?.focus(); }}
              style={{ width: '100%', padding: '14px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '10px', fontSize: '16px', fontWeight: '700', cursor: 'pointer' }}>
              Nouvelle vente
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
