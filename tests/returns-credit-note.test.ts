import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/database/config/connection';
import { DocumentService } from '../src/services/DocumentService';
import { DocumentRepository } from '../src/repositories/DocumentRepository';
import { ProductService } from '../src/services/ProductService';
import type { ProductInput } from '../src/repositories/ProductRepository';
import { StockService } from '../src/services/StockService';
import { StockLedgerService } from '../src/services/StockLedgerService';
import { ClientRepository } from '../src/repositories/ClientRepository';

/**
 * §Phase 7 — Retours / Avoirs.
 *
 * Vérifie : quantités retournables (déjà retourné / reste), retour partiel,
 * retour total, PREVENTION DU DOUBLE RETOUR, quantités invalides, et
 * cohérence du stock (RETURN_IN).
 */

function makeProduct(reference: string, price = 120, cost = 60): string {
  const input: ProductInput = {
    reference,
    designation: `Produit ${reference}`,
    purchase_price: cost,
    selling_price: price,
    wholesale_price: cost + 5,
    min_stock: 0,
    unit: 'PIÈCE',
    status: 'ACTIVE',
  };
  return ProductService.createProduct(input).id;
}

function makeClient(name: string): string {
  return ClientRepository.create({ name, credit_limit: 100000, category: 'DÉTAIL' }).id;
}

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
    DELETE FROM audit_logs;
    DELETE FROM document_sequences;
  `);
  db.exec('PRAGMA foreign_keys = ON;');
}

/** Facture de `qty` unités, stock initial suffisant. */
function makeInvoice(opts: { qty: number; unitPrice?: number } = { qty: 10 }) {
  const customerId = makeClient('Client Retour');
  const productId = makeProduct('RET-PROD');
  const qty = opts.qty;
  const unitPrice = opts.unitPrice ?? 120;
  StockService.addStockEntry({ product_id: productId, quantity: qty + 20, unit_price: 60 });

  const doc = DocumentService.createDocument({
    type: 'INVOICE',
    entity_id: customerId,
    date: '2026-09-08',
    due_date: '2026-09-15',
    items: [{ product_id: productId, quantity: qty, unit_price: unitPrice, discount: 0 }],
  });
  return { customerId, productId, doc };
}

describe('§Phase 7 — Retours / Avoir (SQLite réel)', () => {
  beforeEach(() => { clean(); });

  it('une facture neuve expose : vendu = 10, déjà retourné = 0, reste = 10', () => {
    const { doc, productId } = makeInvoice({ qty: 10 });
    const rows = DocumentRepository.getReturnableQuantities(doc.id);
    expect(rows).toHaveLength(1);
    const row = rows.find(r => r.product_id === productId)!;
    expect(row.sold).toBe(10);
    expect(row.returned).toBe(0);
    expect(row.returnable).toBe(10);
  });

  it('retour PARTIEL de 3 : reste retournable = 7, stock +3, facture toujours active', () => {
    const { doc, productId } = makeInvoice({ qty: 10 });
    const stockAfterSale = StockLedgerService.getStockLevel(productId);
    expect(stockAfterSale).toBe(20); // 30 initiaux − 10 vendus

    const avail = DocumentRepository.getReturnableQuantities(doc.id).find(r => r.product_id === productId)!;
    DocumentService.createCreditNote(doc.id, [{ product_id: productId, quantity: 3 }], 'Article défectueux');

    const rows = DocumentRepository.getReturnableQuantities(doc.id);
    const row = rows.find(r => r.product_id === productId)!;
    expect(row.returned).toBe(3);
    expect(row.returnable).toBe(7);
    expect(row.sold).toBe(10);
    expect(avail.returnable).toBe(10); // inchangé (lecture avant retour)

    // Stock réinjecté
    expect(StockLedgerService.getStockLevel(productId)).toBe(stockAfterSale + 3);

    // Facture d'origine toujours active
    const invoice = DocumentRepository.getById(doc.id)!;
    expect(invoice.status).not.toBe('CANCELLED');
  });

  it('retour partiel cumulé : 3 puis 4 → déjà retourné = 7, reste = 3', () => {
    const { doc, productId } = makeInvoice({ qty: 10 });
    DocumentService.createCreditNote(doc.id, [{ product_id: productId, quantity: 3 }], '1er retour');
    DocumentService.createCreditNote(doc.id, [{ product_id: productId, quantity: 4 }], '2e retour');

    const row = DocumentRepository.getReturnableQuantities(doc.id).find(r => r.product_id === productId)!;
    expect(row.returned).toBe(7);
    expect(row.returnable).toBe(3);
  });

  it('DOUBLE RETOUR refusé : impossible de dépasser la quantité vendue', () => {
    const { doc, productId } = makeInvoice({ qty: 10 });
    DocumentService.createCreditNote(doc.id, [{ product_id: productId, quantity: 6 }], '1er retour');

    // Il ne reste que 4 : demander 5 doit échouer
    expect(() =>
      DocumentService.createCreditNote(doc.id, [{ product_id: productId, quantity: 5 }], 'trop'),
    ).toThrow(/reste que 4 unité/);

    // Le stock n'a pas été touché par la tentative refusée
    const row = DocumentRepository.getReturnableQuantities(doc.id).find(r => r.product_id === productId)!;
    expect(row.returned).toBe(6);
    expect(row.returnable).toBe(4);
  });

  it('retour TOTAL : la facture passe en CANCELLED et le reste retournable tombe à 0', () => {
    const { doc, productId } = makeInvoice({ qty: 10 });
    DocumentService.createCreditNote(doc.id, [{ product_id: productId, quantity: 10 }], 'Retour total');

    const row = DocumentRepository.getReturnableQuantities(doc.id).find(r => r.product_id === productId)!;
    expect(row.returned).toBe(10);
    expect(row.returnable).toBe(0);

    const invoice = DocumentRepository.getById(doc.id)!;
    expect(invoice.status).toBe('CANCELLED');
  });

  it('quantité invalide (0, négative, non numérique) : refusée', () => {
    const { doc, productId } = makeInvoice({ qty: 10 });
    expect(() =>
      DocumentService.createCreditNote(doc.id, [{ product_id: productId, quantity: 0 }], 'zéro'),
    ).toThrow();
    expect(() =>
      DocumentService.createCreditNote(doc.id, [{ product_id: productId, quantity: -5 }], 'négatif'),
    ).toThrow();
    expect(() =>
      DocumentService.createCreditNote(doc.id, [{ product_id: productId, quantity: Number.NaN }], 'NaN'),
    ).toThrow();
  });

  it('un produit qui n\'est pas dans la facture est refusé', () => {
    const { doc } = makeInvoice({ qty: 10 });
    const autreProduit = makeProduct('HORS-FACTURE');
    expect(() =>
      DocumentService.createCreditNote(doc.id, [{ product_id: autreProduit, quantity: 1 }], 'inconnu'),
    ).toThrow();
  });

  it('l\'avoir réinjecte le stock une seule fois (RETURN_IN atomique)', () => {
    const { doc, productId } = makeInvoice({ qty: 10 });
    const before = StockLedgerService.getStockLevel(productId);

    DocumentService.createCreditNote(doc.id, [{ product_id: productId, quantity: 10 }], 'Retour total');
    const after = StockLedgerService.getStockLevel(productId);

    // 30 initiaux − 10 vendus = 20, puis +10 retournés = 30
    expect(before).toBe(20);
    expect(after).toBe(30);

    const movements = db.prepare(
      `SELECT COUNT(*) AS c FROM stock_movements WHERE movement_type = 'RETURN_IN'`,
    ).get() as { c: number };
    expect(movements.c).toBe(1);
  });

  it('un avoir partiel n\'annule PAS la facture (dette résiduelle conservée)', () => {
    const { doc, productId } = makeInvoice({ qty: 10 });
    const credit = DocumentService.createCreditNote(doc.id, [{ product_id: productId, quantity: 2 }], 'partiel');

    expect(credit.type).toBe('CREDIT_NOTE');
    const invoice = DocumentRepository.getById(doc.id)!;
    expect(invoice.status).not.toBe('CANCELLED');
    // L'avoir a bien un total positif (crédit au client)
    expect(credit.total_incl_tax).toBeGreaterThan(0);
  });
});
