import React, { useEffect, useState, useRef } from 'react';
import { useProductStore } from '../stores/useProductStore';
import { ProductForm } from '../components/products/ProductForm';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Product } from '../repositories/ProductRepository';

export const ProductsPage: React.FC = () => {
  const { products, loadProducts, isLoading, searchQuery, setSearchQuery, archiveProduct, activateProduct } = useProductStore();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: products.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 61,
    overscan: 5,
  });

  useEffect(() => {
    loadProducts();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F' && e.ctrlKey) {
        e.preventDefault();
        document.getElementById('product-search')?.focus();
      }
      if (e.key === 'F8') {
        e.preventDefault();
        setIsFormOpen(true);
        setEditingProduct(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    setIsFormOpen(true);
  };

  const handleArchive = async (product: Product) => {
    if (!confirm(`Archiver le produit "${product.designation}" ? Il sera masqué des recherches de vente.`)) return;
    try {
      await archiveProduct(product.id);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleActivate = async (product: Product) => {
    try {
      await activateProduct(product.id);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handlePrintLabels = async () => {
    if (products.length === 0) {
      alert('Aucun produit à imprimer. Effectuez d\'abord une recherche.');
      return;
    }
    try {
      const result = await window.api.products.printLabels(products.map(p => p.id));
      if (!result.success) throw new Error(result.error);
    } catch (e: any) {
      alert(e.message);
    }
  };

  return (
    <div style={{ padding: '30px', flex: 1, backgroundColor: '#f8fafc', height: '100vh', overflowY: 'auto', position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
        <h1 style={{ margin: 0, fontSize: '32px', color: '#0f172a' }}>Gestion des Produits</h1>
        <button
          onClick={() => { setIsFormOpen(true); setEditingProduct(null); }}
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
        <button onClick={handlePrintLabels}
          style={{
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

      <div style={{ backgroundColor: 'white', borderRadius: '12px', boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)', overflow: 'hidden', display: 'flex', flexDirection: 'column', flex: 1, maxHeight: 'calc(100vh - 200px)' }}>
        {/* En-tête fixe */}
        <div style={{ display: 'flex', backgroundColor: '#f1f5f9', borderBottom: '2px solid #e2e8f0' }}>
          <div style={{ padding: '20px', fontSize: '16px', color: '#475569', flex: 1 }}>Réf</div>
          <div style={{ padding: '20px', fontSize: '16px', color: '#475569', flex: 2 }}>Désignation</div>
          <div style={{ padding: '20px', fontSize: '16px', color: '#475569', flex: 1 }}>Unité</div>
          <div style={{ padding: '20px', fontSize: '16px', color: '#475569', flex: 1 }}>Stock</div>
          <div style={{ padding: '20px', fontSize: '16px', color: '#475569', flex: 1 }}>Prix Vente</div>
          <div style={{ padding: '20px', fontSize: '16px', color: '#475569', flex: 1 }}>Statut</div>
          <div style={{ padding: '20px', fontSize: '16px', color: '#475569', flex: 1 }}>Actions</div>
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
                const stock = p.current_stock ?? 0;
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
                    <div style={{ padding: '10px 20px', flex: 1, fontSize: '13px', color: '#6b7280' }}>{p.unit || 'PIÈCE'}</div>
                    <div style={{ padding: '10px 20px', fontWeight: 'bold', flex: 1, color: stock <= p.min_stock ? '#ef4444' : '#10b981' }}>
                      {stock} {p.min_stock > 0 && stock <= p.min_stock && '⚠️'}
                    </div>
                    <div style={{ padding: '10px 20px', fontWeight: 'bold', flex: 1 }}>{p.selling_price.toFixed(2)} MAD</div>
                    <div style={{ padding: '10px 20px', flex: 1 }}>
                      <span style={{ padding: '5px 10px', backgroundColor: p.status === 'ACTIVE' ? '#dcfce3' : '#fee2e2', color: p.status === 'ACTIVE' ? '#166534' : '#991b1b', borderRadius: '20px', fontSize: '14px', fontWeight: 'bold' }}>
                        {p.status}
                      </span>
                    </div>
                    <div style={{ padding: '10px 20px', flex: 1, display: 'flex', gap: '6px' }}>
                      <button onClick={() => handleEdit(p)} style={{ padding: '6px 12px', background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', borderRadius: '6px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer' }}>
                        ✏️
                      </button>
                      {p.status === 'ACTIVE' ? (
                        <button onClick={() => handleArchive(p)} style={{ padding: '6px 12px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '6px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer' }}>
                          🗄️
                        </button>
                      ) : (
                        <button onClick={() => handleActivate(p)} style={{ padding: '6px 12px', background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0', borderRadius: '6px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer' }}>
                          ✅
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {isFormOpen && (
        <ProductForm
          onClose={() => { setIsFormOpen(false); setEditingProduct(null); }}
          editingProduct={editingProduct ?? undefined}
        />
      )}
    </div>
  );
};
