import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useClientStore } from '../stores/useClientStore';
import { toast } from '../stores/useToastStore';
import type { Product } from '../repositories/ProductRepository';
import { Button, Input, Modal, ModalBody, ModalFooter, ModalHeader, PageHeader } from '../components/ui';
import { stockLevelClass } from '../components/ui/statusMaps';

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

export const POSPage: React.FC = () => {
  const clients = useClientStore((state) => state.clients);
  const loadClients = useClientStore((state) => state.loadClients);
  const [products, setProducts] = useState<Product[]>([]);
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
    loadClients();
    barcodeRef.current?.focus();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.api.products.search(productSearch)
        .then((results: Product[]) => setProducts(results))
        .catch(() => setProducts([]));
    }, 150);
    return () => window.clearTimeout(timer);
  }, [productSearch]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!showPayment && !showReceipt && e.key !== 'Tab' && e.key !== 'F2' && e.key !== 'Escape') {
        barcodeRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showPayment, showReceipt]);

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

  const subtotal = cart.reduce((sum, it) => sum + it.quantity * it.unit_price * (1 - it.discount / 100), 0);
  const change = paymentMethod === 'CASH' ? Math.max(0, cashGiven - subtotal) : 0;
  const canValidate = cart.length > 0;
  const filteredProducts = products.filter((product) => product.status === 'ACTIVE');

  const handleBarcodeSubmit = async () => {
    const code = barcodeInput.trim();
    if (!code) return;

    try {
      const byBarcode = await window.api.products.getByBarcode(code);
      if (byBarcode) {
        addToCart(byBarcode);
        setBarcodeInput('');
        return;
      }
      const byReference = await window.api.products.getByReference(code);
      if (byReference) {
        addToCart(byReference);
        setBarcodeInput('');
        return;
      }
      setProductSearch(code);
      setBarcodeInput('');
    } catch {
      toast.error('La recherche du produit a échoué. Réessayez.');
    }
  };

  const handleValidateSale = async () => {
    if (cart.length === 0) return;

    try {
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

  const paymentDisabled = paymentMethod === 'CASH' && cashGiven < subtotal;

  return (
    <div className="page-shell">
      <PageHeader
        icon="🛒"
        title="Point de Vente"
        actions={
          <>
            <select
              className="input"
              style={{ width: 240 }}
              value={selectedClientId}
              onChange={e => setSelectedClientId(e.target.value)}
            >
              <option value="">Client comptoir</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <Button variant="danger" size="sm" onClick={clearCart}>🗑️ Vider</Button>
          </>
        }
      />

      <div className="flex flex-1 pos-main" style={{ overflow: 'hidden' }}>
        <div className="pos-column">
          <div style={{ padding: 'var(--space-4) var(--space-5)', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
            <div className="flex gap-3">
              <input
                ref={barcodeRef}
                type="text"
                className="input input-lg flex-1"
                value={barcodeInput}
                onChange={e => setBarcodeInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleBarcodeSubmit(); }}
                placeholder="📷 Scanner le code-barres ou taper la référence..."
                autoFocus
                style={{ borderColor: 'var(--primary)' }}
              />
              <Button variant="primary" size="lg" onClick={handleBarcodeSubmit}>Ajouter</Button>
            </div>
          </div>

          <div className="flex-1" style={{ overflowY: 'auto', overflowX: 'hidden', padding: 'var(--space-4) var(--space-5)' }}>
            {cart.length === 0 ? (
              <div className="state-box" style={{ height: '100%' }}>
                <div className="state-icon">🛒</div>
                <div className="state-title">Le panier est vide</div>
                <div className="state-text">Scannez un produit ou recherchez-le ci-contre</div>
              </div>
            ) : (
              <div className="flex gap-2" style={{ flexDirection: 'column' }}>
                {cart.map(item => (
                  <div key={item.product_id} className="pos-cart-item">
                    <div className="flex-1 item-info">
                      <div className="font-semibold">{item.reference}</div>
                      <div className="text-sm text-muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.designation}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="secondary" icon onClick={() => updateCartQuantity(item.product_id, item.quantity - 1)}>−</Button>
                      <input
                        type="number"
                        min={1}
                        max={item.current_stock}
                        value={item.quantity}
                        onChange={e => updateCartQuantity(item.product_id, Number(e.target.value))}
                        className="input input-sm qty"
                        style={{ width: 60, textAlign: 'center', fontWeight: 700 }}
                      />
                      <Button variant="secondary" icon onClick={() => updateCartQuantity(item.product_id, item.quantity + 1)}>+</Button>
                    </div>
                    <div style={{ width: 90 }}>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={item.unit_price}
                        onChange={e => updateCartPrice(item.product_id, Number(e.target.value))}
                        className="input input-sm money text-right"
                      />
                    </div>
                    <div style={{ width: 60 }}>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={item.discount}
                        onChange={e => updateCartDiscount(item.product_id, Number(e.target.value))}
                        className="input input-sm text-center"
                      />
                    </div>
                    <div className="money text-right font-semibold" style={{ width: 110 }}>
                      {(item.quantity * item.unit_price * (1 - item.discount / 100)).toFixed(2)} MAD
                    </div>
                    <Button variant="ghost" onClick={() => removeFromCart(item.product_id)} style={{ color: 'var(--danger)', fontSize: 20, padding: 4 }}>×</Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {cart.length > 0 && (
            <div className="pos-total-bar">
              <div className="text-sm text-muted">
                {cart.length} article(s)
                <span style={{ margin: '0 var(--space-3)', color: 'var(--border-strong)' }}>|</span>
                {cart.reduce((s, c) => s + c.quantity, 0)} unité(s)
              </div>
              <div className="flex items-center" style={{ gap: 'var(--space-5)' }}>
                <div className="text-right">
                  <div className="text-xs text-muted">TOTAL</div>
                  <div className="pos-total-amount money">{subtotal.toFixed(2)} <span style={{ fontSize: 18 }}>MAD</span></div>
                </div>
                <Button variant="success" size="lg" onClick={() => setShowPayment(true)} disabled={!canValidate}>
                  💳 Encaisser
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="pos-sidebar">
          <div style={{ padding: '14px var(--space-4)', borderBottom: '1px solid var(--border)' }}>
            <input
              type="text"
              className="input w-full"
              value={productSearch}
              onChange={e => setProductSearch(e.target.value)}
              placeholder="🔍 Rechercher un produit..."
            />
          </div>
          <div className="flex-1" style={{ overflowY: 'auto', padding: 'var(--space-2)' }}>
            {filteredProducts.slice(0, 50).map(p => {
              const stock = p.current_stock ?? 0;
              return (
                <div key={p.id} className="list-item" onClick={() => addToCart(p)}>
                  <div className="flex justify-between items-start">
                    <div className="flex-1" style={{ minWidth: 0 }}>
                      <div className="font-semibold text-sm" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.designation}</div>
                      <div className="text-xs text-muted">{p.reference}</div>
                    </div>
                    <div className="text-right" style={{ flexShrink: 0, marginLeft: 'var(--space-2)' }}>
                      <div className="money font-semibold text-sm text-success">{p.selling_price?.toFixed(2)} MAD</div>
                      <div className={`text-xs qty ${stockLevelClass(stock, p.min_stock ?? 0)}`}>Stock: {stock}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <Modal open={showPayment} onClose={() => { setShowPayment(false); setCashGiven(0); }} width={480}>
        <ModalHeader icon="💳" title="Encaissement" />
        <ModalBody>
          <div className="text-center mb-4">
            <div className="text-sm text-muted">Total à payer</div>
            <div className="money" style={{ fontSize: 42, fontWeight: 800 }}>{subtotal.toFixed(2)} MAD</div>
          </div>

          <div className="grid-3">
            {([['CASH', '💵 Espèces'], ['CHECK', '🏦 Chèque'], ['TRANSFER', '📤 Virement']] as const).map(([method, label]) => (
              <button
                key={method}
                type="button"
                className={`btn ${paymentMethod === method ? 'btn-success' : 'btn-secondary'}`}
                onClick={() => setPaymentMethod(method)}
              >
                {label}
              </button>
            ))}
          </div>

          {paymentMethod === 'CASH' && (
            <Input
              label="Montant reçu"
              type="number"
              min={0}
              step={0.01}
              value={cashGiven || ''}
              onChange={e => setCashGiven(Number(e.target.value))}
              placeholder={`Minimum : ${subtotal.toFixed(2)} MAD`}
              inputSize="lg"
              className="money"
              autoFocus
            />
          )}
          {paymentMethod === 'CASH' && cashGiven >= subtotal && (
            <div className="surface-success text-center" style={{ padding: 'var(--space-3)' }}>
              <span className="text-sm text-success font-semibold">
                💰 Monnaie : <strong className="money">{change.toFixed(2)} MAD</strong>
              </span>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => { setShowPayment(false); setCashGiven(0); }}>Annuler</Button>
          <Button variant="success" size="lg" onClick={handleValidateSale} disabled={paymentDisabled}>
            ✓ Valider la vente
          </Button>
        </ModalFooter>
      </Modal>

      <Modal open={showReceipt && !!lastSale} onClose={() => { setShowReceipt(false); setLastSale(null); barcodeRef.current?.focus(); }} width={400}>
        <ModalBody className="text-center">
          <div style={{ fontSize: 48, marginBottom: 'var(--space-3)' }}>✅</div>
          <h2 className="text-success" style={{ margin: '0 0 var(--space-2)' }}>Vente enregistrée !</h2>
          {lastSale && (
            <>
              <div className="text-sm text-muted mb-4">{lastSale.docNumber}</div>
              <div className="money mb-5" style={{ fontSize: 36, fontWeight: 800 }}>{lastSale.total.toFixed(2)} MAD</div>
              <div className="surface-muted text-left mb-5" style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>
                {lastSale.items.map((it, i) => (
                  <div key={i} className="flex justify-between" style={{ padding: '4px 0', borderBottom: '1px dashed var(--border)' }}>
                    <span>{it.quantity}× {it.reference}</span>
                    <span className="money">{(it.quantity * it.unit_price * (1 - it.discount / 100)).toFixed(2)}</span>
                  </div>
                ))}
                <div className="flex justify-between font-semibold money" style={{ marginTop: 'var(--space-2)', paddingTop: 'var(--space-2)', borderTop: '2px solid var(--text)' }}>
                  <span>TOTAL</span>
                  <span>{lastSale.total.toFixed(2)} MAD</span>
                </div>
              </div>
            </>
          )}
          <Button variant="primary" block size="lg" onClick={() => { setShowReceipt(false); setLastSale(null); barcodeRef.current?.focus(); }}>
            Nouvelle vente
          </Button>
        </ModalBody>
      </Modal>
    </div>
  );
};
