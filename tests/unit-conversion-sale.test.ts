import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../src/database/config/connection';
import { ProductRepository, type Product } from '../src/repositories/ProductRepository';
import { UnitConversionRepository } from '../src/repositories/UnitConversionRepository';
import { resolveUnitFactor, toBaseQuantity, toBaseUnitPrice, type SaleUnitConversion } from '../src/utils/unitSale';

/**
 * Phase 6 — Conversions d'unités.
 * Vérifie la conversion dans les DEUX sens, la préservation du total de ligne,
 * et le cas « aucune conversion » (comportement inchangé, facteur 1).
 */

const P = 'UCONV_';
const productIds: string[] = [];

function cleanup(): void {
  if (productIds.length === 0) return;
  const inClause = ` IN (${productIds.map(() => '?').join(',')})`;
  db.prepare(`DELETE FROM unit_conversions WHERE product_id${inClause}`).run(...productIds);
  db.prepare(`DELETE FROM inventory_balances WHERE product_id${inClause}`).run(...productIds);
  db.prepare(`DELETE FROM products WHERE id${inClause}`).run(...productIds);
  productIds.length = 0;
}

function seedProduct(reference: string, unit: string): Product {
  const id = `${P}${randomUUID().slice(0, 8)}`;
  ProductRepository.create({
    id,
    reference,
    designation: `Produit ${reference}`,
    description: null,
    category_id: null,
    subcategory_id: null,
    barcode: null,
    image_path: null,
    unit,
    purchase_price: 5,
    selling_price: 10,
    wholesale_price: 8,
    min_stock: 0,
    batch_managed: 0,
    status: 'ACTIVE',
  } as Product);
  productIds.push(id);
  return ProductRepository.findById(id)!;
}

const cartonToPiece: SaleUnitConversion[] = [{ from_unit: 'CARTON', to_unit: 'PIÈCE', factor: 12 }];

describe('Phase 6 — Conversions d\'unités (util)', () => {
  it('facteur 1 si l\'unité de vente est l\'unité de base', () => {
    expect(resolveUnitFactor('PIÈCE', 'PIÈCE', cartonToPiece)).toBe(1);
  });

  it('résout une conversion directe et inverse', () => {
    expect(resolveUnitFactor('PIÈCE', 'CARTON', cartonToPiece)).toBe(12);
    // Règle stockée en sens inverse : 1 PIÈCE = 1/12 CARTON.
    const inverse: SaleUnitConversion[] = [{ from_unit: 'PIÈCE', to_unit: 'CARTON', factor: 1 / 12 }];
    expect(resolveUnitFactor('PIÈCE', 'CARTON', inverse)).toBe(12);
  });

  it('retourne un facteur 1 quand aucune conversion n\'est définie (comportement inchangé)', () => {
    expect(resolveUnitFactor('PIÈCE', 'CARTON', [])).toBe(1);
    expect(toBaseQuantity(5, 1)).toBe(5);
    expect(toBaseUnitPrice(50, 1)).toBe(50);
  });

  it('convertit la quantité et le prix en préservant le total de ligne', () => {
    const factor = resolveUnitFactor('PIÈCE', 'CARTON', cartonToPiece); // 12
    const baseQty = toBaseQuantity(2, factor);          // vendre 2 cartons → 24 pièces
    const basePrice = toBaseUnitPrice(120, factor);     // 120 MAD le carton → 10 MAD la pièce
    expect(baseQty).toBe(24);
    expect(basePrice).toBe(10);
    // Total vente (2 × 120) == total stock (24 × 10).
    expect(2 * 120).toBe(baseQty * basePrice);
  });
});

describe('Phase 6 — Conversions d\'unités (repository, sens croisés)', () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it('convertit dans les deux sens via la règle en base', () => {
    const product = seedProduct('UCONV-A', 'PIÈCE');
    UnitConversionRepository.create({ from_unit: 'CARTON', to_unit: 'PIÈCE', factor: 12, product_id: product.id });

    expect(UnitConversionRepository.convert(1, 'CARTON', 'PIÈCE', product.id)).toBe(12);
    expect(UnitConversionRepository.convert(12, 'PIÈCE', 'CARTON', product.id)).toBe(1);
    // Même unité → identité.
    expect(UnitConversionRepository.convert(7, 'PIÈCE', 'PIÈCE', product.id)).toBe(7);
  });

  it('retourne null (et facteur 1) quand aucune conversion n\'existe', () => {
    const product = seedProduct('UCONV-B', 'PIÈCE');
    expect(UnitConversionRepository.convert(1, 'CARTON', 'PIÈCE', product.id)).toBeNull();
    expect(resolveUnitFactor('PIÈCE', 'CARTON', [])).toBe(1);
  });
});
