import React, { useEffect, useState } from 'react';
import { z } from 'zod';
import { useProductStore } from '../../stores/useProductStore';
import type { Product } from '../../repositories/ProductRepository';

const UNITS = ['PIÈCE', 'KG', 'LITRE', 'CARTON', 'PALETTE'];

const productSchema = z.object({
  reference: z.string().min(1, 'La référence est requise'),
  designation: z.string().min(1, 'La désignation est requise'),
  description: z.string().optional(),
  barcode: z.string().optional(),
  unit: z.string().min(1, "L'unité est requise"),
  category_id: z.string().optional(),
  subcategory_id: z.string().optional(),
  purchase_price: z.number().min(0, 'Le prix d\'achat doit être positif'),
  selling_price: z.number().min(0, 'Le prix de vente doit être positif'),
  wholesale_price: z.number().min(0, 'Le prix de gros doit être positif'),
  min_stock: z.number().min(0, 'Le stock minimum doit être positif'),
}).refine(data => data.selling_price >= data.purchase_price, {
  message: "Le prix de vente ne peut pas être inférieur au prix d'achat",
  path: ['selling_price']
});

interface Category {
  id: string;
  name: string;
  subcategories?: Array<{ id: string; category_id: string; name: string }>;
}

interface ProductFormProps {
  onClose: () => void;
  editingProduct?: Product;
}

