import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useClientStore } from '../stores/useClientStore';
import { toast } from '../stores/useToastStore';
import type { Product } from '../repositories/ProductRepository';
import { Button, Modal, ModalBody, ModalFooter, ModalHeader, PageHeader } from '../components/ui';
import { stockLevelClass } from '../components/ui/statusMaps';
import { toLocalDateString } from '../utils/date';
import { resolveDiscount, findApplicableDiscount, describeVolumeDiscount, type VolumeDiscountRule } from '../utils/volumeDiscount';
import { toBaseQuantity, toBaseUnitPrice } from '../utils/unitSale';
import { useHeldCartsStore } from '../stores/useHeldCartsStore';
// §Phase 1 — moteur monétaire central : même calcul que la facture (DocumentRepository).
import { roundMoney, calculateLineAmounts } from '../utils/money';

interface CartItem {
  product_id: string;
  reference: string;
  designation: string;
  quantity: number;
  unit_price: number;
  discount: number;
  current_stock: number;
  vat_rate: number;
  // Phase 4 : true si la remise de la ligne a été saisie manuellement (prioritaire sur la remise quantité).
  discountManual: boolean;
  // Phase 6 : unité de vente alternative (conversion vers l'unité de base pour le stock).
  base_unit: string;
  sale_unit: string;
  unit_factor: number;
  alt_units: { unit: string; factor: number }[];
  // §B3 — origine du prix appliqué (affichée sur la ligne).
  price_source?: string;
  price_reason?: string;
}

type PaymentMethod = 'CASH' | 'CHECK' | 'TRANSFER';

// §B2 — Une ligne de paiement (mode + montant). Plusieurs lignes = encaissement
// réparti (ex. 500 espèces + 700 carte + 300 crédit).
interface PaymentLine {
  method: PaymentMethod;
  amount: number;
  reference: string;
}

// §B4 — fiche vendeur (aucun compte utilisateur).
interface SellerOption {
  id: string;
  name: string;
  commission_rate: number;
  active: number;
}

// Le total TTC affiché/payé au POS est calculé par le MÊME moteur monétaire
// que la facture (money.ts) : le montant affiché = le montant facturé, au centime.
function lineTotalTTC(item: CartItem): number {
  return calculateLineAmounts({
    quantity: item.quantity,
    unitPrice: item.unit_price,
    discountPct: item.discount,
    vatRate: item.vat_rate || 20,
  }).inclTax;
}

