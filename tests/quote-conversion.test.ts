import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '../src/database/config/connection';
import { DocumentRepository } from '../src/repositories/DocumentRepository';
import { ProductRepository, type Product } from '../src/repositories/ProductRepository';
import { ClientRepository } from '../src/repositories/ClientRepository';
import { StockLedgerService } from '../src/services/StockLedgerService';

/**
 * Phase 1 — Conversion Devis (QUOTE) → Bon de livraison / Facture.
 *
 * Vérifie :
 *  - conversion réussie : lignes et montants identiques, stock décrémenté,
 *    devis passé en CONVERTED, lien original_document_id ;
 *  - refus d'un devis déjà converti ;
 *  - atomicité : un échec en cours de conversion (stock insuffisant) annule
 *    TOUT (aucun document créé, statut du devis inchangé).
 */

const P = 'QUOTE_CONV_';
const productIds: string[] = [];
const docIds: string[] = [];
let clientId = '';

function inClause(ids: string[]): string {
  return ids.length === 0 ? '' : ` IN (${ids.map(() => '?').join(',')})`;
}

function cleanup(): void {
  const del = (sql: string, ids: string[]) => { if (ids.length > 0) db.prepare(sql).run(...ids); };
  del(`DELETE FROM stock_movements WHERE document_id${inClause(docIds)}`, docIds);
  del(`DELETE FROM payments WHERE document_id${inClause(docIds)}`, docIds);
  del(`DELETE FROM document_items WHERE document_id${inClause(docIds)}`, docIds);
  del(`DELETE FROM documents WHERE id${inClause(docIds)}`, docIds);
  del(`DELETE FROM stock_movements WHERE product_id${inClause(productIds)}`, productIds);
  del(`DELETE FROM inventory_balances WHERE product_id${inClause(productIds)}`, productIds);
  del(`DELETE FROM products WHERE id${inClause(productIds)}`, productIds);
  if (clientId) {
    del(`DELETE FROM documents WHERE entity_id${inClause([clientId])}`, [clientId]);
    db.prepare('DELETE FROM customers WHERE id = ?').run(clientId);
  }
  docIds.length = 0;
  productIds.length = 0;
  clientId = '';
}

function seedProduct(reference: string): Product {
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
    unit: 'PIÈCE',
    purchase_price: 10,
    selling_price: 25,
    wholesale_price: 20,
    min_stock: 0,
    status: 'ACTIVE',
  } as Product);
  productIds.push(id);
  return ProductRepository.findById(id)!;
}

function seedClient(): string {
  const client = ClientRepository.create({
    name: 'Client Devis Test',
    phone: '0600000000',
    address: 'Casablanca',
    ice: '',
    payment_conditions: '',
    credit_limit: 0,
    category: 'GROSSISTE',
  });
  clientId = client.id;
  return client.id;
}

function track(doc: { id: string }): void {
  docIds.push(doc.id);
}

