import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

// Dossier réel où écrire le PDF généré (process.env.TEMP sinon cwd).
const docsDir = vi.hoisted(() => process.env.TEMP || process.cwd());
vi.mock('electron', () => ({ app: { getPath: () => docsDir } }));

import { db } from '../src/database/config/connection';
import { PDFService } from '../src/services/PDFService';
import { CompanySettingsService } from '../src/services/CompanySettingsService';
import { ProductRepository, type Product } from '../src/repositories/ProductRepository';
import { ClientRepository, type Customer } from '../src/repositories/ClientRepository';
import { DocumentRepository, type Document } from '../src/repositories/DocumentRepository';
import { StockLedgerService } from '../src/services/StockLedgerService';

const P = 'PDF_QR_';

let clientId = '';
const docIds: string[] = [];
const productIds: string[] = [];

function cleanup() {
  const inClause = (idList: string[]) => idList.length === 0 ? '' : ` IN (${idList.map(() => '?').join(',')})`;
  const del = (sql: string, idsArr: string[]) => {
    if (idsArr.length === 0) return;
    db.prepare(sql).run(...idsArr);
  };
  del(`DELETE FROM stock_movements WHERE document_id${inClause(docIds)}`, docIds);
  del(`DELETE FROM payments WHERE document_id${inClause(docIds)}`, docIds);
  del(`DELETE FROM document_items WHERE document_id${inClause(docIds)}`, docIds);
  del(`DELETE FROM documents WHERE id${inClause(docIds)}`, docIds);
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
    designation: `Produit QR ${ref}`,
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
    name: 'Client QR',
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

describe('Paramètres entreprise — QR code du lien', () => {
  beforeEach(() => {
    cleanup();
    // Réinitialise les clés QR pour un état déterministe.
    db.prepare("DELETE FROM company_settings WHERE key IN ('qr_link','show_qr_on_documents')").run();
  });
  afterEach(() => {
    db.prepare("DELETE FROM company_settings WHERE key IN ('qr_link','show_qr_on_documents')").run();
    cleanup();
  });

  it('persiste et relit le lien QR et l’interrupteur d’affichage', () => {
    const saved = CompanySettingsService.save({
      qr_link: 'https://facebook.com/stocklocal',
      show_qr_on_documents: true,
    });
    expect(saved.qr_link).toBe('https://facebook.com/stocklocal');
    expect(saved.show_qr_on_documents).toBe(true);

    const reread = CompanySettingsService.getAll();
    expect(reread.qr_link).toBe('https://facebook.com/stocklocal');
    expect(reread.show_qr_on_documents).toBe(true);
  });

  it('permet de désactiver l’affichage du QR code', () => {
    CompanySettingsService.save({ qr_link: 'https://monsite.ma', show_qr_on_documents: false });
    const s = CompanySettingsService.getAll();
    expect(s.qr_link).toBe('https://monsite.ma');
    expect(s.show_qr_on_documents).toBe(false);
  });

  it('génère la facture PDF avec un lien QR configuré (aucune erreur)', async () => {
    CompanySettingsService.save({ qr_link: 'https://youtube.com/@stocklocal', show_qr_on_documents: true });

    const client = seedClient();
    const p1 = seedProduct('QR-REF-A');
    StockLedgerService.recordMovement({ product_id: p1.id, movement_type: 'PURCHASE_IN', quantity: 100, unit_price: 10 });

    const doc: Document = DocumentRepository.create({
      type: 'INVOICE',
      entity_id: client.id,
      date: new Date().toISOString().slice(0, 10),
      items: [{ product_id: p1.id, quantity: 2, unit_price: 25, discount: 0 }],
      due_date: undefined,
      manageStock: true,
    });
    docIds.push(doc.id);

    const filePath = await PDFService.generateDocument(doc);
    expect(fs.existsSync(filePath)).toBe(true);
    const bytes = fs.readFileSync(filePath);
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('%PDF');
    // Avec le QR (nombreux rectangles) le PDF est plus volumineux qu'un PDF vide.
    expect(bytes.length).toBeGreaterThan(1000);
    removePdf(filePath);
  });

  it('génère la facture PDF même lorsque le QR code est désactivé', async () => {
    CompanySettingsService.save({ qr_link: 'https://monsite.ma', show_qr_on_documents: false });

    const client = seedClient();
    const p1 = seedProduct('QR-REF-B');
    StockLedgerService.recordMovement({ product_id: p1.id, movement_type: 'PURCHASE_IN', quantity: 10, unit_price: 10 });

    const doc: Document = DocumentRepository.create({
      type: 'INVOICE',
      entity_id: client.id,
      date: new Date().toISOString().slice(0, 10),
      items: [{ product_id: p1.id, quantity: 1, unit_price: 25, discount: 0 }],
      due_date: undefined,
      manageStock: true,
    });
    docIds.push(doc.id);

    const filePath = await PDFService.generateDocument(doc);
    expect(fs.existsSync(filePath)).toBe(true);
    const bytes = fs.readFileSync(filePath);
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('%PDF');
    removePdf(filePath);
  });
});
