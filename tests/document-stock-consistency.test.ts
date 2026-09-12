import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/database/config/connection';
import { ClientRepository } from '../src/repositories/ClientRepository';
import { DocumentRepository } from '../src/repositories/DocumentRepository';
import { ProductService } from '../src/services/ProductService';
import { StockLedgerService } from '../src/services/StockLedgerService';
import { DocumentService } from '../src/services/DocumentService';
import { todayDateOnly, addDaysDateOnly } from '../src/utils/date';
import type { ProductInput } from '../src/repositories/ProductRepository';

/**
 * §Intégrité — Cohérence stock ↔ documents (édition / suppression / avoir).
 *
 * INVARIANT CENTRAL vérifié ici : après CHAQUE opération, le solde stocké
 * (`inventory_balances`) reste ÉGAL au journal (`stock_movements`) PENDANT LA
 * SESSION, c'est-à-dire SANS attendre le rebuild du prochain démarrage.
 *
 * Bug historique couvert (régression) :
 *   `DocumentRepository.updateDocument` / `deleteDocument` retiraient des
 *   mouvements par SQL brut SANS recalculer `inventory_balances`. Le solde
 *   stocké divergeait alors du journal jusqu'au redémarrage : une vente
 *   suivante pouvait être refusée à tort (« stock insuffisant »).
 *
 * Couvre aussi la VALORISATION d'un retour : un retour client (RETURN_IN) doit
 * être valorisé au COÛT (CMUP), jamais au prix de vente.
 */

const today = todayDateOnly();
const dueDate = addDaysDateOnly(today, 30)!;

function clean(): void {
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec(`
    DELETE FROM credit_note_refs;
    DELETE FROM client_credits;
    DELETE FROM payments;
    DELETE FROM document_items;
    DELETE FROM stock_movements;
    DELETE FROM documents;
    DELETE FROM inventory_balances;
    DELETE FROM customers;
    DELETE FROM products;
  `);
  db.exec('PRAGMA foreign_keys = ON;');
}

function createProduct(ref: string, purchase = 60, selling = 120): string {
  const input: ProductInput = {
    reference: ref,
    designation: `Produit ${ref}`,
    purchase_price: purchase,
    selling_price: selling,
    wholesale_price: selling,
    min_stock: 0,
    unit: 'PIÈCE',
    vat_rate: 20,
    status: 'ACTIVE',
  };
  return ProductService.createProduct(input).id;
}

let customerId = '';

beforeEach(() => {
  clean();
  customerId = ClientRepository.create({ name: 'Client Test Intégrité', credit_limit: 0, category: 'DÉTAIL' }).id;
});

/** Invariant : inventaire_balances == agrégat des mouvements (aucun écart). */
function expectBalancesMatchLedger(): void {
  const audit = StockLedgerService.auditBalances();
  expect(audit.discrepancyCount).toBe(0);
}

describe('§Intégrité — édition de document : stock et CMUP cohérents en session', () => {
  it('updateDocument (même produit, quantité modifiée) ne décrémente PAS deux fois', () => {
    const productId = createProduct('DOC-EDIT-QTY');
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 100, unit_price: 60 });

    const doc = DocumentService.createDocument({
      type: 'INVOICE', entity_id: customerId, date: today, due_date: dueDate,
      items: [{ product_id: productId, quantity: 10, unit_price: 120, discount: 0 }],
    });
    expect(StockLedgerService.getStockLevel(productId)).toBe(90);

    // Édition 10 → 4 : le stock doit repasser à 96, PAS à 80 (double décrément).
    DocumentService.updateDocument(doc.id, {
      entity_id: customerId, date: today, due_date: dueDate,
      items: [{ product_id: productId, quantity: 4, unit_price: 120, discount: 0 }],
    });

    expect(StockLedgerService.getStockLevel(productId)).toBe(96);
    expectBalancesMatchLedger();

    // Une vente ultérieure doit rester possible (le solde ne doit pas être faussement bas).
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'SALE_OUT', quantity: 96, unit_price: 120 });
    expect(StockLedgerService.getStockLevel(productId)).toBe(0);
    expectBalancesMatchLedger();
  });

  it('updateDocument qui REMPLACE le produit restaure le stock de l\'ancien produit', () => {
    const productA = createProduct('DOC-EDIT-A');
    const productB = createProduct('DOC-EDIT-B');
    StockLedgerService.recordMovement({ product_id: productA, movement_type: 'PURCHASE_IN', quantity: 100, unit_price: 60 });
    StockLedgerService.recordMovement({ product_id: productB, movement_type: 'PURCHASE_IN', quantity: 50, unit_price: 60 });

    const doc = DocumentService.createDocument({
      type: 'INVOICE', entity_id: customerId, date: today, due_date: dueDate,
      items: [{ product_id: productA, quantity: 10, unit_price: 120, discount: 0 }],
    });
    expect(StockLedgerService.getStockLevel(productA)).toBe(90);

    // On remplace A par B (qty 3).
    DocumentService.updateDocument(doc.id, {
      entity_id: customerId, date: today, due_date: dueDate,
      items: [{ product_id: productB, quantity: 3, unit_price: 120, discount: 0 }],
    });

    expect(StockLedgerService.getStockLevel(productA)).toBe(100); // A restauré
    expect(StockLedgerService.getStockLevel(productB)).toBe(47);  // B décrémenté une fois
    expectBalancesMatchLedger();
  });
});

describe('§Intégrité — suppression de document : stock restauré en session', () => {
  it('deleteDocument d\'une facture restaure le stock immédiatement (sans redémarrage)', () => {
    const productId = createProduct('DOC-DELETE');
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 100, unit_price: 60 });

    const doc = DocumentService.createDocument({
      type: 'INVOICE', entity_id: customerId, date: today, due_date: dueDate,
      items: [{ product_id: productId, quantity: 25, unit_price: 120, discount: 0 }],
    });
    expect(StockLedgerService.getStockLevel(productId)).toBe(75);

    DocumentRepository.deleteDocument(doc.id);

    expect(StockLedgerService.getStockLevel(productId)).toBe(100);
    expectBalancesMatchLedger();
  });
});

describe('§Finance — valorisation d\'un retour client au COÛT (CMUP)', () => {
  it('un avoir ne gonfle PAS le CMUP ni la valeur du stock', () => {
    const productId = createProduct('RETURN-CMUP', 60, 120);
    StockLedgerService.recordMovement({ product_id: productId, movement_type: 'PURCHASE_IN', quantity: 100, unit_price: 60 });

    const doc = DocumentService.createDocument({
      type: 'INVOICE', entity_id: customerId, date: today, due_date: dueDate,
      items: [{ product_id: productId, quantity: 10, unit_price: 120, discount: 0 }],
    });
    expect(StockLedgerService.getStockLevel(productId)).toBe(90);

    // Retour TOTAL (facture impayée) → RETURN_IN de 10 unités.
    DocumentService.createCreditNote(doc.id, undefined, 'Retour test valorisation');

    expect(StockLedgerService.getStockLevel(productId)).toBe(100);
    // Le CMUP reste le coût d'achat (60) et NON (60×100 + 120×10)/110 ≈ 65.45.
    expect(StockLedgerService.getAverageCost(productId)).toBeCloseTo(60, 6);
    expectBalancesMatchLedger();
  });
});
