import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/database/config/connection';
import { DocumentService } from '../src/services/DocumentService';
import { ProductService } from '../src/services/ProductService';
import type { ProductInput } from '../src/repositories/ProductRepository';
import { StockService } from '../src/services/StockService';
import { ClientRepository } from '../src/repositories/ClientRepository';
import { ExpenseRepository } from '../src/repositories/ExpenseRepository';
import { ProfitService } from '../src/services/ProfitService';

/**
 * §Phase 12 — Marge brute et résultat estimé.
 *
 *   Marge brute     = CA HT − coût des marchandises vendues
 *   Résultat estimé = marge brute − dépenses
 *
 * Les avoirs sont nets : un retour annule la vente ET sa marge.
 *
 * NOTE métier : `ProductService` refuse un prix de vente inférieur au prix
 * d'achat. Une « vente à perte » est donc simulée au niveau de la LIGNE de
 * facture (prix de ligne sous le coût), jamais du catalogue produit.
 */

function clean(): void {
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec(`
    DELETE FROM credit_note_refs;
    DELETE FROM payments;
    DELETE FROM document_items;
    DELETE FROM stock_movements;
    DELETE FROM price_history;
    DELETE FROM product_batches;
    DELETE FROM unit_conversions;
    DELETE FROM documents;
    DELETE FROM client_credits;
    DELETE FROM supplier_credits;
    DELETE FROM customers;
    DELETE FROM suppliers;
    DELETE FROM inventory_balances;
    DELETE FROM products;
    DELETE FROM expenses;
    DELETE FROM cash_movements;
    DELETE FROM cash_sessions;
    DELETE FROM audit_logs;
    DELETE FROM document_sequences;
  `);
  db.exec('PRAGMA foreign_keys = ON;');
}

const FROM = '2026-09-01';
const TO = '2026-09-30';

let sequence = 0;

/**
 * Vente de `qty` unités d'un produit acheté 60 et vendu 120 (TVA 0).
 * Chaque appel crée une référence unique (la référence produit est unique en base).
 */
function makeSale(qty: number, date = '2026-09-08', unitPrice = 120) {
  sequence += 1;
  const reference = `PROF-${sequence}`;

  const productInput: ProductInput = {
    reference,
    designation: `Produit Marge ${sequence}`,
    purchase_price: 60,
    selling_price: 120,
    wholesale_price: 110,
    min_stock: 0,
    unit: 'PIÈCE',
    vat_rate: 0,
    status: 'ACTIVE',
  };
  const productId = ProductService.createProduct(productInput).id;
  const customerId = ClientRepository.create({
    name: `Client Marge ${sequence}`, credit_limit: 100000, category: 'DÉTAIL',
  }).id;

  StockService.addStockEntry({ product_id: productId, quantity: qty + 50, unit_price: 60 });

  const doc = DocumentService.createDocument({
    type: 'INVOICE',
    entity_id: customerId,
    date,
    due_date: '2026-09-20',
    items: [{ product_id: productId, quantity: qty, unit_price: unitPrice, discount: 0 }],
  });

  return { productId, customerId, doc };
}

describe('§Phase 12 — Marge brute', () => {
  beforeEach(() => { clean(); });

  it('marge brute = CA HT − coût des marchandises', () => {
    makeSale(10); // CA HT 1200, coût 600

    const summary = ProfitService.getSummary(FROM, TO);
    expect(summary.revenueExclTax).toBe(1200);
    expect(summary.costOfGoods).toBe(600);
    expect(summary.grossMargin).toBe(600);
    expect(summary.expenses).toBe(0);
    expect(summary.estimatedResult).toBe(600);
    expect(summary.marginRate).toBe(50);
    expect(summary.salesCount).toBe(1);
  });

  it('les dépenses réduisent le résultat estimé sans toucher la marge brute', () => {
    makeSale(10);
    // Dépense hors espèces : aucune caisse requise.
    ExpenseRepository.create({ category: 'Loyer', amount: 200, paymentMethod: 'TRANSFER', date: '2026-09-10' });

    const summary = ProfitService.getSummary(FROM, TO);
    expect(summary.grossMargin).toBe(600); // inchangée
    expect(summary.expenses).toBe(200);
    expect(summary.estimatedResult).toBe(400);
  });

  it('un avoir annule la vente et sa marge', () => {
    const { doc, productId } = makeSale(10);
    // Retour de 4 unités → la vente nette devient 6 unités.
    DocumentService.createCreditNote(doc.id, [{ product_id: productId, quantity: 4 }], 'Retour client');

    const afterReturn = ProfitService.getSummary(FROM, TO);
    expect(afterReturn.revenueExclTax).toBe(720); // 6 × 120
    expect(afterReturn.costOfGoods).toBe(360);    // 6 × 60
    expect(afterReturn.grossMargin).toBe(360);
  });

  it('plusieurs ventes sur la période s\'additionnent', () => {
    makeSale(10, '2026-09-02');
    makeSale(5, '2026-09-03');

    const summary = ProfitService.getSummary(FROM, TO);
    expect(summary.revenueExclTax).toBe(1800); // 15 × 120
    expect(summary.costOfGoods).toBe(900);
    expect(summary.grossMargin).toBe(900);
    expect(summary.salesCount).toBe(2);
  });

  it('une vente hors période n\'est pas comptée', () => {
    makeSale(10, '2026-08-15');

    const summary = ProfitService.getSummary(FROM, TO);
    expect(summary.revenueExclTax).toBe(0);
    expect(summary.grossMargin).toBe(0);
    expect(summary.marginRate).toBe(0);
  });

  it('une marge négative (ligne vendue sous le coût) est rapportée telle quelle', () => {
    // Produit au catalogue valide (achat 60 / vente 120), facturé 20 l'unité :
    // la perte est portée par la LIGNE de facture, pas par le produit.
    makeSale(2, '2026-09-05', 20);

    const summary = ProfitService.getSummary(FROM, TO);
    expect(summary.revenueExclTax).toBe(40);   // 2 × 20
    expect(summary.costOfGoods).toBe(120);     // 2 × 60
    expect(summary.grossMargin).toBe(-80);     // 40 − 120
    expect(summary.estimatedResult).toBe(-80);
  });

  it('refuse un intervalle de dates incomplet', () => {
    expect(() => ProfitService.getSummary('', TO)).toThrow();
    expect(() => ProfitService.getSummary(FROM, '')).toThrow();
  });
});
