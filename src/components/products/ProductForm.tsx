import React, { useState } from 'react';
import { z } from 'zod';
import { useProductStore } from '../../stores/useProductStore';

const productSchema = z.object({
  reference: z.string().min(1, 'La référence est requise'),
  designation: z.string().min(1, 'La désignation est requise'),
  barcode: z.string().optional(),
  purchase_price: z.number().min(0, 'Le prix d\'achat doit être positif'),
  selling_price: z.number().min(0, 'Le prix de vente doit être positif'),
  wholesale_price: z.number().min(0, 'Le prix de gros doit être positif'),
  min_stock: z.number().min(0, 'Le stock minimum doit être positif'),
}).refine(data => data.selling_price >= data.purchase_price, {
  message: "Le prix de vente ne peut pas être inférieur au prix d'achat",
  path: ['selling_price']
});

interface ProductFormProps {
  onClose: () => void;
}

export const ProductForm: React.FC<ProductFormProps> = ({ onClose }) => {
  const addProduct = useProductStore(state => state.addProduct);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState({
    reference: '',
    designation: '',
    barcode: '',
    purchase_price: 0,
    selling_price: 0,
    wholesale_price: 0,
    min_stock: 5,
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'number' ? parseFloat(value) || 0 : value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    
    try {
      // Validation Zod
      const validatedData = productSchema.parse(formData);
      
      // Appel de la création
      await addProduct({ ...validatedData, status: 'ACTIVE' });
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
        width: '500px',
        maxHeight: '90vh',
        overflowY: 'auto'
      }}>
        <h2 style={{ marginTop: 0, marginBottom: '20px' }}>Nouveau Produit</h2>
        
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
            <label style={labelStyle}>Code-barres</label>
            <input type="text" name="barcode" value={formData.barcode} onChange={handleChange} style={inputStyle} />
            {errors.barcode && <span style={errorStyle}>{errors.barcode}</span>}
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

          <div style={{ display: 'flex', gap: '15px', marginBottom: '20px' }}>
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

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button type="button" onClick={onClose} style={{
              padding: '10px 20px', borderRadius: '4px', border: '1px solid #cbd5e1', backgroundColor: 'white', cursor: 'pointer'
            }}>Annuler</button>
            <button type="submit" style={{
              padding: '10px 20px', borderRadius: '4px', border: 'none', backgroundColor: '#2563eb', color: 'white', fontWeight: 'bold', cursor: 'pointer'
            }}>Enregistrer</button>
          </div>
        </form>
      </div>
    </div>
  );
};
