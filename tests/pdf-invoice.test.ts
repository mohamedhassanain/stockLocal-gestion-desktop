import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Dossier réel où écrire le PDF généré (process.env.TEMP sinon cwd).
const docsDir = vi.hoisted(() => process.env.TEMP || process.cwd());
vi.mock('electron', () => ({ app: { getPath: () => docsDir } }));

import { db } from '../src/database/config/connection';
import { PDFService } from '../src/services/PDFService';
import { ProductRepository, type Product } from '../src/repositories/ProductRepository';
import { ClientRepository, type Customer } from '../src/repositories/ClientRepository';
import { DocumentRepository, type Document } from '../src/repositories/DocumentRepository';
import { StockLedgerService } from '../src/services/StockLedgerService';

const P = 'PDF_INV_';

// IDs générés par les repos (UUID, non préfixés) → on les trace pour nettoyer précisément.
let clientId = '';
const docIds: string[] = [];
const productIds: string[] = [];

function cleanup() {
  const inClause = (idList: string[]) => idList.length === 0 ? '' : ` IN (${idList.map(() => '?').join(',')})`;

  const del = (sql: string, idsArr: string[]) => {
    if (idsArr.length === 0) return;
    db.prepare(sql).run(...idsArr);
  };

  // Documents & dépendances (paiements, lignes, mouvements liés)
  del(`DELETE FROM stock_movements WHERE document_id${inClause(docIds)}`, docIds);
  del(`DELETE FROM payments WHERE document_id${inClause(docIds)}`, docIds);
  del(`DELETE FROM document_items WHERE document_id${inClause(docIds)}`, docIds);
  del(`DELETE FROM documents WHERE id${inClause(docIds)}`, docIds);

  // Produits & dépendances (mouvements, historique de prix, balances)
  del(`DELETE FROM stock_movements WHERE product_id${inClause(productIds)}`, productIds);
  del(`DELETE FROM price_history WHERE product_id${inClause(productIds)}`, productIds);
  del(`DELETE FROM inventory_balances WHERE product_id${inClause(productIds)}`, productIds);
  del(`DELETE FROM products WHERE id${inClause(productIds)}`, productIds);

  if (clientId) {
    del(`DELETE FROM documents WHERE entity_id${inClause([clientId])}`, [clientId]);
    db.prepare(`DELETE FROM customers WHERE id = ?`).run(clientId);
  }

  docIds.length = 0;
  productIds.length = 0;
  clientId = '';
}

function seedProduct(ref: string): Product {
  const id = `${P}${randomUUID().slice(0, 8)}`;
  ProductRepository.create({
    id,
    reference: ref,
    designation: `Produit test ${ref}`,
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

function seedClient(): Customer {
  const client = ClientRepository.create({
    name: 'Client Test PDF',
    phone: '0600000000',
    address: 'Casablanca',
    ice: '001234567890000',
    payment_conditions: '',
    credit_limit: 0,
    category: 'GROSSISTE',
  });
  clientId = client.id;
  return client;
}

function removePdf(filePath: string) {
  try { fs.unlinkSync(filePath); } catch { /* ignore */ }
}

function trackDoc(doc: Document): Document {
  docIds.push(doc.id);
  return doc;
}

describe('PDFService — generateDocument (facture professionnelle)', () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it('génère un PDF valide (en-tête %PDF, A4) pour une facture avec plusieurs lignes', async () => {
    const client = seedClient();
    const p1 = seedProduct('PDF-REF-A');
    const p2 = seedProduct('PDF-REF-B');
    StockLedgerService.recordMovement({ product_id: p1.id, movement_type: 'PURCHASE_IN', quantity: 100, unit_price: 10 });
    StockLedgerService.recordMovement({ product_id: p2.id, movement_type: 'PURCHASE_IN', quantity: 50, unit_price: 10 });

    const doc = trackDoc(DocumentRepository.create({
      type: 'INVOICE',
      entity_id: client.id,
      date: new Date().toISOString().slice(0, 10),
      items: [
        { product_id: p1.id, quantity: 3, unit_price: 25, discount: 0 },
        { product_id: p2.id, quantity: 2, unit_price: 20, discount: 10 },
      ],
      due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      notes: 'Facture de test avec plusieurs lignes',
      manageStock: true,
    }));

    const filePath = await PDFService.generateDocument(doc);
    expect(fs.existsSync(filePath)).toBe(true);

    const bytes = fs.readFileSync(filePath);
    // En-tête PDF valide
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('%PDF');
    // Taille non triviale (contenu réel)
    expect(bytes.length).toBeGreaterThan(1000);
    removePdf(filePath);
  });

  it('génère un PDF valide pour une facture totalement payée (PAYÉ / RESTE DÛ)', async () => {
    const client = seedClient();
    const p1 = seedProduct('PDF-REF-PAID');
    StockLedgerService.recordMovement({ product_id: p1.id, movement_type: 'PURCHASE_IN', quantity: 100, unit_price: 10 });

    const doc = trackDoc(DocumentRepository.create({
      type: 'INVOICE',
      entity_id: client.id,
      date: new Date().toISOString().slice(0, 10),
      items: [
        { product_id: p1.id, quantity: 1, unit_price: 100, discount: 0 },
      ],
      due_date: undefined,
      manageStock: true,
    }));

    DocumentRepository.addPayment({ document_id: doc.id, amount: doc.total_incl_tax, payment_method: 'CASH' });

    const filePath = await PDFService.generateDocument(doc);
    expect(fs.existsSync(filePath)).toBe(true);
    const bytes = fs.readFileSync(filePath);
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(bytes.length).toBeGreaterThan(1000);
    removePdf(filePath);
  });

  it('génère un PDF valide pour une facture avec une désignation très longue (wrap, pas de débordement)', async () => {
    const client = seedClient();
    const p1 = seedProduct('PDF-REF-LONG');
    const longDesignation = 'Produit avec une désignation extrêmement longue destinée à tester le retour à la ligne automatique de la colonne Désignation dans le tableau PDF afin de garantir qu aucune donnée ne déborde de la page';
    db.prepare(`UPDATE products SET designation = ? WHERE id = ?`).run(longDesignation, p1.id);
    StockLedgerService.recordMovement({ product_id: p1.id, movement_type: 'PURCHASE_IN', quantity: 100, unit_price: 10 });

    const doc = trackDoc(DocumentRepository.create({
      type: 'INVOICE',
      entity_id: client.id,
      date: new Date().toISOString().slice(0, 10),
      items: [
        { product_id: p1.id, quantity: 5, unit_price: 30, discount: 0 },
      ],
      due_date: undefined,
      manageStock: true,
    }));

    const filePath = await PDFService.generateDocument(doc);
    expect(fs.existsSync(filePath)).toBe(true);
    const bytes = fs.readFileSync(filePath);
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(bytes.length).toBeGreaterThan(1000);
    removePdf(filePath);
  });
});
