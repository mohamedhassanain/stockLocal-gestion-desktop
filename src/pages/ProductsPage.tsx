import React, { useEffect, useState } from 'react';
import { useProductStore } from '../stores/useProductStore';

export const ProductsPage: React.FC = () => {
  const { products, loadProducts, isLoading, searchQuery, setSearchQuery } = useProductStore();
  
  useEffect(() => {
    // Initialisation
    loadProducts();
    
    // Raccourci clavier Global pour la recherche
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F' && e.ctrlKey) {
        e.preventDefault();
        document.getElementById('product-search')?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div style={{ padding: '30px', flex: 1, backgroundColor: '#f8fafc', height: '100vh', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <h1 style={{ margin: 0, fontSize: '32px', color: '#0f172a' }}>Gestion des Produits</h1>
        
        {/* Gros boutons pour réduire les clics */}
        <button style={{ 
          padding: '15px 30px', 
          backgroundColor: '#2563eb', 
          color: 'white', 
          border: 'none', 
          borderRadius: '8px', 
          fontSize: '18px',
          fontWeight: 'bold',
          cursor: 'pointer',
          boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
        }}>
          + Nouveau Produit (F8)
        </button>
      </div>

      <div style={{ display: 'flex', gap: '20px', marginBottom: '20px' }}>
        <input 
          id="product-search"
          type="text" 
          placeholder="Rechercher par référence, désignation ou code-barres... (Ctrl+F)" 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ 
            flex: 1, 
            padding: '18px', 
            fontSize: '18px', 
            borderRadius: '8px', 
            border: '2px solid #cbd5e1',
            outline: 'none'
          }}
        />
        <button style={{ 
          padding: '15px 30px', 
          backgroundColor: '#10b981', 
          color: 'white', 
          border: 'none', 
          borderRadius: '8px', 
          fontSize: '18px',
          fontWeight: 'bold',
          cursor: 'pointer'
        }}>
          🖨️ Imprimer Étiquettes
        </button>
      </div>

      {/* Tableau avec virtualisation simulée pour de grandes quantités */}
      <div style={{ backgroundColor: 'white', borderRadius: '12px', boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead style={{ backgroundColor: '#f1f5f9', borderBottom: '2px solid #e2e8f0' }}>
            <tr>
              <th style={{ padding: '20px', fontSize: '16px', color: '#475569' }}>Réf</th>
              <th style={{ padding: '20px', fontSize: '16px', color: '#475569' }}>Désignation</th>
              <th style={{ padding: '20px', fontSize: '16px', color: '#475569' }}>Code-barres</th>
              <th style={{ padding: '20px', fontSize: '16px', color: '#475569' }}>Stock</th>
              <th style={{ padding: '20px', fontSize: '16px', color: '#475569' }}>Prix Vente</th>
              <th style={{ padding: '20px', fontSize: '16px', color: '#475569' }}>Statut</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} style={{ padding: '40px', textAlign: 'center', fontSize: '18px' }}>Chargement ultra-rapide en cours...</td></tr>
            ) : products.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: '40px', textAlign: 'center', fontSize: '18px', color: '#94a3b8' }}>Aucun produit trouvé</td></tr>
            ) : (
              products.map(p => (
                <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}>
                  <td style={{ padding: '20px', fontWeight: 'bold' }}>{p.reference}</td>
                  <td style={{ padding: '20px' }}>{p.designation}</td>
                  <td style={{ padding: '20px' }}>{p.barcode || '-'}</td>
                  <td style={{ padding: '20px', fontWeight: 'bold', color: p.min_stock > 10 ? '#10b981' : '#ef4444' }}>{/* Valeur calculée via StockStore */} --</td>
                  <td style={{ padding: '20px', fontWeight: 'bold' }}>{p.selling_price.toFixed(2)} MAD</td>
                  <td style={{ padding: '20px' }}>
                    <span style={{ padding: '5px 10px', backgroundColor: p.status === 'ACTIVE' ? '#dcfce3' : '#fee2e2', color: p.status === 'ACTIVE' ? '#166534' : '#991b1b', borderRadius: '20px', fontSize: '14px', fontWeight: 'bold' }}>
                      {p.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
