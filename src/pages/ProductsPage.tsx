import React, { useEffect, useState, useRef } from 'react';
import { useProductStore } from '../stores/useProductStore';
import { ProductForm } from '../components/products/ProductForm';
import { useVirtualizer } from '@tanstack/react-virtual';

export const ProductsPage: React.FC = () => {
  const { products, loadProducts, isLoading, searchQuery, setSearchQuery } = useProductStore();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: products.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 61,
    overscan: 5,
  });
  
  useEffect(() => {
    // Initialisation
    loadProducts();
    
    // Raccourci clavier Global pour la recherche et l'ajout
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F' && e.ctrlKey) {
        e.preventDefault();
        document.getElementById('product-search')?.focus();
      }
      if (e.key === 'F8') {
        e.preventDefault();
        setIsFormOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div style={{ padding: '30px', flex: 1, backgroundColor: '#f8fafc', height: '100vh', overflowY: 'auto', position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <h1 style={{ margin: 0, fontSize: '32px', color: '#0f172a' }}>Gestion des Produits</h1>
        
        {/* Gros boutons pour réduire les clics */}
        <button 
          onClick={() => setIsFormOpen(true)}
          style={{ 
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

      {/* Tableau virtualisé pour de grandes quantités */}
      <div style={{ backgroundColor: 'white', borderRadius: '12px', boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)', overflow: 'hidden', display: 'flex', flexDirection: 'column', flex: 1, maxHeight: 'calc(100vh - 200px)' }}>
        {/* En-tête fixe */}
        <div style={{ display: 'flex', backgroundColor: '#f1f5f9', borderBottom: '2px solid #e2e8f0', paddingRight: '15px' }}>
          <div style={{ padding: '20px', fontSize: '16px', color: '#475569', flex: 1 }}>Réf</div>
          <div style={{ padding: '20px', fontSize: '16px', color: '#475569', flex: 2 }}>Désignation</div>
          <div style={{ padding: '20px', fontSize: '16px', color: '#475569', flex: 1 }}>Code-barres</div>
          <div style={{ padding: '20px', fontSize: '16px', color: '#475569', flex: 1 }}>Stock</div>
          <div style={{ padding: '20px', fontSize: '16px', color: '#475569', flex: 1 }}>Prix Vente</div>
          <div style={{ padding: '20px', fontSize: '16px', color: '#475569', flex: 1 }}>Statut</div>
        </div>

        {/* Corps virtualisé */}
        <div 
          ref={parentRef}
          style={{ flex: 1, overflowY: 'auto', position: 'relative' }}
        >
          {isLoading ? (
            <div style={{ padding: '40px', textAlign: 'center', fontSize: '18px' }}>Chargement ultra-rapide en cours...</div>
          ) : products.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', fontSize: '18px', color: '#94a3b8' }}>Aucun produit trouvé</div>
          ) : (
            <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const p = products[virtualRow.index];
                return (
                  <div
                    key={virtualRow.index}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                      display: 'flex',
                      borderBottom: '1px solid #f1f5f9',
                      cursor: 'pointer',
                      alignItems: 'center',
                      boxSizing: 'border-box',
                    }}
                  >
                    <div style={{ padding: '10px 20px', fontWeight: 'bold', flex: 1 }}>{p.reference}</div>
                    <div style={{ padding: '10px 20px', flex: 2 }}>{p.designation}</div>
                    <div style={{ padding: '10px 20px', flex: 1 }}>{p.barcode || '-'}</div>
                    <div style={{ padding: '10px 20px', fontWeight: 'bold', flex: 1, color: p.min_stock > 10 ? '#10b981' : '#ef4444' }}>--</div>
                    <div style={{ padding: '10px 20px', fontWeight: 'bold', flex: 1 }}>{p.selling_price.toFixed(2)} MAD</div>
                    <div style={{ padding: '10px 20px', flex: 1 }}>
                      <span style={{ padding: '5px 10px', backgroundColor: p.status === 'ACTIVE' ? '#dcfce3' : '#fee2e2', color: p.status === 'ACTIVE' ? '#166534' : '#991b1b', borderRadius: '20px', fontSize: '14px', fontWeight: 'bold' }}>
                        {p.status}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {isFormOpen && <ProductForm onClose={() => setIsFormOpen(false)} />}
    </div>
  );
};

