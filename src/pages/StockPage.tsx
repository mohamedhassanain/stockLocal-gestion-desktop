import React, { useState } from 'react';
import { useStockStore } from '../stores/useStockStore';
import { useProductStore } from '../stores/useProductStore';

export type ExitType = 'VENTE' | 'CASSE' | 'PERTE' | 'RETOUR';

export const StockPage: React.FC = () => {
  const { currentProductStock, stockHistory, loadProductStock, addEntry, addExit, addInventory } = useStockStore();
  const { products, searchQuery, setSearchQuery, loadProducts } = useProductStore((state) => ({
    products: state.products,
    searchQuery: state.searchQuery,
    setSearchQuery: state.setSearchQuery,
    loadProducts: state.loadProducts,
  }));

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
      alert('Entrée ajoutée avec succès !');
      setQty(1);
      setNotes('');
      setBlRef('');
      loadProductStock(selectedProductId);
      loadProducts();
    } catch (e: any) {
      alert(e.message);
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
      alert(`Sortie (${exitType}) effectuée avec succès !`);
      setQty(1);
      setNotes('');
      loadProductStock(selectedProductId);
      loadProducts();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleInventory = async () => {
    if (!selectedProductId) return;
    try {
      await addInventory({
        product_id: selectedProductId,
        unit_price: 0,
      }, actualCount);
      alert('Inventaire enregistré (écart ajusté).');
      loadProductStock(selectedProductId);
      loadProducts();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const selectedProduct = products.find(p => p.id === selectedProductId);

  return (
    <div style={{ padding: '30px', flex: 1, backgroundColor: '#f8fafc', height: '100vh', overflowY: 'auto' }}>
      <h1 style={{ fontSize: '32px', color: '#0f172a', marginBottom: '30px' }}>Gestion des Mouvements de Stock</h1>

      <div style={{ display: 'flex', gap: '20px', marginBottom: '30px' }}>
        <input
          type="text"
          placeholder="Scanner le code-barres ou taper la référence... (Entrée pour chercher)"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleSearch}
          style={{ flex: 1, padding: '20px', fontSize: '20px', borderRadius: '8px', border: '2px solid #cbd5e1' }}
          autoFocus
        />
      </div>

      <div style={{ display: 'flex', gap: '20px' }}>
        {/* Liste des produits trouvés */}
        <div style={{ flex: 1, backgroundColor: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)' }}>
          <h2 style={{ marginTop: 0 }}>Résultats</h2>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {products.map(p => (
              <li
                key={p.id}
                onClick={() => handleSelectProduct(p.id)}
                style={{
                  padding: '15px',
                  borderBottom: '1px solid #f1f5f9',
                  cursor: 'pointer',
                  backgroundColor: selectedProductId === p.id ? '#eff6ff' : 'transparent',
                  fontWeight: selectedProductId === p.id ? 'bold' : 'normal'
                }}
              >
                {p.reference} - {p.designation}
                <span style={{ float: 'right', color: (p.current_stock ?? 0) <= p.min_stock ? '#ef4444' : '#10b981', fontWeight: 'bold' }}>
                  {p.current_stock ?? 0} {p.unit || 'PIÈCE'}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Actions sur le produit sélectionné */}
        {selectedProductId && (
          <div style={{ flex: 1.4, backgroundColor: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)' }}>
            {selectedProduct && (
              <div style={{ fontSize: '15px', color: '#6b7280', marginBottom: '12px' }}>
                {selectedProduct.reference} — {selectedProduct.designation} ({selectedProduct.unit || 'PIÈCE'})
              </div>
            )}
            <div style={{ fontSize: '24px', marginBottom: '20px' }}>
              Stock Actuel : <strong style={{ color: currentProductStock > 0 ? '#10b981' : '#ef4444' }}>{currentProductStock}</strong>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <div style={{ display: 'flex', gap: '10px' }}>
                <input type="number" value={qty} onChange={e => setQty(Number(e.target.value))} placeholder="Quantité" style={{ flex: 1, padding: '15px', fontSize: '18px' }} />
                <input type="number" value={price} onChange={e => setPrice(Number(e.target.value))} placeholder="Prix unitaire" style={{ flex: 1, padding: '15px', fontSize: '18px' }} />
              </div>
              {/* Réf BL (entrées) */}
              <input type="text" value={blRef} onChange={e => setBlRef(e.target.value)} placeholder="Réf BL (entrée achat, optionnel)" style={{ padding: '12px', fontSize: '15px' }} />
              {/* Type de sortie */}
              <select value={exitType} onChange={e => setExitType(e.target.value as ExitType)} style={{ padding: '12px', fontSize: '15px' }}>
                <option value="VENTE">Sortie : Vente</option>
                <option value="CASSE">Sortie : Casse</option>
                <option value="PERTE">Sortie : Perte</option>
                <option value="RETOUR">Sortie : Retour</option>
              </select>
              <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optionnel)" style={{ padding: '12px', fontSize: '15px' }} />

              <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <button onClick={handleAddEntry} style={{ flex: 1, padding: '20px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', fontSize: '18px', fontWeight: 'bold', cursor: 'pointer' }}>
                  + ENTREE (Achat)
                </button>
                <button onClick={handleAddExit} style={{ flex: 1, padding: '20px', backgroundColor: '#ef4444', color: 'white', border: 'none', borderRadius: '8px', fontSize: '18px', fontWeight: 'bold', cursor: 'pointer' }}>
                  - SORTIE ({exitType})
                </button>
              </div>

              {/* Inventaire */}
              <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '15px', marginTop: '5px' }}>
                <h3 style={{ margin: '0 0 10px', fontSize: '16px', color: '#0f172a' }}>📋 Inventaire (comptage physique)</h3>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <input
                    type="number"
                    value={actualCount}
                    onChange={e => setActualCount(Number(e.target.value))}
                    placeholder="Quantité comptée"
                    style={{ flex: 1, padding: '15px', fontSize: '18px' }}
                  />
                  <button onClick={handleInventory} style={{ flex: 1, padding: '15px', backgroundColor: '#7c3aed', color: 'white', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer' }}>
                    ✓ Valider l'inventaire
                  </button>
                </div>
              </div>

              {/* Historique */}
              {stockHistory.length > 0 && (
                <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '15px' }}>
                  <h3 style={{ margin: '0 0 10px', fontSize: '16px', color: '#0f172a' }}>🕘 Historique des mouvements</h3>
                  <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
                    {stockHistory.map(h => (
                      <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: '14px' }}>
                        <span>
                          <span style={{
                            fontWeight: 'bold',
                            padding: '2px 8px',
                            borderRadius: '10px',
                            fontSize: '12px',
                            background: h.type === 'IN' ? '#dcfce7' : h.type === 'OUT' ? '#fee2e2' : '#ede9fe',
                            color: h.type === 'IN' ? '#166534' : h.type === 'OUT' ? '#991b1b' : '#5b21b6',
                          }}>
                            {h.type === 'IN' ? 'ENTRÉE' : h.type === 'OUT' ? 'SORTIE' : 'INVENTAIRE'}
                          </span>{' '}
                          {h.notes ? h.notes.substring(0, 50) : `Qté: ${h.quantity}`}
                        </span>
                        <span style={{ textAlign: 'right', color: '#6b7280', fontSize: '12px', whiteSpace: 'nowrap' }}>
                          {new Date(h.date ?? Date.now()).toLocaleDateString('fr-MA')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
