import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/database/config/connection';
import { StockLedgerService } from '../src/services/StockLedgerService';
import { ProductService } from '../src/services/ProductService';
import { ClientRepository } from '../src/repositories/ClientRepository';
import { DocumentService } from '../src/services/DocumentService';
import { ProfitService } from '../src/services/ProfitService';
import { WarehouseRepository } from '../src/repositories/WarehouseRepository';
import { todayDateOnly } from '../src/utils/date';
import type { ProductInput } from '../src/repositories/ProductRepository';

/**
 * §CMUP — Coût Moyen Unitaire Pondéré (moyenne pondérée MOBILE / perpétuelle).
 *
 * Règle métier vérifiée (source de vérité : StockLedgerService.recordMovement) :
 *
 *   CMUP(nouveau) = ( qty_en_main × CMUP(ancien) + qty_entrée × coût_entrée )
 *                   / ( qty_en_main + qty_entrée )
 *
 *   - une SORTIE ne modifie JAMAIS le CMUP (les unités sortent au coût moyen) ;
 *   - une ENTRÉE sans coût explicite est valorisée au CMUP courant (jamais 0) ;
 *   - un TRANSFERT entre dépôts reporte le coût de la source : la valeur totale
 *     du stock (tous dépôts) reste INCHANGÉE.
 *
 * Invariant comptable : COGS + valeur du stock restant = coût des biens acquis.
 */

function clean(): void {
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec(`
    DELETE FROM credit_note_refs;
    DELETE FROM client_credits;
    DELETE FROM payments;
    DELETE FROM document_items;
    DELETE FROM stock_transfers;
    DELETE FROM stock_movements;
    DELETE FROM documents;
    DELETE FROM inventory_balances;
    DELETE FROM customers;
    DELETE FROM product_batches;
    DELETE FROM products;
  `);
  db.exec('PRAGMA foreign_keys = ON;');
}

let sequence = 0;

function createProduct(purchase = 10, selling = 20): string {
  sequence += 1;
  const input: ProductInput = {
    reference: `CMUP-${sequence}`,
    designation: `Produit CMUP ${sequence}`,
    purchase_price: purchase,
    selling_price: selling,
    wholesale_price: selling,
    min_stock: 0,
    unit: 'PIÈCE',
    vat_rate: 0,
    status: 'ACTIVE',
  };
  return ProductService.createProduct(input).id;
}

/** CMUP exposé (arrondi à la précision monétaire) pour un dépôt ou consolidé. */
function averageCost(productId: string, warehouseId?: string): number {
  return StockLedgerService.getAverageCost(productId, warehouseId);
}

/** Quantité restante, pour un dépôt précis ou consolidée. */
function quantity(productId: string, warehouseId?: string): number {
  return StockLedgerService.getStockLevel(productId, warehouseId);
}

/** Valeur du stock d'un produit (quantité × CMUP), par dépôt. */
function productValue(productId: string, warehouseId?: string): number {
  const rows = (warehouseId
    ? db.prepare('SELECT quantity, average_cost FROM inventory_balances WHERE product_id = ? AND warehouse_id = ?').all(productId, warehouseId)
    : db.prepare('SELECT quantity, average_cost FROM inventory_balances WHERE product_id = ?').all(productId)) as Array<{ quantity: number; average_cost: number }>;
  return rows.reduce((sum, r) => sum + Number(r.quantity ?? 0) * Number(r.average_cost ?? 0), 0);
}