describe('Phase 1 — Conversion Devis → BL / Facture', () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it('convertit un devis en facture : lignes et montants identiques, stock décrémenté, devis CONVERTED', () => {
    const client = seedClient();
    const p1 = seedProduct('CONV-A');
    const p2 = seedProduct('CONV-B');
    StockLedgerService.recordMovement({ product_id: p1.id, movement_type: 'PURCHASE_IN', quantity: 100, unit_price: 10 });
    StockLedgerService.recordMovement({ product_id: p2.id, movement_type: 'PURCHASE_IN', quantity: 100, unit_price: 10 });

    const quote = DocumentRepository.create({
      type: 'QUOTE',
      entity_id: client,
      date: new Date().toISOString().slice(0, 10),
      items: [
        { product_id: p1.id, quantity: 3, unit_price: 25, discount: 0 },
        { product_id: p2.id, quantity: 2, unit_price: 20, discount: 10 },
      ],
    });
    track(quote);

    // Un devis ne touche PAS le stock.
    expect(StockLedgerService.getStockLevel(p1.id)).toBe(100);

    const invoice = DocumentRepository.convertQuoteToInvoice(quote.id);
    track(invoice);

    expect(invoice.type).toBe('INVOICE');
    expect(invoice.total_incl_tax).toBeCloseTo(quote.total_incl_tax, 2);
    expect(invoice.total_excl_tax).toBeCloseTo(quote.total_excl_tax, 2);
    expect(invoice.items?.length).toBe(2);
    expect(invoice.original_document_id).toBe(quote.id);

    // Le stock est décrémenté UNE seule fois, à la conversion.
    expect(StockLedgerService.getStockLevel(p1.id)).toBe(97);
    expect(StockLedgerService.getStockLevel(p2.id)).toBe(98);

    // Le devis d'origine est marqué CONVERTED.
    expect(DocumentRepository.getById(quote.id)?.status).toBe('CONVERTED');
  });

  it('convertit un devis en bon de livraison', () => {
    const client = seedClient();
    const p1 = seedProduct('CONV-BL');
    StockLedgerService.recordMovement({ product_id: p1.id, movement_type: 'PURCHASE_IN', quantity: 50, unit_price: 10 });

    const quote = DocumentRepository.create({
      type: 'QUOTE',
      entity_id: client,
      date: new Date().toISOString().slice(0, 10),
      items: [{ product_id: p1.id, quantity: 5, unit_price: 30, discount: 0 }],
    });
    track(quote);

    const bl = DocumentRepository.convertQuoteToDeliveryNote(quote.id);
    track(bl);

    expect(bl.type).toBe('DELIVERY_NOTE');
    expect(bl.total_incl_tax).toBeCloseTo(quote.total_incl_tax, 2);
    expect(bl.original_document_id).toBe(quote.id);
    expect(StockLedgerService.getStockLevel(p1.id)).toBe(45);
    expect(DocumentRepository.getById(quote.id)?.status).toBe('CONVERTED');
  });

  it('refuse la conversion d\'un devis déjà converti', () => {
    const client = seedClient();
    const p1 = seedProduct('CONV-DUP');
    StockLedgerService.recordMovement({ product_id: p1.id, movement_type: 'PURCHASE_IN', quantity: 50, unit_price: 10 });

    const quote = DocumentRepository.create({
      type: 'QUOTE',
      entity_id: client,
      date: new Date().toISOString().slice(0, 10),
      items: [{ product_id: p1.id, quantity: 4, unit_price: 30, discount: 0 }],
    });
    track(quote);

    const first = DocumentRepository.convertQuoteToInvoice(quote.id);
    track(first);

    expect(() => DocumentRepository.convertQuoteToInvoice(quote.id)).toThrow(/déjà été converti/i);
    expect(() => DocumentRepository.convertQuoteToDeliveryNote(quote.id)).toThrow(/déjà été converti/i);

    // Aucun second document créé.
    const count = db.prepare(`SELECT COUNT(*) AS c FROM documents WHERE original_document_id = ?`).get(quote.id) as { c: number };
    expect(count.c).toBe(1);
  });

  it('refuse un devis annulé', () => {
    const client = seedClient();
    const p1 = seedProduct('CONV-CANCEL');
    StockLedgerService.recordMovement({ product_id: p1.id, movement_type: 'PURCHASE_IN', quantity: 50, unit_price: 10 });

    const quote = DocumentRepository.create({
      type: 'QUOTE',
      entity_id: client,
      date: new Date().toISOString().slice(0, 10),
      items: [{ product_id: p1.id, quantity: 1, unit_price: 30, discount: 0 }],
    });
    track(quote);
    DocumentRepository.cancelDocument(quote.id);

    expect(() => DocumentRepository.convertQuoteToInvoice(quote.id)).toThrow(/annulé/i);
  });

  it('atomicité : échec en cours de conversion (stock insuffisant) → rollback complet', () => {
    const client = seedClient();
    const p1 = seedProduct('CONV-ROLLBACK');
    // Stock volontairement insuffisant : 2 unités pour une demande de 10.
    StockLedgerService.recordMovement({ product_id: p1.id, movement_type: 'PURCHASE_IN', quantity: 2, unit_price: 10 });

    const quote = DocumentRepository.create({
      type: 'QUOTE',
      entity_id: client,
      date: new Date().toISOString().slice(0, 10),
      items: [{ product_id: p1.id, quantity: 10, unit_price: 30, discount: 0 }],
    });
    track(quote);

    expect(() => DocumentRepository.convertQuoteToDeliveryNote(quote.id)).toThrow(/insuffisant/i);

    // Aucun document produit.
    const count = db.prepare(`SELECT COUNT(*) AS c FROM documents WHERE original_document_id = ?`).get(quote.id) as { c: number };
    expect(count.c).toBe(0);
    // Le statut du devis est INCHANGÉ (rollback du passage à CONVERTED).
    expect(DocumentRepository.getById(quote.id)?.status).toBe('UNPAID');
    // Le stock est intact.
    expect(StockLedgerService.getStockLevel(p1.id)).toBe(2);
  });
});
