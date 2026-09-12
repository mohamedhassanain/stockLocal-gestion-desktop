import React, { useEffect, useState } from 'react';
import { Button, Input, Modal, ModalHeader, ModalBody, ModalFooter } from '../ui';
import { toast } from '../../stores/useToastStore';
import type { Product } from '../../repositories/ProductRepository';

/**
 * Phase 6 — Conversions d'unités par produit (`unit_conversions`).
 * Ex. : 1 CARTON = 12 PIÈCES. La vente en unité alternative (POS) décrémente
 * le stock en unité de base via ces règles.
 */

interface UnitConversion {
  id: string;
  from_unit: string;
  to_unit: string;
  factor: number;
  product_id: string | null;
}

interface Props {
  product: Product;
  onClose: () => void;
}

export const ProductUnitConversionsModal: React.FC<Props> = ({ product, onClose }) => {
  const baseUnit = product.unit || 'PIÈCE';
  const [conversions, setConversions] = useState<UnitConversion[]>([]);
  const [fromUnit, setFromUnit] = useState('');
  const [factor, setFactor] = useState<number>(1);
  const [availableUnits, setAvailableUnits] = useState<string[]>([]);

  const load = async () => {
    try {
      const list = await window.api.conversions.getByProduct(product.id);
      // On n'affiche que les règles propres à ce produit ou génériques.
      setConversions((list ?? []) as UnitConversion[]);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    load();
    window.api.globalSettings.get().then((gs: { product_units?: string[] }) => {
      setAvailableUnits((gs?.product_units ?? []).filter(u => u !== baseUnit));
    }).catch(() => {});
  }, []);

  const handleAdd = async () => {
    const unit = fromUnit.trim().toUpperCase();
    if (!unit) { toast.warning('Sélectionnez ou saisissez une unité.'); return; }
    if (!Number.isFinite(factor) || factor <= 0) { toast.warning('Le facteur doit être supérieur à 0.'); return; }
    try {
      const result = await window.api.conversions.create({ from_unit: unit, to_unit: baseUnit, factor, product_id: product.id });
      if (!result.success) throw new Error(result.error);
      toast.success(`Conversion ajoutée : 1 ${unit} = ${factor} ${baseUnit}.`);
      setFromUnit('');
      setFactor(1);
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const result = await window.api.conversions.delete(id);
      if (!result.success) throw new Error(result.error);
      toast.success('Conversion supprimée.');
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const ownConversions = conversions.filter(c => c.product_id === product.id);

  return (
    <Modal open onClose={onClose} width={560}>
      <ModalHeader
        icon="🔢"
        title="Conversions d'unités"
        subtitle={`${product.reference} — ${product.designation} (unité de base : ${baseUnit})`}
      />
      <ModalBody>
        <div className="flex gap-2 items-end">
          <div style={{ flex: 1 }}>
            <Input
              label="Unité alternative"
              list="unit-suggestions"
              value={fromUnit}
              onChange={e => setFromUnit(e.target.value.toUpperCase())}
              placeholder="Ex : CARTON"
            />
            <datalist id="unit-suggestions">
              {availableUnits.map(u => <option key={u} value={u} />)}
            </datalist>
          </div>
          <div style={{ width: 140 }}>
            <Input
              label={`= ${baseUnit}`}
              type="number"
              min={0}
              step="0.01"
              value={factor}
              onChange={e => setFactor(Number(e.target.value))}
            />
          </div>
          <Button variant="success" onClick={handleAdd}>+ Ajouter</Button>
        </div>

        <div style={{ marginTop: 'var(--space-4)' }}>
          {ownConversions.length === 0 ? (
            <div className="text-sm text-muted">Aucune conversion définie pour ce produit.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Conversion</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {ownConversions.map(c => (
                  <tr key={c.id}>
                    <td>1 <strong>{c.from_unit}</strong> = <strong>{c.factor}</strong> {c.to_unit}</td>
                    <td style={{ textAlign: 'right' }}>
                      <Button variant="danger" size="sm" onClick={() => handleDelete(c.id)} title="Supprimer">🗑️</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Fermer</Button>
      </ModalFooter>
    </Modal>
  );
};
