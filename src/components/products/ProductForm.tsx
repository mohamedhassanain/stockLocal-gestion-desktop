import React, { useEffect, useState } from 'react';
import { z } from 'zod';
import { useProductStore } from '../../stores/useProductStore';
import { toast } from '../../stores/useToastStore';
import { Button, Input, Select, Textarea, Modal, ModalHeader, ModalBody, ModalFooter } from '../ui';
import type { Product } from '../../repositories/ProductRepository';

const FALLBACK_UNITS = ['PIÈCE', 'KG', 'LITRE', 'CARTON', 'PALETTE'];

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
  const addProductWithStock = useProductStore(state => state.addProductWithStock);
  const updateProductWithStock = useProductStore(state => state.updateProductWithStock);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [categories, setCategories] = useState<Category[]>([]);
  const [units, setUnits] = useState<string[]>(FALLBACK_UNITS);
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
    // Unités de mesure configurables (Paramètres > Unités)
    window.api.globalSettings.get().then((gs: any) => {
      if (gs?.product_units?.length) setUnits(gs.product_units);
    }).catch(() => {});
    if (editingProduct) {
      window.api.stock.getLevel(editingProduct.id).then((level: number) => {
        setCurrentStock(level);
        setNewStock(level);
      }).catch(() => { setCurrentStock(0); setNewStock(0); });
    }
  }, []);

  // Charger l'aperçu image en base64 quand image_path change (avec debounce)
  useEffect(() => {
    if (!formData.image_path) {
      setImagePreview('');
      return;
    }
    const timeout = setTimeout(() => {
      window.api.products.getImageBase64(formData.image_path).then((result: any) => {
        if (result && result.success && result.dataUrl) {
          setImagePreview(result.dataUrl);
        } else {
          setImagePreview('');
        }
      }).catch(() => setImagePreview(''));
    }, 300);
    return () => clearTimeout(timeout);
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
        toast.error(error.message);
      }
    }
  };

  return (
    <Modal open onClose={onClose} width={640}>
      <ModalHeader
        icon={editingProduct ? '✏️' : '➕'}
        title={editingProduct ? 'Modifier le Produit' : 'Nouveau Produit'}
        subtitle={editingProduct ? 'Mettez à jour les informations du produit' : 'Ajoutez un nouveau produit à votre catalogue'}
      />
      <form onSubmit={handleSubmit}>
        <ModalBody>
          <div className="flex gap-3">
            <div style={{ flex: 1 }}>
              <Input
                label="Référence *"
                name="reference"
                value={formData.reference}
                onChange={handleChange}
                error={errors.reference}
                autoFocus
              />
            </div>
            <div style={{ flex: 1 }}>
              <Input
                label="Désignation *"
                name="designation"
                value={formData.designation}
                onChange={handleChange}
                error={errors.designation}
              />
            </div>
          </div>

          <Textarea
            label="Description"
            name="description"
            value={formData.description}
            onChange={handleChange}
            placeholder="Description du produit (optionnel)"
            rows={2}
          />

          <div className="flex gap-3">
            <div style={{ flex: 1 }}>
              <Input
                label="Code-barres"
                name="barcode"
                value={formData.barcode}
                onChange={handleChange}
                error={errors.barcode}
              />
            </div>
            <div style={{ flex: 1 }}>
              <Select
                label="Unité *"
                name="unit"
                value={formData.unit}
                onChange={handleChange}
                error={errors.unit}
              >
                {!units.includes(formData.unit) && <option value={formData.unit}>{formData.unit}</option>}
                {units.map(u => <option key={u} value={u}>{u}</option>)}
              </Select>
            </div>
          </div>

          <div className="flex gap-3">
            <div style={{ flex: 1 }}>
              <Select
                label="Catégorie"
                name="category_id"
                value={formData.category_id}
                onChange={handleCategoryChange}
              >
                <option value="">— Aucune —</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
            <div style={{ flex: 1 }}>
              <Select
                label="Sous-catégorie"
                name="subcategory_id"
                value={formData.subcategory_id}
                onChange={handleChange}
                disabled={selectedSubs.length === 0}
              >
                <option value="">— Aucune —</option>
                {selectedSubs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </div>
          </div>

          <div className="flex gap-3">
            <div style={{ flex: 1 }}>
              <Input
                label="Prix d'Achat"
                type="number"
                step="0.01"
                name="purchase_price"
                value={formData.purchase_price}
                onChange={handleChange}
                error={errors.purchase_price}
              />
            </div>
            <div style={{ flex: 1 }}>
              <Input
                label="Prix de Vente"
                type="number"
                step="0.01"
                name="selling_price"
                value={formData.selling_price}
                onChange={handleChange}
                error={errors.selling_price}
              />
            </div>
          </div>

          <div className="flex gap-3">
            <div style={{ flex: 1 }}>
              <Input
                label="Prix de Gros"
                type="number"
                step="0.01"
                name="wholesale_price"
                value={formData.wholesale_price}
                onChange={handleChange}
                error={errors.wholesale_price}
              />
            </div>
            <div style={{ flex: 1 }}>
              <Input
                label="Stock Minimum"
                type="number"
                name="min_stock"
                value={formData.min_stock}
                onChange={handleChange}
                error={errors.min_stock}
              />
            </div>
          </div>

          <div style={{ marginBottom: 'var(--space-4)' }}>
            <span className="form-label">Image du produit</span>
            <div className="flex gap-3 items-center">
              {imagePreview && (
                <img src={imagePreview} alt="preview" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }} />
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={async () => { const r = await window.api.products.pickImage(); if (r.success && r.path) setFormData(pr => ({ ...pr, image_path: r.path })); }}
              >
                Choisir image
              </Button>
              {formData.image_path && (
                <Button variant="danger" size="sm" onClick={() => setFormData(pr => ({ ...pr, image_path: '' }))}>Supprimer</Button>
              )}
            </div>
          </div>

          {editingProduct ? (
            <div className="surface-muted" style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-md)' }}>
              <Input
                label="Stock Initial (ajustement)"
                type="number"
                value={newStock}
                onChange={(e) => setNewStock(parseInt(e.target.value) || 0)}
              />
              <span className="text-sm text-muted">
                Stock actuel : {currentStock !== null ? currentStock : '...'} — Modifier pour ajuster le stock
              </span>
            </div>
          ) : (
            <Input
              label="Stock Initial"
              type="number"
              name="initial_stock"
              value={formData.initial_stock}
              onChange={handleChange}
            />
          )}
        </ModalBody>
        <ModalFooter between>
          <Button variant="secondary" onClick={onClose}>Annuler</Button>
          <Button variant="success" size="lg" type="submit">
            {editingProduct ? 'Enregistrer les modifications' : 'Enregistrer'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
};