describe('§CMUP — moyenne pondérée mobile (tests A à F)', () => {
  beforeEach(() => { clean(); sequence = 0; });

  // ── TEST A ────────────────────────────────────────────────────────────────
  it('A — 100 × 10 puis 100 × 20 ⇒ CMUP = 15', () => {
    const productId = createProduct();
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 100, unit_price: 10 });
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 100, unit_price: 20 });

    expect(quantity(productId)).toBe(200);
    expect(averageCost(productId)).toBeCloseTo(15, 6);        // (1000 + 2000) / 200
    expect(productValue(productId)).toBeCloseTo(3000, 6);     // 200 × 15 = coût réellement payé
  });

  // ── TEST B ────────────────────────────────────────────────────────────────
  it('B — 100 × 10 puis 50 × 20 ⇒ CMUP = 13.333… (arrondi monétaire)', () => {
    const productId = createProduct();
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 100, unit_price: 10 });
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 50, unit_price: 20 });

    expect(quantity(productId)).toBe(150);
    // 2000 / 150 = 13.3333… → arrondi à 2 décimales (précision monétaire)
    expect(averageCost(productId)).toBeCloseTo(40 / 3, 2);
    expect(averageCost(productId)).toBe(13.33);
  });

  // ── TEST C ────────────────────────────────────────────────────────────────
  it('C — une sortie NE modifie PAS le CMUP du stock restant', () => {
    const productId = createProduct();
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 100, unit_price: 10 });
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 100, unit_price: 20 });
    expect(averageCost(productId)).toBeCloseTo(15, 6);

    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'SALE_OUT', quantity: 50, unit_price: 30 });

    expect(quantity(productId)).toBe(150);
    expect(averageCost(productId)).toBeCloseTo(15, 6);        // INCHANGÉ
    expect(productValue(productId)).toBeCloseTo(2250, 6);     // 150 × 15
  });

  // ── TEST D ────────────────────────────────────────────────────────────────
  it('D — un retour (RETURN_IN) réintègre la quantité ET la valeur AU COÛT', () => {
    const productId = createProduct(40, 70);
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 100, unit_price: 40 });
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'SALE_OUT', quantity: 10, unit_price: 70 });

    expect(quantity(productId)).toBe(90);
    expect(averageCost(productId)).toBeCloseTo(40, 6);

    // Retour de 10 unités : valorisé au COÛT (40), jamais au prix de vente (70).
    StockLedgerService.recordMovement({
      product_id: productId,
      movement_type: 'RETURN_IN',
      quantity: 10,
      unit_price: StockLedgerService.getAverageCost(productId),
    });

    expect(quantity(productId)).toBe(100);
    expect(averageCost(productId)).toBeCloseTo(40, 6);         // NON gonflé à (40×90 + 70×10)/100 = 43
    expect(productValue(productId)).toBeCloseTo(4000, 6);      // 100 × 40
  });

  // ── TEST E ────────────────────────────────────────────────────────────────
  it('E — un transfert entre dépôts NE change PAS la valeur TOTALE du stock', () => {
    const productId = createProduct(25, 40);
    const warehouseA = WarehouseRepository.create({ name: `Dépôt A ${sequence}-${Date.now()}` });
    const warehouseB = WarehouseRepository.create({ name: `Dépôt B ${sequence}-${Date.now()}` });

    StockLedgerService.recordMovement({
      product_id: productId, movement_type: 'PURCHASE_IN', quantity: 100, unit_price: 25, warehouse_id: warehouseA.id,
    });

    const valueBefore = productValue(productId);
    expect(valueBefore).toBeCloseTo(2500, 6);
    expect(quantity(productId, warehouseB.id)).toBe(0);

    StockLedgerService.transferStock({
      product_id: productId,
      from_warehouse_id: warehouseA.id,
      to_warehouse_id: warehouseB.id,
      quantity: 40,
    });

    // Quantités ventilées correctement…
    expect(quantity(productId, warehouseA.id)).toBe(60);
    expect(quantity(productId, warehouseB.id)).toBe(40);
    // …et la VALEUR TOTALE est INCHANGÉE (aucune perte ni profit de transfert).
    expect(averageCost(productId, warehouseB.id)).toBeCloseTo(25, 6);
    expect(productValue(productId)).toBeCloseTo(valueBefore, 6);
    expect(productValue(productId)).toBeCloseTo(2500, 6);
  });

  // ── TEST F ────────────────────────────────────────────────────────────────
  it('F — séquence complète (achats + ventes + retours) : quantité et valorisation finales', () => {
    const productId = createProduct(10, 30);

    // 1) 100 × 10 → CMUP 10, valeur 1000
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 100, unit_price: 10 });
    // 2) 100 × 20 → CMUP 15, valeur 3000
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 100, unit_price: 20 });
    // 3) vente 50 → quantité 150, CMUP 15 inchangé, valeur 2250
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'SALE_OUT', quantity: 50, unit_price: 30 });
    // 4) retour 20 AU COÛT 15 → quantité 170, valeur 2550, CMUP 15
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'RETURN_IN', quantity: 20, unit_price: 15 });
    // 5) nouvel achat 30 × 25 → quantité 200, valeur 3300, CMUP 16.5
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 30, unit_price: 25 });

    expect(quantity(productId)).toBe(200);
    expect(averageCost(productId)).toBeCloseTo(16.5, 6);       // 3300 / 200
    expect(productValue(productId)).toBeCloseTo(3300, 6);

    // Rejeu depuis le journal ⇒ EXACTEMENT les mêmes valeurs (idempotence).
    StockLedgerService.rebuildBalances();
    expect(quantity(productId)).toBe(200);
    expect(averageCost(productId)).toBeCloseTo(16.5, 6);
  });

  it('C-2 — après épuisement du stock, un ré-achat repart du NOUVEAU coût (pas de moyenne avec l\'historique)', () => {
    const productId = createProduct(10, 30);
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 100, unit_price: 10 });
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'SALE_OUT', quantity: 100, unit_price: 30 });
    expect(quantity(productId)).toBe(0);

    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 100, unit_price: 20 });

    // ANCIEN comportement (cumul d'achats) : (100×10 + 100×20) / 200 = 15 → FAUX.
    expect(quantity(productId)).toBe(100);
    expect(averageCost(productId)).toBeCloseTo(20, 6);
    expect(productValue(productId)).toBeCloseTo(2000, 6);
  });
});
describe('§CMUP — cohérence COGS ↔ valorisation du stock', () => {
  beforeEach(() => { clean(); sequence = 0; });

  // Bornes larges : ce test porte sur les MONTANTS, pas sur le filtrage de date.
  const FROM = '2000-01-01';
  const TO = '2099-12-31';

  it('le COGS d\'une vente = quantité × CMUP, et (stock restant + COGS) = coût d\'acquisition', () => {
    const productId = createProduct(10, 30);

    // 100 × 10 puis 100 × 20 ⇒ CMUP 15, valeur 3000.
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 100, unit_price: 10 });
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 100, unit_price: 20 });

    const customer = ClientRepository.create({ name: 'Client CMUP', credit_limit: 0, category: 'DÉTAIL' });
    const today = todayDateOnly();
    DocumentService.createDocument({
      type: 'INVOICE',
      entity_id: customer.id,
      date: today,
      due_date: today,
      items: [{ product_id: productId, quantity: 10, unit_price: 30, discount: 0 }],
    });

    // COGS = 10 × CMUP(15) = 150 — JAMAIS 10 × prix de vente(30) = 300.
    const summary = ProfitService.getSummary(FROM, TO);
    expect(summary.costOfGoods).toBeCloseTo(150, 6);

    // Valorisation du stock restant : 190 × 15 = 2850.
    expect(quantity(productId)).toBe(190);
    expect(productValue(productId)).toBeCloseTo(2850, 6);

    // INVARIANT COMPTABLE : aucun centime ne se perd ni ne se crée.
    expect(summary.costOfGoods + productValue(productId)).toBeCloseTo(3000, 6);
  });

  it('un retour de marchandise est valorisé au CMUP : COGS net et stock restent cohérents', () => {
    const productId = createProduct(60, 120);

    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 100, unit_price: 60 });

    const customer = ClientRepository.create({ name: 'Client Retour', credit_limit: 0, category: 'DÉTAIL' });
    const today = todayDateOnly();
    const doc = DocumentService.createDocument({
      type: 'INVOICE',
      entity_id: customer.id,
      date: today,
      due_date: today,
      items: [{ product_id: productId, quantity: 10, unit_price: 120, discount: 0 }],
    });

    expect(quantity(productId)).toBe(90);
    expect(ProfitService.getSummary(FROM, TO).costOfGoods).toBeCloseTo(600, 6); // 10 × 60

    // Avoir TOTAL : les 10 unités reviennent EN STOCK, au coût (60).
    DocumentService.createCreditNote(doc.id, undefined, 'Retour intégral');

    expect(quantity(productId)).toBe(100);
    expect(averageCost(productId)).toBeCloseTo(60, 6); // le retour ne gonfle PAS le CMUP
    expect(productValue(productId)).toBeCloseTo(6000, 6);
    // Le COGS net redevient 0 : tout est revenu en stock.
    expect(ProfitService.getSummary(FROM, TO).costOfGoods).toBeCloseTo(0, 6);
  });
});