export const POSPage: React.FC = () => {
  const clients = useClientStore((state) => state.clients);
  const loadClients = useClientStore((state) => state.loadClients);
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [showPayment, setShowPayment] = useState(false);
  // §B2 — lignes de paiement (défaut : une ligne espèces à 0).
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([{ method: 'CASH', amount: 0, reference: '' }]);
  const [showReceipt, setShowReceipt] = useState(false);
  // §B4 — vendeurs proposés + vendeur sélectionné (fiche, facultatif).
  const [sellers, setSellers] = useState<SellerOption[]>([]);
  const [selectedSellerId, setSelectedSellerId] = useState('');
  // Document imprimé à la validation : ticket de caisse 80 mm (défaut POS) ou facture A4 complète.
  const [printMode, setPrintMode] = useState<'receipt' | 'invoice'>('receipt');
  const [lastSale, setLastSale] = useState<{ docNumber: string; total: number; items: CartItem[] } | null>(null);
  // §Phase 6 — code scanné INTROUVABLE : on propose explicitement de créer le produit.
  const [unknownCode, setUnknownCode] = useState<string | null>(null);
  // Phase 4 : règles de remise par quantité (paliers), chargées une fois.
  const [discountRules, setDiscountRules] = useState<VolumeDiscountRule[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  // §Phase 6 — ventes en attente : store en mémoire, hors arbre React,
  // donc conservé lors de la navigation entre pages.
  const heldCarts = useHeldCartsStore((s) => s.held);
  const holdCart = useHeldCartsStore((s) => s.hold);
  const releaseHeldCart = useHeldCartsStore((s) => s.release);

  useEffect(() => {
    loadClients();
    window.api.discounts.getAll()
      .then((rules: VolumeDiscountRule[]) => setDiscountRules(rules ?? []))
      .catch(() => {});
    // §B4 — vendeurs actifs proposés à la caisse (fiches, facultatif).
    window.api.sellers.getActive()
      .then((rows: SellerOption[]) => setSellers(rows ?? []))
      .catch(() => {});
    searchRef.current?.focus();
  }, []);

  // §B3 — résout le prix d'une ligne (priorité : client > niveau > quantité > standard)
  // via le BACKEND. Aucune règle de prix n'est dupliquée dans le renderer.
  const resolveLinePrice = useCallback(async (productId: string, quantity: number, clientId: string) => {
    try {
      const res = await window.api.pricing.resolve({ productId, customerId: clientId || null, quantity });
      if (res?.success && res.data) {
        return res.data as { unitPrice: number; discountPct: number; source: string; reason: string };
      }
    } catch { /* repli : prix standard conservé */ }
    return null;
  }, []);

  // §B3 — changement de client : re-résout le prix de TOUTES les lignes.
  const handleClientChange = async (clientId: string) => {
    setSelectedClientId(clientId);
    const snapshot = cart.map(c => ({ id: c.product_id, qty: c.quantity, manual: c.discountManual, discount: c.discount }));
    if (snapshot.length === 0) return;
    const results = await Promise.all(snapshot.map(async (s) => {
      const data = await resolveLinePrice(s.id, s.qty, clientId);
      return data ? { id: s.id, data, manual: s.manual, discount: s.discount } : null;
    }));
    const map = new Map(results.filter((r): r is NonNullable<typeof r> => r !== null).map(r => [r.id, r]));
    setCart(prev => prev.map(c => {
      const hit = map.get(c.product_id);
      if (!hit) return c;
      return {
        ...c,
        unit_price: hit.data.unitPrice,
        discount: c.discountManual ? c.discount : hit.data.discountPct,
        price_source: hit.data.source,
        price_reason: hit.data.reason,
      };
    }));
  };

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
      // Ne pas voler le focus au champ scanner si l'utilisateur est en train
      // de saisir dans un champ (quantité, prix, remise, recherche, etc.).
      const target = e.target as HTMLElement | null;
      const isTyping = !!target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      );
      if (!showPayment && !showReceipt && !unknownCode && !isTyping && e.key !== 'Tab' && e.key !== 'F2' && e.key !== 'Escape') {
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showPayment, showReceipt, unknownCode]);

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

    void (async () => {
      // §B3 — le prix d'une NOUVELLE ligne est résolu par le backend selon le
      // client sélectionné (prix client > prix niveau > remise quantité > standard).
      const priced = await resolveLinePrice(product.id, 1, selectedClientId);
      const unitPrice = priced ? priced.unitPrice : product.selling_price;
      const discountPct = priced ? priced.discountPct : 0;

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
          unit_price: unitPrice,
          discount: discountPct,
          current_stock: stock,
          vat_rate: product.vat_rate ?? 20,
          discountManual: false,
          base_unit: product.unit || 'PIÈCE',
          sale_unit: product.unit || 'PIÈCE',
          unit_factor: 1,
          alt_units: [],
          price_source: priced?.source ?? 'STANDARD',
          price_reason: priced?.reason ?? 'Prix standard',
        }];
      });
    })();
  }, [resolveLinePrice, selectedClientId]);

  // Phase 6 : charge les unités alternatives d'un produit. Le FACTEUR de chaque
  // unité est calculé par le BACKEND (`conversions.convert`), jamais côté front.
  const loadAltUnits = useCallback(async (product: Product) => {
    try {
      const convs = await window.api.conversions.getByProduct(product.id);
      const base = product.unit || 'PIÈCE';
      const candidates = new Set<string>();
      for (const c of (convs ?? []) as Array<{ from_unit: string; to_unit: string; product_id: string | null }>) {
        if (c.product_id !== product.id) continue;
        if (c.from_unit !== base) candidates.add(c.from_unit);
        if (c.to_unit !== base) candidates.add(c.to_unit);
      }
      const list: { unit: string; factor: number }[] = [];
      for (const unit of candidates) {
        const factor = await window.api.conversions.convert(1, unit, base, product.id);
        if (typeof factor === 'number' && factor > 0) list.push({ unit, factor });
      }
      if (list.length > 0) {
        setCart(prev => prev.map(c => (c.product_id === product.id ? { ...c, alt_units: list } : c)));
      }
    } catch { /* aucune conversion disponible : comportement inchangé */ }
  }, []);

  // Phase 6 : change l'unité de vente d'une ligne. Le facteur vient du backend
  // (`conversions.convert`) — la logique de conversion n'est pas dupliquée ici.
  const updateCartUnit = async (productId: string, unit: string) => {
    const item = cart.find(c => c.product_id === productId);
    if (!item) return;
    let factor = 1;
    if (unit !== item.base_unit) {
      const converted = await window.api.conversions.convert(1, unit, item.base_unit, productId);
      factor = typeof converted === 'number' && converted > 0 ? converted : 1;
    }
    setCart(prev => prev.map(c => {
      if (c.product_id !== productId) return c;
      const maxQty = factor > 0 ? Math.max(1, Math.floor(c.current_stock / factor)) : c.quantity;
      return { ...c, sale_unit: unit, unit_factor: factor, quantity: Math.min(c.quantity, maxQty) };
    }));
  };

  const updateCartQuantity = (productId: string, qty: number) => {
    let newQty = qty;
    setCart(prev => prev.map(c => {
      if (c.product_id !== productId) return c;
      const maxByStock = c.unit_factor > 0 ? Math.max(1, Math.floor(c.current_stock / c.unit_factor)) : c.current_stock;
      newQty = Math.max(1, Math.min(qty, maxByStock));
      // Phase 4 : recalcul automatique de la remise quantité (sauf remise manuelle).
      const resolved = resolveDiscount(discountRules, newQty, c.discountManual ? c.discount : null);
      const newDiscount = resolved.source === 'manual' ? c.discount : resolved.pct;
      return { ...c, quantity: newQty, discount: newDiscount };
    }));

    // §B3 — la quantité change la remise applicable : on re-résout le prix côté
    // backend (le prix de niveau / client reste prioritaire sur la remise quantité).
    void (async () => {
      const priced = await resolveLinePrice(productId, newQty, selectedClientId);
      if (!priced) return;
      setCart(prev => prev.map(c => c.product_id === productId ? {
        ...c,
        unit_price: priced.unitPrice,
        discount: c.discountManual ? c.discount : priced.discountPct,
        price_source: priced.source,
        price_reason: priced.reason,
      } : c));
    })();
  };

  const updateCartDiscount = (productId: string, discount: number) => {
    setCart(prev => prev.map(c =>
      c.product_id === productId
        ? { ...c, discount: Math.max(0, Math.min(100, discount)), discountManual: true }
        : c
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
    setPaymentLines([{ method: 'CASH', amount: 0, reference: '' }]);
  };

  const subtotal = roundMoney(cart.reduce((sum, it) => sum + lineTotalTTC(it), 0));
  // §B2 — total encaissé = somme des lignes ; monnaie = excédent éventuel.
  const totalPaidLines = roundMoney(paymentLines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0));
  const change = Math.max(0, roundMoney(totalPaidLines - subtotal));
  const remaining = Math.max(0, roundMoney(subtotal - totalPaidLines));
  // On refuse un total encaissé STRICTEMENT supérieur au montant dû (sauf centime d'arrondi) :
  // un trop-perçu relève d'un avoir/remboursement, pas d'une vente directe.
  const paymentsOverpay = totalPaidLines > subtotal + 0.01;
  const canValidate = cart.length > 0;

  // §B2 — gestion des lignes de paiement.
  const addPaymentLine = () => setPaymentLines(prev => [...prev, { method: 'CASH', amount: 0, reference: '' }]);
  const removePaymentLine = (idx: number) => setPaymentLines(prev => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx));
  const updatePaymentLine = (idx: number, patch: Partial<PaymentLine>) =>
    setPaymentLines(prev => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  // Complète la ligne courante (dernière ligne) pour couvrir le reste dû.
  const fillRemaining = () => setPaymentLines(prev => {
    if (prev.length === 0) return prev;
    const already = prev.slice(0, -1).reduce((s, l) => s + (Number(l.amount) || 0), 0);
    const rest = Math.max(0, roundMoney(subtotal - already));
    return prev.map((l, i) => (i === prev.length - 1 ? { ...l, amount: rest } : l));
  });

  // §Phase 6 — mise en attente / reprise d'une vente (multi-clients au comptoir).
  // Le panier courant n'est JAMAIS perdu : s'il est non vide au moment de la
  // reprise, il repart automatiquement en attente.
  const currentClientLabel = clients.find(c => c.id === selectedClientId)?.name ?? 'Client comptoir';

  const holdCurrentCart = () => {
    if (cart.length === 0) return;
    holdCart(cart, selectedClientId, currentClientLabel, subtotal);
    clearCart();
    toast.success('Vente mise en attente');
  };

  const resumeHeldCart = (heldId: string) => {
    const target = heldCarts.find(h => h.id === heldId);
    if (!target) return;
    if (cart.length > 0) {
      holdCart(cart, selectedClientId, currentClientLabel, subtotal);
    }
    setCart(target.items.map(i => ({ ...i })));
    setSelectedClientId(target.clientId);
    setPaymentLines([{ method: 'CASH', amount: 0, reference: '' }]);
    releaseHeldCart(heldId);
    toast.success('Vente reprise');
  };
  const filteredProducts = products.filter((product) => product.status === 'ACTIVE');

  const handleBarcodeSubmit = async () => {
    const code = productSearch.trim();
    if (!code) return;

    try {
      const byBarcode = await window.api.products.getByBarcode(code);
      if (byBarcode) {
        addToCart(byBarcode);
        void loadAltUnits(byBarcode);
        setProductSearch('');
        return;
      }
      const byReference = await window.api.products.getByReference(code);
      if (byReference) {
        addToCart(byReference);
        void loadAltUnits(byReference);
        setProductSearch('');
        return;
      }
      // §Phase 6 — code inconnu : on propose explicitement de créer le produit
      // (la recherche live reste active par ailleurs).
      setUnknownCode(code);
    } catch {
      toast.error('La recherche du produit a échoué. Réessayez.');
    }
  };

  /**
   * §Phase 6 — « Créer le produit » depuis un scan inconnu.
   * Navigue vers la page Produits en transmettant le code scanné : le
   * formulaire de création (validé côté main) s'ouvre pré-rempli.
   */
  const createProductFromScan = () => {
    const code = unknownCode;
    setUnknownCode(null);
    setProductSearch('');
    window.dispatchEvent(new CustomEvent('navigate', {
      detail: { page: 'products', createFromBarcode: code ?? undefined },
    }));
  };

  const handleValidateSale = async () => {
    if (cart.length === 0) return;
    if (paymentsOverpay) {
      toast.error('Le total encaissé dépasse le montant dû.');
      return;
    }

    try {
      // Résumé des modes utilisés (pour la note du document).
      const usedMethods = paymentLines
        .filter(l => Number(l.amount) > 0)
        .map(l => l.method)
        .filter((m, i, a) => a.indexOf(m) === i)
        .join('/') || 'CASH';

      const result = await window.api.documents.create({
        type: 'INVOICE',
        entity_id: selectedClientId || '',
        date: toLocalDateString(),
        notes: `Vente caisse — ${usedMethods}`,
        // §B4 — vendeur/commercial associé (facultatif).
        seller_id: selectedSellerId || null,
        items: cart.map(c => ({
          product_id: c.product_id,
          // Phase 6 : vente en unité alternative convertie en unité de base.
          quantity: toBaseQuantity(c.quantity, c.unit_factor),
          unit_price: toBaseUnitPrice(c.unit_price, c.unit_factor),
          discount: c.discount,
        })),
      });

      if (!result.success) throw new Error(result.error);

      // §B2 — encaissement RÉPARTI : chaque ligne non nulle est enregistrée en
      // une seule transaction côté service. Le service vérifie que la SOMME des
      // lignes ne dépasse pas le reste dû.
      const lines = paymentLines
        .filter(l => Number(l.amount) > 0)
        .map(l => ({ amount: Number(l.amount), payment_method: l.method, reference: l.reference || null }));

      if (lines.length > 0) {
        const payResult = await window.api.documents.addPayments({
          document_id: result.data.id,
          payments: lines,
        });
        if (!payResult.success) throw new Error(payResult.error);
      }

      // Impression : ticket de caisse 80 mm (défaut) ou facture A4 complète.
      // Une erreur d'impression ne doit JAMAIS annuler la vente déjà enregistrée.
      try {
        const printed = printMode === 'receipt'
          ? await window.api.documents.printReceipt(result.data.id)
          : await window.api.documents.exportPdf(result.data.id);
        if (!printed.success) toast.warning(`Document non imprimé : ${printed.error}`);
      } catch (e: unknown) {
        toast.warning(`Impression impossible : ${e instanceof Error ? e.message : String(e)}`);
      }

      setLastSale({
        docNumber: result.data.document_number,
        total: subtotal,
        items: [...cart],
      });
      setShowPayment(false);
      setShowReceipt(true);
      clearCart();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(`Erreur : ${message}`);
    }
  };

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
              onChange={e => { void handleClientChange(e.target.value); }}
            >
              <option value="">Client comptoir</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {sellers.length > 0 && (
              <select
                className="input"
                style={{ width: 200 }}
                value={selectedSellerId}
                onChange={e => setSelectedSellerId(e.target.value)}
                title="Vendeur / commercial associé à la vente"
              >
                <option value="">Vendeur : —</option>
                {sellers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            {heldCarts.length > 0 && (
              <select
                className="input"
                style={{ width: 250 }}
                value=""
                onChange={e => { if (e.target.value) resumeHeldCart(e.target.value); }}
                title="Reprendre une vente mise en attente"
              >
                <option value="">Ventes en attente ({heldCarts.length})</option>
                {heldCarts.map(h => (
                  <option key={h.id} value={h.id}>
                    {h.clientName} — {h.label}
                  </option>
                ))}
              </select>
            )}
          </>
        }
      />

      <div className="flex flex-1 pos-main" style={{ overflow: 'hidden', flexDirection: 'row-reverse' }}>
        <div className="pos-column">
          <div className="flex-1" style={{ overflowY: 'auto', overflowX: 'hidden', padding: 'var(--space-4) var(--space-5)' }}>
            {cart.length === 0 ? (
              <div className="state-box" style={{ height: '100%' }}>
                <div className="state-icon">🛒</div>
                <div className="state-title">Le panier est vide</div>
                <div className="state-text">Scannez un produit ou recherchez-le à gauche</div>
              </div>
            ) : (
              <>
                <div className="pos-cart-header">
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>Produit</div>
                  <div style={{ textAlign: 'center' }}>Qté</div>
                  <div style={{ textAlign: 'center' }}>Prix</div>
                  <div style={{ textAlign: 'center' }}>Remise %</div>
                  <div style={{ textAlign: 'right' }}>Total</div>
                  <div></div>
                </div>
                <div className="flex gap-2" style={{ flexDirection: 'column' }}>
                  {cart.map(item => (
                    <div key={item.product_id} className="pos-cart-item">
                      <div className="flex-1 item-info">
                        <div className="font-semibold">{item.reference}</div>
                        <div className="text-sm text-muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.designation}</div>
                        {item.price_reason && (
                          <div className="text-xs text-muted">{item.price_reason}</div>
                        )}
                        {(() => {
                          const rule = !item.discountManual ? findApplicableDiscount(discountRules, item.quantity) : null;
                          if (rule && rule.discount_pct > 0 && rule.discount_pct === item.discount && !item.price_reason) {
                            return <div className="text-xs text-success">{describeVolumeDiscount(rule)}</div>;
                          }
                          return null;
                        })()}
                        {item.alt_units.length > 0 && (
                          <div className="flex items-center gap-2" style={{ marginTop: 2 }}>
                            <select
                              className="input input-sm"
                              style={{ width: 'auto', padding: '2px 6px', fontSize: 12 }}
                              value={item.sale_unit}
                              onChange={e => { void updateCartUnit(item.product_id, e.target.value); }}
                              title="Unité de vente"
                            >
                              <option value={item.base_unit}>{item.base_unit}</option>
                              {item.alt_units.map(a => <option key={a.unit} value={a.unit}>{a.unit}</option>)}
                            </select>
                            {item.unit_factor !== 1 && (
                              <span className="text-xs text-muted">1 {item.sale_unit} = {item.unit_factor} {item.base_unit}</span>
                            )}
                          </div>
                        )}
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
                          className="input input-sm money text-center"
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
                        {lineTotalTTC(item).toFixed(2)} MAD
                      </div>
                      <Button variant="ghost" onClick={() => removeFromCart(item.product_id)} style={{ color: 'var(--danger)', fontSize: 20, padding: 4 }}>×</Button>
                    </div>
                  ))}
                </div>
              </>
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
                <Button variant="secondary" size="lg" onClick={holdCurrentCart} title="Mettre la vente en attente et servir un autre client">
                  Mettre en attente
                </Button>
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
              ref={searchRef}
              type="text"
              className="input input-lg w-full"
              value={productSearch}
              onChange={e => setProductSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleBarcodeSubmit(); }}
              placeholder="🔍 Rechercher un produit... (code-barres / référence)"
            />
          </div>
          <div className="flex-1" style={{ overflowY: 'auto', padding: 'var(--space-2)' }}>
            {filteredProducts.slice(0, 50).map(p => {
              const stock = p.current_stock ?? 0;
              return (
                <div key={p.id} className="list-item" onClick={() => { addToCart(p); void loadAltUnits(p); }}>
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

      <Modal open={showPayment} onClose={() => setShowPayment(false)} width={560}>
        <ModalHeader icon="💳" title="Encaissement" />
        <ModalBody>
          <div className="text-center mb-4">
            <div className="text-sm text-muted">Total à payer</div>
            <div className="money" style={{ fontSize: 42, fontWeight: 800 }}>{subtotal.toFixed(2)} MAD</div>
          </div>

          <div className="text-sm text-muted" style={{ marginBottom: 6 }}>Modes de paiement (plusieurs lignes possibles)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {paymentLines.map((line, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select
                  className="input"
                  style={{ width: 130 }}
                  value={line.method}
                  onChange={e => updatePaymentLine(idx, { method: e.target.value as PaymentMethod })}
                >
                  <option value="CASH">Espèces</option>
                  <option value="CHECK">Chèque</option>
                  <option value="TRANSFER">Virement</option>
                </select>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  className="input money"
                  style={{ flex: 1, textAlign: 'right' }}
                  placeholder="Montant"
                  value={line.amount || ''}
                  onChange={e => updatePaymentLine(idx, { amount: Number(e.target.value) })}
                />
                <input
                  type="text"
                  className="input"
                  style={{ width: 140 }}
                  placeholder="Référence"
                  value={line.reference}
                  onChange={e => updatePaymentLine(idx, { reference: e.target.value })}
                />
                <Button
                  variant="ghost"
                  icon
                  title="Retirer la ligne"
                  onClick={() => removePaymentLine(idx)}
                  disabled={paymentLines.length === 1}
                  style={{ color: 'var(--danger)', fontSize: 18 }}
                >
                  ×
                </Button>
              </div>
            ))}
          </div>

          <div className="flex" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={addPaymentLine}>Ajouter un mode</Button>
            <Button variant="secondary" onClick={fillRemaining} disabled={remaining <= 0}>
              Compléter le reste ({remaining.toFixed(2)} MAD)
            </Button>
          </div>

          <div className="surface-muted" style={{ display: 'flex', justifyContent: 'space-between', padding: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
            <span className="text-sm">Encaissé : <strong className="money">{totalPaidLines.toFixed(2)} MAD</strong></span>
            <span className="text-sm">Reste : <strong className="money">{remaining.toFixed(2)} MAD</strong></span>
          </div>

          {paymentsOverpay && (
            <div className="surface-danger text-center" style={{ padding: 'var(--space-3)', marginTop: 8 }}>
              <span className="text-sm font-semibold">
                Le total encaissé dépasse le montant dû. Corrigez les lignes.
              </span>
            </div>
          )}
          {!paymentsOverpay && change > 0 && (
            <div className="surface-success text-center" style={{ padding: 'var(--space-3)', marginTop: 8 }}>
              <span className="text-sm text-success font-semibold">
                Rendu (monnaie) : <strong className="money">{change.toFixed(2)} MAD</strong>
              </span>
            </div>
          )}

          <div style={{ marginTop: 'var(--space-4)' }}>
            <div className="text-sm text-muted" style={{ marginBottom: 6 }}>Document à imprimer</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button
                variant={printMode === 'receipt' ? 'primary' : 'secondary'}
                style={{ flex: 1 }}
                onClick={() => setPrintMode('receipt')}
              >
                Ticket de caisse
              </Button>
              <Button
                variant={printMode === 'invoice' ? 'primary' : 'secondary'}
                style={{ flex: 1 }}
                onClick={() => setPrintMode('invoice')}
              >
                Facture complète
              </Button>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setShowPayment(false)}>Annuler</Button>
          <Button variant="success" size="lg" onClick={handleValidateSale} disabled={!canValidate || paymentsOverpay}>
            Valider la vente
          </Button>
        </ModalFooter>
      </Modal>

      <Modal open={showReceipt && !!lastSale} onClose={() => { setShowReceipt(false); setLastSale(null); searchRef.current?.focus(); }} width={400}>
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
                    <span className="money">{lineTotalTTC(it).toFixed(2)}</span>
                  </div>
                ))}
                <div className="flex justify-between font-semibold money" style={{ marginTop: 'var(--space-2)', paddingTop: 'var(--space-2)', borderTop: '2px solid var(--text)' }}>
                  <span>TOTAL</span>
                  <span>{lastSale.total.toFixed(2)} MAD</span>
                </div>
              </div>
            </>
          )}
          <Button variant="primary" block size="lg" onClick={() => { setShowReceipt(false); setLastSale(null); searchRef.current?.focus(); }}>
            Nouvelle vente
          </Button>
        </ModalBody>
      </Modal>

      {/* §Phase 6 — code-barres scanné INTROUVABLE : proposer de créer le produit. */}
      <Modal open={!!unknownCode} onClose={() => setUnknownCode(null)} width={420}>
        <ModalHeader icon="❓" title="Produit introuvable" />
        <ModalBody>
          <div className="text-center">
            <div className="text-sm text-muted" style={{ marginBottom: 6 }}>
              Aucun produit ne correspond au code scanné :
            </div>
            <div className="font-semibold" style={{ fontFamily: 'var(--font-mono)', fontSize: 20 }}>
              {unknownCode}
            </div>
            <div className="text-xs text-muted" style={{ marginTop: 10 }}>
              Vous pouvez créer ce produit maintenant : le code scanné sera utilisé comme code-barres.
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setUnknownCode(null)}>Annuler</Button>
          <Button variant="primary" onClick={createProductFromScan}>Créer le produit</Button>
        </ModalFooter>
      </Modal>
    </div>
  );
};