export const ProductForm: React.FC<ProductFormProps> = ({ onClose, editingProduct }) => {
  const addProduct = useProductStore(state => state.addProduct);
  const addProductWithStock = useProductStore(state => state.addProductWithStock);
  const updateProduct = useProductStore(state => state.updateProduct);
  const updateProductWithStock = useProductStore(state => state.updateProductWithStock);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [categories, setCategories] = useState<Category[]>([]);
  const [imagePreview, setImagePreview] = useState<string>('');
  const [currentStock, setCurrentStock] = useState<number | null>(null);
  const [newStock, setNewStock] = useState<number>(0);
  const [formData, setFormData] = useState({
    reference: editingProduct?.reference ?? '',
    designation: editingProduct?.designation ?? '',
    description: editingProduct?.description ?? '',
    image_path: editingProduct?.image_path ?? '',
    barcode: editingProduct?.barcode ?? '',
    unit: editingProduct?.unit ?? 'PIÈCE',
    category_id: editingProduct?.category_id ?? '',
    subcategory_id: editingProduct?.subcategory_id ?? '',
    purchase_price: editingProduct?.purchase_price ?? 0,
    selling_price: editingProduct?.selling_price ?? 0,
    wholesale_price: editingProduct?.wholesale_price ?? 0,
    min_stock: editingProduct?.min_stock ?? 5,
    initial_stock: 0,
  });

  useEffect(() => {
    window.api.categories.getAll().then(setCategories).catch(() => {});
    if (editingProduct) {
      window.api.stock.getLevel(editingProduct.id).then((level: number) => {
        setCurrentStock(level);
        setNewStock(level);
      }).catch(() => { setCurrentStock(0); setNewStock(0); });
    }
  }, []);

  // Charger l'aperçu image en base64 quand image_path change
  useEffect(() => {
    if (formData.image_path) {
      window.api.products.getImageBase64(formData.image_path).then((result: any) => {
        if (result.success && result.dataUrl) {
          setImagePreview(result.dataUrl);
        } else {
          setImagePreview('');
        }
      }).catch(() => setImagePreview(''));
    } else {
      setImagePreview('');
    }
  }, [formData.image_path]);

  const selectedCategory = categories.find(c => c.id === formData.category_id);
  const selectedSubs = selectedCategory?.subcategories ?? [];

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'number' ? parseFloat(value) || 0 : value
    }));
  };

  const handleCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setFormData(prev => ({ ...prev, category_id: e.target.value, subcategory_id: '' }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    try {
      const payload = { ...formData, category_id: formData.category_id || undefined, subcategory_id: formData.subcategory_id || undefined };
      const validatedData = productSchema.parse(payload);

      if (editingProduct) {
        const stockAdjustment = (currentStock !== null) ? (newStock - currentStock) : 0;
        await updateProductWithStock(
          editingProduct.id,
          { ...validatedData, image_path: formData.image_path || undefined, status: editingProduct.status },
          stockAdjustment
        );
      } else {
        await addProductWithStock({ ...validatedData, image_path: formData.image_path || undefined, status: 'ACTIVE' }, formData.initial_stock || 0);
      }
      onClose();
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        const newErrors: Record<string, string> = {};
        error.errors.forEach(err => {
          if (err.path[0]) {
            newErrors[err.path[0].toString()] = err.message;
          }
        });
        setErrors(newErrors);
      } else {
        alert(error.message);
      }
    }
  };

  const inputStyle = {
    width: '100%',
    padding: '10px',
    marginBottom: '5px',
    borderRadius: '4px',
    border: '1px solid #cbd5e1',
    boxSizing: 'border-box' as const
  };

  const labelStyle = {
    display: 'block',
    marginBottom: '5px',
    fontWeight: 'bold',
    color: '#334155'
  };

  const errorStyle = {
    color: '#ef4444',
    fontSize: '14px',
    marginBottom: '15px',
    display: 'block'
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000
    }}>
      <div style={{
        backgroundColor: 'white',
        padding: '30px',
        borderRadius: '8px',
        width: '560px',
        maxHeight: '90vh',
        overflowY: 'auto'
      }}>
        <h2 style={{ marginTop: 0, marginBottom: '20px' }}>{editingProduct ? 'Modifier le Produit' : 'Nouveau Produit'}</h2>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '15px' }}>
            <label style={labelStyle}>Référence *</label>
            <input type="text" name="reference" value={formData.reference} onChange={handleChange} style={inputStyle} />
            {errors.reference && <span style={errorStyle}>{errors.reference}</span>}
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={labelStyle}>Désignation *</label>
            <input type="text" name="designation" value={formData.designation} onChange={handleChange} style={inputStyle} />
            {errors.designation && <span style={errorStyle}>{errors.designation}</span>}
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={labelStyle}>Image du produit</label>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              {imagePreview && <img src={imagePreview} alt="preview" style={{ width: '60px', height: '60px', objectFit: 'cover', borderRadius: '8px', border: '1px solid #e5e7eb' }} />}
              <button type="button" onClick={async () => { const r = await window.api.products.pickImage(); if (r.success && r.path) setFormData(pr => ({ ...pr, image_path: r.path })); }} style={{ padding: '10px 16px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer' }}>Choisir image</button>
              {formData.image_path && <button type="button" onClick={() => setFormData(pr => ({ ...pr, image_path: '' }))} style={{ padding: '6px 12px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '6px', cursor: 'pointer' }}>Supprimer</button>}
            </div>
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={labelStyle}>Description</label>
            <textarea name="description" value={formData.description} onChange={handleChange} placeholder="Description du produit (optionnel)"
              style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} />
          </div>

          <div style={{ display: 'flex', gap: '15px', marginBottom: '15px' }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Code-barres</label>
              <input type="text" name="barcode" value={formData.barcode} onChange={handleChange} style={inputStyle} />
              {errors.barcode && <span style={errorStyle}>{errors.barcode}</span>}
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Unité *</label>
              <select name="unit" value={formData.unit} onChange={handleChange} style={inputStyle}>
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
              {errors.unit && <span style={errorStyle}>{errors.unit}</span>}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '15px', marginBottom: '15px' }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Catégorie</label>
              <select name="category_id" value={formData.category_id} onChange={handleCategoryChange} style={inputStyle}>
                <option value="">— Aucune —</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Sous-catégorie</label>
              <select name="subcategory_id" value={formData.subcategory_id} onChange={handleChange} style={inputStyle} disabled={selectedSubs.length === 0}>
                <option value="">— Aucune —</option>
                {selectedSubs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '15px', marginBottom: '15px' }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Prix d'Achat</label>
              <input type="number" step="0.01" name="purchase_price" value={formData.purchase_price} onChange={handleChange} style={inputStyle} />
              {errors.purchase_price && <span style={errorStyle}>{errors.purchase_price}</span>}
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Prix de Vente</label>
              <input type="number" step="0.01" name="selling_price" value={formData.selling_price} onChange={handleChange} style={inputStyle} />
              {errors.selling_price && <span style={errorStyle}>{errors.selling_price}</span>}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '15px', marginBottom: '15px' }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Prix de Gros</label>
              <input type="number" step="0.01" name="wholesale_price" value={formData.wholesale_price} onChange={handleChange} style={inputStyle} />
              {errors.wholesale_price && <span style={errorStyle}>{errors.wholesale_price}</span>}
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Stock Minimum</label>
              <input type="number" name="min_stock" value={formData.min_stock} onChange={handleChange} style={inputStyle} />
              {errors.min_stock && <span style={errorStyle}>{errors.min_stock}</span>}
            </div>
          </div>

          {editingProduct ? (
            <div style={{ marginBottom: '20px', padding: '15px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>📦 Stock Initial</label>
                  <input
                    type="number"
                    value={newStock}
                    onChange={(e) => setNewStock(parseInt(e.target.value) || 0)}
                    style={inputStyle}
                  />
                </div>
              </div>
              <span style={{ fontSize: '13px', color: '#6b7280' }}>
                Stock actuel : {currentStock !== null ? currentStock : '...'} — Modifier pour ajuster le stock
              </span>
            </div>
          ) : (
            <div style={{ marginBottom: '20px' }}>
              <label style={labelStyle}>Stock Initial</label>
              <input type="number" name="initial_stock" value={formData.initial_stock} onChange={handleChange} style={inputStyle} />
              <span style={{ fontSize: '13px', color: '#6b7280' }}>Quantité en stock au moment de la création (optionnel)</span>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button type="button" onClick={onClose} style={{
              padding: '10px 20px', borderRadius: '4px', border: '1px solid #cbd5e1', backgroundColor: 'white', cursor: 'pointer'
            }}>Annuler</button>
            <button type="submit" style={{
              padding: '10px 20px', borderRadius: '4px', border: 'none', backgroundColor: '#2563eb', color: 'white', fontWeight: 'bold', cursor: 'pointer'
            }}>{editingProduct ? 'Enregistrer les modifications' : 'Enregistrer'}</button>
          </div>
        </form>
      </div>
    </div>
  );
};
