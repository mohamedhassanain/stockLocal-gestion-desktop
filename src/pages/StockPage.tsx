import React, { useState } from 'react';
import { useStockStore } from '../stores/useStockStore';
import { useProductStore } from '../stores/useProductStore';

export const StockPage: React.FC = () => {
  const { currentProductStock, loadProductStock, addEntry, addExit } = useStockStore();
  const { products, searchProducts, searchQuery, setSearchQuery } = useProductStore((state) => ({
    products: state.products,
    searchProducts: state.loadProducts, // assuming loadProducts uses searchQuery
    searchQuery: state.searchQuery,
    setSearchQuery: state.setSearchQuery
  }));

  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [qty, setQty] = useState<number>(1);
  const [price, setPrice] = useState<number>(0);

  const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      searchProducts();
    }
  };

  const handleSelectProduct = (productId: string) => {
    setSelectedProductId(productId);
    loadProductStock(productId);
  };

  const handleAddEntry = async () => {
    if (!selectedProductId) return;
    try {
      await addEntry({
        product_id: selectedProductId,
        quantity: qty,
        unit_price: price,
        user_id: 'user_1' // Mock utilisateur connecté
      });
      alert('Entrée ajoutée avec succès !');
      setQty(1);
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
        unit_price: price, // Souvent 0 pour la casse, ou prix de vente pour vente
        user_id: 'user_1'
      });
      alert('Sortie effectuée avec succès !');
      setQty(1);
    } catch (e: any) {
      alert(e.message);
    }
  };

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
              </li>
            ))}
          </ul>
        </div>

        {/* Actions sur le produit sélectionné */}
        {selectedProductId && (
          <div style={{ flex: 1, backgroundColor: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)' }}>
            <h2 style={{ marginTop: 0 }}>Actions Rapides</h2>
            <div style={{ fontSize: '24px', marginBottom: '20px' }}>
              Stock Actuel : <strong style={{ color: currentProductStock > 0 ? '#10b981' : '#ef4444' }}>{currentProductStock}</strong>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <input type="number" value={qty} onChange={e => setQty(Number(e.target.value))} placeholder="Quantité" style={{ padding: '15px', fontSize: '18px' }} />
              <input type="number" value={price} onChange={e => setPrice(Number(e.target.value))} placeholder="Prix unitaire" style={{ padding: '15px', fontSize: '18px' }} />
              
              <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <button onClick={handleAddEntry} style={{ flex: 1, padding: '20px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', fontSize: '18px', fontWeight: 'bold', cursor: 'pointer' }}>
                  + ENTREE (Achat)
                </button>
                <button onClick={handleAddExit} style={{ flex: 1, padding: '20px', backgroundColor: '#ef4444', color: 'white', border: 'none', borderRadius: '8px', fontSize: '18px', fontWeight: 'bold', cursor: 'pointer' }}>
                  - SORTIE (Casse/Vente)
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
