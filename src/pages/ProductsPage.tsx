import React, { useEffect, useState, useRef } from 'react';
import { useProductStore } from '../stores/useProductStore';
import { ProductForm } from '../components/products/ProductForm';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Button, Badge, Card, Input, Select, PageHeader } from '../components/ui';
import { PRODUCT_STATUS_BADGE, stockLevelClass } from '../components/ui/statusMaps';
import { toast } from '../stores/useToastStore';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Product } from '../repositories/ProductRepository';

interface CategoryOption {
  id: string;
  name: string;
}

// Layout de la liste produits en CSS Grid (§3.4) : les mêmes colonnes
// grid-template-columns, partagées par l'en-tête et les lignes virtualisées,
// garantissent l'alignement et le tronquage (nowrap + ellipsis) sans les
// aléas de `<table>` + `<tbody style="display:block">` (largeur effondrée).

export const ProductsPage: React.FC = () => {
  const { products, loadProducts, isLoading, searchQuery, setSearchQuery, archiveProduct, activateProduct, disableProduct, deleteProduct } = useProductStore();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{
    title: string;
    message: React.ReactNode;
    danger?: boolean;
    confirmLabel: string;
    action: () => void;
  } | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [imageCache, setImageCache] = useState<Record<string, string>>({});

  // Phase 5 — chargement des images à la demande (lazy) : on ne charge que les
  // images visibles (celles rendues par le virtualizer), jamais tout le catalogue.
  const getProductImage = (imagePath: string | null | undefined): string => {
    if (!imagePath) return '';
    if (imageCache[imagePath]) return imageCache[imagePath];
    // Lancer le chargement sans bloquer le rendu
    window.api.products.getImageBase64(imagePath).then((r: any) => {
      if (r && r.success && r.dataUrl) {
        setImageCache(prev => ({ ...prev, [imagePath]: r.dataUrl }));
      }
    }).catch(() => {});
    return '';
  };

  const filteredProducts = categoryFilter
    ? products.filter(p => p.category_id === categoryFilter)
    : products;

  const rowVirtualizer = useVirtualizer({
    count: filteredProducts.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 61,
    overscan: 5,
  });

  useEffect(() => {
    loadProducts();
    window.api.categories.getAll().then((cats: Array<{ id: string; name: string }>) => {
      setCategories((cats ?? []).map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })));
    }).catch(() => {});

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

  const handleArchive = (product: Product) => {
    setPendingConfirm({
      title: 'Archiver ce produit ?',
      message: (
        <>
          Le produit <strong>{product.designation}</strong> ({product.reference}) sera masqué des recherches de vente.
          <br />Vous pourrez le réactiver à tout moment.
        </>
      ),
      confirmLabel: 'Archiver',
      action: async () => {
        try { await archiveProduct(product.id); toast.success(`Produit « ${product.designation} » archivé.`); } catch (e: any) { toast.error(e.message); }
      },
    });
  };

  const handleActivate = async (product: Product) => {
    try { await activateProduct(product.id); toast.success(`Produit « ${product.designation} » réactivé.`); } catch (e: any) { toast.error(e.message); }
  };

  const handleDisable = (product: Product) => {
    setPendingConfirm({
      title: 'Désactiver ce produit ?',
      message: (
        <>
          Le produit <strong>{product.designation}</strong> ({product.reference}) restera visible mais sera retiré de la vente.
        </>
      ),
      confirmLabel: 'Désactiver',
      action: async () => {
        try { await disableProduct(product.id); toast.success(`Produit « ${product.designation} » désactivé.`); } catch (e: any) { toast.error(e.message); }
      },
    });
  };

  const handleDelete = (product: Product) => {
    setPendingConfirm({
      title: 'Suppression définitive',
        message: (
          <>
            Supprimer <strong>{product.designation}</strong> ({product.reference}) ?
            <br /><span className="text-danger font-semibold">Cette action est irréversible.</span>
            <br />Son historique de stock (mouvements, solde) sera également supprimé.
            <br />Les produits liés à des factures, inventaires, commandes d'achat ou avoirs restent bloqués (utilisez « Archiver »).
          </>
        ),
      danger: true,
      confirmLabel: 'Supprimer définitivement',
      action: async () => {
        try { await deleteProduct(product.id); toast.success(`Produit « ${product.designation} » supprimé.`); } catch (e: any) { toast.error(e.message); }
      },
    });
  };

  const handlePrintLabels = async () => {
    if (filteredProducts.length === 0) { toast.warning('Aucun produit à imprimer.'); return; }
    try {
      const result = await window.api.products.printLabels(filteredProducts.map(p => p.id));
      if (!result.success) throw new Error(result.error);
      toast.success(`Étiquettes générées pour ${filteredProducts.length} produit(s).`);
    } catch (e: any) { toast.error(e.message); }
  };

  const openNewProductForm = () => {
    setIsFormOpen(true);
    setEditingProduct(null);
  };

  return (
    <div className="page-shell">
      <PageHeader
        title="Gestion des Produits"
        actions={
          <Button size="lg" onClick={openNewProductForm}>
            + Nouveau Produit (F8)
          </Button>
        }
      />

      <div className="page-content">
        <div className="flex gap-3 items-center">
          <div className="flex-1" style={{ flex: 2 }}>
            <Input
              id="product-search"
              type="text"
              placeholder="Rechercher par référence, désignation ou code-barres... (Ctrl+F)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              inputSize="lg"
            />
          </div>
          <div className="flex-1">
            <Select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
              <option value="">🏷️ Toutes les catégories</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <Button variant="success" size="lg" onClick={handlePrintLabels} style={{ whiteSpace: 'nowrap' }}>
            🖨️ Imprimer Étiquettes
          </Button>
        </div>

        <Card overflow className="flex-1" style={{ display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 220px)' }}>
          <div ref={parentRef} style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', position: 'relative' }}>
            {isLoading ? (
              <div className="state-box">
                <div className="state-text">Chargement ultra-rapide en cours...</div>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="state-box">
                <div className="state-text">Aucun produit trouvé</div>
              </div>
            ) : (
              <div style={{ position: 'relative' }}>
                <div className="pdg-grid pdg-header" style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                  <div>Image</div>
                  <div>Réf</div>
                  <div>Désignation</div>
                  <div>Unité</div>
                  <div>Stock</div>
                  <div>Prix Vente</div>
                  <div>Marge</div>
                  <div>Statut</div>
                  <div>Actions</div>
                </div>
                <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const p = filteredProducts[virtualRow.index];
                    const stock = p.current_stock ?? 0;
                    const margin = p.selling_price - p.purchase_price;
                    const statusBadge = PRODUCT_STATUS_BADGE[p.status] ?? { label: p.status, variant: 'muted' as const };
                    // Lazy-load : seule l'image du produit visible est demandée.
                    const imgSrc = getProductImage(p.image_path);
                    return (
                      <div
                        key={virtualRow.index}
                        className="pdg-grid pdg-row"
                        style={{
                          position: 'absolute', top: 0, left: 0, width: '100%',
                          height: `${virtualRow.size}px`, transform: `translateY(${virtualRow.start}px)`,
                          cursor: 'pointer',
                        }}
                      >
                        <div>
                          {imgSrc
                            ? <img src={imgSrc} alt="" style={{ width: 40, height: 40, borderRadius: 'var(--radius-sm)', objectFit: 'cover', border: '1px solid var(--border)' }} />
                            : <div className="surface-muted text-muted" style={{ width: 40, height: 40, borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, padding: 0 }}>📦</div>
                          }
                        </div>
                        <div className="font-semibold">{p.reference}</div>
                        <div>{p.designation}</div>
                        <div className="text-sm text-secondary">{p.unit || 'PIÈCE'}</div>
                        <div className={`font-semibold ${stockLevelClass(stock, p.min_stock)}`}>
                          {stock} {p.min_stock > 0 && stock <= p.min_stock && '⚠️'}
                        </div>
                        <div className="money font-semibold">{p.selling_price.toFixed(2)} MAD</div>
                        <div className={`money text-sm font-semibold ${margin >= 0 ? 'text-success' : 'text-danger'}`}>
                          {margin.toFixed(2)} MAD
                        </div>
                        <div><Badge variant={statusBadge.variant}>{statusBadge.label}</Badge></div>
                        <div>
                          <div className="flex gap-2">
                            <Button variant="secondary" size="sm" onClick={() => handleEdit(p)}>✏️</Button>
                            {p.status === 'ACTIVE' ? (
                              <>
                                <Button variant="secondary" size="sm" onClick={() => handleDisable(p)} title="Désactiver">⛔</Button>
                                <Button variant="secondary" size="sm" onClick={() => handleArchive(p)} title="Archiver">🗄️</Button>
                              </>
                            ) : (
                              <Button variant="success" size="sm" onClick={() => handleActivate(p)} title="Réactiver">✅</Button>
                            )}
                            <Button variant="danger" size="sm" onClick={() => handleDelete(p)} title="Supprimer">🗑️</Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>

      {isFormOpen && (
        <ProductForm onClose={() => { setIsFormOpen(false); setEditingProduct(null); }} editingProduct={editingProduct ?? undefined} />
      )}

      {pendingConfirm && (
        <ConfirmDialog
          open
          title={pendingConfirm.title}
          message={pendingConfirm.message}
          danger={pendingConfirm.danger}
          confirmLabel={pendingConfirm.confirmLabel}
          onConfirm={() => {
            pendingConfirm.action();
            setPendingConfirm(null);
          }}
          onCancel={() => setPendingConfirm(null)}
        />
      )}
    </div>
  );
};
