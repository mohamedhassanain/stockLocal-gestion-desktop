import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../src/database/config/connection';
import { ProductRepository, type Product } from '../src/repositories/ProductRepository';
import { ClientRepository } from '../src/repositories/ClientRepository';
import { UnitConversionRepository } from '../src/repositories/UnitConversionRepository';
import { DocumentService } from '../src/services/DocumentService';
import { StockLedgerService } from '../src/services/StockLedgerService';
import { toBaseQuantity, toBaseUnitPrice } from '../src/utils/unitSale';

/**
 * Phase 6 — Conversions d'unités.
 *
 * 1) Arithmétique pure (application du facteur, préservation du total) ;
 * 2) Résolution du facteur par le BACKEND (`UnitConversionRepository.convert`),
 *    dans les deux sens, et absence de conversion → facteur 1 ;
 * 3) Bout-en-bout : vendre en unité alternative décrémente le stock en unité de
 *    base du montant exact (24 pièces pour 2 cartons ×12) ;
 * 4) Un produit sans conversion se comporte comme avant (stocker = unité de base).
 */

const P = 'UCONV_';
const productIds: string[] = [];
const docIds: string[] = [];
let clientId = '';

function inClause(ids: string[]): string {
  return ids.length === 0 ? '' : ` IN (${ids.map(() => '?').join(',')})`;
}

function cleanup(): void {
  const del = (sql: string, ids: string[]) => { if (ids.length > 0) db.prepare(sql).run(...ids); };
  del(`DELETE FROM stock_movements WHERE document_id${inClause(docIds)}`, docIds);
  del(`DELETE FROM document_items WHERE document_id${inClause(docIds)}`, docIds);
  del(`DELETE FROM documents WHERE id${inClause(docIds)}`, docIds);
  del(`DELETE FROM unit_conversions WHERE product_id${inClause(productIds)}`, productIds);
  del(`DELETE FROM stock_movements WHERE product_id${inClause(productIds)}`, productIds);
  del(`DELETE FROM inventory_balances WHERE product_id${inClause(productIds)}`, productIds);
  del(`DELETE FROM products WHERE id${inClause(productIds)}`, productIds);
  if (clientId) {
    del(`DELETE FROM documents WHERE entity_id${inClause([clientId])}`, [clientId]);
    db.prepare('DELETE FROM customers WHERE id = ?').run(clientId);
  }
  productIds.length = 0;
  docIds.length = 0;
  clientId = '';
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

function seedClient(): string {
  const client = ClientRepository.create({
    name: 'Client Unité Test', phone: '0600000000', address: 'Casablanca',
    ice: '', payment_conditions: '', credit_limit: 0, category: 'DÉTAIL',
  });
  clientId = client.id;
  return client.id;
}

describe('Phase 6 — Arithmétique de conversion', () => {
  it('convertit la quantité et le prix en préservant le total de ligne', () => {
    const baseQty = toBaseQuantity(2, 12);        // 2 cartons → 24 pièces
    const basePrice = toBaseUnitPrice(300, 12);   // 300 MAD le carton → 25 MAD la pièce
    expect(baseQty).toBe(24);
    expect(basePrice).toBe(25);
    expect(2 * 300).toBe(baseQty * basePrice);    // total préservé
  });

  it('facteur 1 → comportement inchangé (aucune conversion)', () => {
    expect(toBaseQuantity(5, 1)).toBe(5);
    expect(toBaseUnitPrice(50, 1)).toBe(50);
  });
});

describe('Phase 6 — Facteur résolu par le backend (convert)', () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it('résout le facteur dans les deux sens', () => {
    const p = seedProduct('UCONV-A', 'PIÈCE');
    UnitConversionRepository.create({ from_unit: 'CARTON', to_unit: 'PIÈCE', factor: 12, product_id: p.id });

    expect(UnitConversionRepository.convert(1, 'CARTON', 'PIÈCE', p.id)).toBe(12);
    expect(UnitConversionRepository.convert(12, 'PIÈCE', 'CARTON', p.id)).toBe(1);
    expect(UnitConversionRepository.convert(7, 'PIÈCE', 'PIÈCE', p.id)).toBe(7);
  });

  it('retourne null quand aucune conversion n\'existe', () => {
    const p = seedProduct('UCONV-B', 'PIÈCE');
    expect(UnitConversionRepository.convert(1, 'CARTON', 'PIÈCE', p.id)).toBeNull();
  });
});

describe('Phase 6 — Vente en unité alternative (bout-en-bout)', () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it('vendre 2 CARTONS (×12) décrémente le stock de 24 PIÈCES', () => {
    const client = seedClient();
    const p = seedProduct('UCONV-E2E', 'PIÈCE');
    StockLedgerService.recordMovement({ product_id: p.id, movement_type: 'PURCHASE_IN', quantity: 100, unit_price: 5 });
    UnitConversionRepository.create({ from_unit: 'CARTON', to_unit: 'PIÈCE', factor: 12, product_id: p.id });

    expect(StockLedgerService.getStockLevel(p.id)).toBe(100);

    // Reproduit EXACTEMENT le mapping du POS : facteur via convert (backend).
    const factor = UnitConversionRepository.convert(1, 'CARTON', 'PIÈCE', p.id) ?? 1; // 12
    const cartonPrice = 300;
    const baseQty = toBaseQuantity(2, factor);            // 24
    const basePrice = toBaseUnitPrice(cartonPrice, factor); // 25

    const invoice = DocumentService.createDocument({
      type: 'INVOICE',
      entity_id: client,
      date: new Date().toISOString().slice(0, 10),
      items: [{ product_id: p.id, quantity: baseQty, unit_price: basePrice, discount: 0 }],
    });
    docIds.push(invoice.id);

    // Stock : 100 − 24 = 76 (décrément en unité de base).
    expect(StockLedgerService.getStockLevel(p.id)).toBe(76);
    // Total de la ligne identique à la vente au prix carton (2 × 300).
    expect(invoice.total_excl_tax).toBeCloseTo(600, 2);
  });

  it('produit sans conversion : vend dans l\'unité de base, stock décrémenté à l\'identique', () => {
    const client = seedClient();
    const p = seedProduct('UCONV-NONE', 'PIÈCE');
    StockLedgerService.recordMovement({ product_id: p.id, movement_type: 'PURCHASE_IN', quantity: 50, unit_price: 5 });

    // Aucune conversion définie → convert renvoie null → facteur 1 (inchangé).
    const factor = UnitConversionRepository.convert(1, 'CARTON', 'PIÈCE', p.id) ?? 1;
    expect(factor).toBe(1);

    const baseQty = toBaseQuantity(3, factor); // 3
    const invoice = DocumentService.createDocument({
      type: 'INVOICE',
      entity_id: client,
      date: new Date().toISOString().slice(0, 10),
      items: [{ product_id: p.id, quantity: baseQty, unit_price: 10, discount: 0 }],
    });
    docIds.push(invoice.id);

    expect(StockLedgerService.getStockLevel(p.id)).toBe(47);
  });
});
