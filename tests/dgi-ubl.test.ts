import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SaxesParser } from 'saxes';

import { db } from '../src/database/config/connection';
import { DocumentRepository, type Document } from '../src/repositories/DocumentRepository';
import { ProductRepository, type Product } from '../src/repositories/ProductRepository';
import { ClientRepository, type Customer } from '../src/repositories/ClientRepository';
import { StockLedgerService } from '../src/services/StockLedgerService';

import { documentToUbl, documentToUblResult } from '../src/compliance/dgi/UblInvoiceGenerator';
import { escapeXmlText } from '../src/compliance/dgi/xmlEscape';
import { StubDgiConnector, createDgiConnector, DgiNotConfiguredError } from '../src/compliance/dgi/DgiConnector';
import { resolveDgiDisplayStatus, DGI_STATUS_LABEL, DGI_INTEGRATION_AVAILABLE } from '../src/compliance/dgi/dgiStatus';

/**
 * §DGI — Tests de préparation à la facturation électronique (Maroc).
 *
 * ⚠️  Ces tests NE valident PAS une conformité DGI (les spécifications
 * officielles ne sont pas publiées). Ils vérifient que :
 *   - la conversion document → UBL 2.1 produit un XML BIEN FORMÉ (validé par un
 *     vrai parseur SAX, `saxes`) avec les champs essentiels ;
 *   - le module est isolé et honnête (aucun faux succès DGI).
 */

const P = 'DGI_UBL_';

// Entités XML construites par concaténation : le sérialiseur qui écrit CE
// fichier décode les séquences d'entités littérales, on assemble donc
// l'esperluette seule avec le nom de l'entité pour obtenir la valeur attendue.
const AMP = '&' + 'amp;';
const LT = '&' + 'lt;';
const GT = '&' + 'gt;';
const QUOT = '&' + 'quot;';
const APOS = '&' + 'apos;';

// Ids créés pendant le test → nettoyage précis (repos génèrent des UUID).
let clientId = '';
const docIds: string[] = [];
const productIds: string[] = [];

function cleanup() {
  const inClause = (ids: string[]) => ids.length === 0 ? '' : ` IN (${ids.map(() => '?').join(',')})`;
  const del = (sql: string, idsArr: string[]) => { if (idsArr.length > 0) db.prepare(sql).run(...idsArr); };

  // Références d'avoir (FK vers documents) — supprimées explicitement avant.
  del(`DELETE FROM credit_note_refs WHERE credit_note_id${inClause(docIds)}`, docIds);
  del(`DELETE FROM credit_note_refs WHERE original_document_id${inClause(docIds)}`, docIds);

  del(`DELETE FROM stock_movements WHERE document_id${inClause(docIds)}`, docIds);
  del(`DELETE FROM payments WHERE document_id${inClause(docIds)}`, docIds);
  del(`DELETE FROM document_items WHERE document_id${inClause(docIds)}`, docIds);
  del(`DELETE FROM documents WHERE id${inClause(docIds)}`, docIds);

  // Crédits client (FK RESTRICT vers customers) — AVANT de supprimer le client.
  if (clientId) {
    db.prepare('DELETE FROM client_credits WHERE customer_id = ?').run(clientId);
    del(`DELETE FROM documents WHERE entity_id${inClause([clientId])}`, [clientId]);
  }

  del(`DELETE FROM stock_movements WHERE product_id${inClause(productIds)}`, productIds);
  del(`DELETE FROM price_history WHERE product_id${inClause(productIds)}`, productIds);
  del(`DELETE FROM inventory_balances WHERE product_id${inClause(productIds)}`, productIds);
  del(`DELETE FROM products WHERE id${inClause(productIds)}`, productIds);

  if (clientId) {
    db.prepare(`DELETE FROM customers WHERE id = ?`).run(clientId);
  }

  docIds.length = 0;
  productIds.length = 0;
  clientId = '';
}

function seedProduct(reference: string, designation: string): Product {
  const id = `${P}${randomUUID().slice(0, 8)}`;
  ProductRepository.create({
    id, reference, designation, description: null, category_id: null, subcategory_id: null,
    barcode: null, image_path: null, unit: 'PIÈCE',
    purchase_price: 10, selling_price: 25, wholesale_price: 20, min_stock: 0, status: 'ACTIVE',
  } as Product);
  productIds.push(id);
  return ProductRepository.findById(id)!;
}

function seedClient(name: string): Customer {
  const client = ClientRepository.create({
    name, phone: '0600000000', address: 'Casablanca', ice: '001234567890000',
    payment_conditions: '', credit_limit: 0, category: 'GROSSISTE',
  });
  clientId = client.id;
  return client;
}

/** Valide le XML avec un VRAI parseur SAX et renvoie des observations. */
function parseXml(xml: string): { rootLocalName: string; elementNames: string[]; errors: string[] } {
  const parser = new SaxesParser({ xmlns: true });
  const errors: string[] = [];
  const elementNames: string[] = [];
  let rootLocalName = '';
  parser.on('error', (e: Error) => { errors.push(e.message); });
  parser.on('opentag', (tag: { local: string; uri: string }) => {
    if (elementNames.length === 0) rootLocalName = tag.local;
    elementNames.push(`${tag.local}`);
  });
  parser.write(xml).close();
  return { rootLocalName, elementNames, errors };
}

function buildInvoice(): Document {
  const client = seedClient('Client DGI Test');
  const p1 = seedProduct('DGI-REF-1', 'Article A & spécial <test>');
  const p2 = seedProduct('DGI-REF-2', 'Article normal');
  StockLedgerService.recordMovement({ product_id: p1.id, movement_type: 'PURCHASE_IN', quantity: 100, unit_price: 10 });
  StockLedgerService.recordMovement({ product_id: p2.id, movement_type: 'PURCHASE_IN', quantity: 100, unit_price: 10 });

  const doc = DocumentRepository.create({
    type: 'INVOICE',
    entity_id: client.id,
    date: '2026-09-13',
    due_date: '2026-10-13',
    notes: 'Facture de test DGI (préparation UBL)',
    items: [
      { product_id: p1.id, quantity: 3, unit_price: 25, discount: 0 },
      { product_id: p2.id, quantity: 2, unit_price: 20, discount: 10 },
    ],
    manageStock: true,
  });
  docIds.push(doc.id);
  return DocumentRepository.getById(doc.id)!;
}

describe('§DGI — générateur UBL 2.1 (préparation, aucun envoi réel)', () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it('documentToUbl produit un XML UBL 2.1 BIEN FORMÉ à partir d\'une facture existante', () => {
    const invoice = buildInvoice();
    const xml = documentToUbl(invoice);

    // 1. Bien formé + élément racine UBL (validé par un vrai parseur SAX).
    const parsed = parseXml(xml);
    expect(parsed.errors, parsed.errors.join('\n')).toEqual([]);
    expect(parsed.rootLocalName).toBe('Invoice');

    // 2. Champs essentiels présents (en-tête, parties, lignes, montants, TVA).
    expect(xml.startsWith('<?xml')).toBe(true);
    expect(xml).toContain('urn:oasis:names:specification:ubl:schema:xsd:Invoice-2');
    expect(xml).toContain('<cbc:UBLVersionID>2.1</cbc:UBLVersionID>');
    expect(xml).toContain(`<cbc:ID>${invoice.document_number}</cbc:ID>`);
    expect(xml).toContain('<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>');
    expect(xml).toContain('<cbc:DocumentCurrencyCode>MAD</cbc:DocumentCurrencyCode>');
    expect(parsed.elementNames).toContain('AccountingSupplierParty');
    expect(parsed.elementNames).toContain('AccountingCustomerParty');
    expect(parsed.elementNames).toContain('TaxTotal');
    expect(parsed.elementNames).toContain('TaxSubtotal');
    expect(parsed.elementNames).toContain('LegalMonetaryTotal');
    expect(parsed.elementNames).toContain('PayableAmount');

    // 3. Autant de lignes que d'articles facturés.
    expect(parsed.elementNames.filter(n => n === 'InvoiceLine')).toHaveLength(2);

    // 4. Les caractères spéciaux de la désignation sont ÉCHAPPÉS (pas de « & »
    //    brut, sinon le document ne serait pas bien formé).
    expect(xml).toContain(`Article A ${AMP} spécial ${LT}test${GT}`);
    expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;|#)/);

    // 5. Montants cohérents avec la facture (PayableAmount = total TTC, 2 déc.).
    expect(xml).toContain(`<cbc:PayableAmount currencyID="MAD">${invoice.total_incl_tax.toFixed(2)}</cbc:PayableAmount>`);
    expect(xml).toContain(`<cbc:LineExtensionAmount currencyID="MAD">${invoice.total_excl_tax.toFixed(2)}</cbc:LineExtensionAmount>`);
  });

  it('documentToUblResult renvoie le XML et des métadonnées cohérentes', () => {
    const invoice = buildInvoice();
    const result = documentToUblResult(invoice);
    expect(result.documentNumber).toBe(invoice.document_number);
    expect(result.documentType).toBe('INVOICE');
    expect(result.lineCount).toBe(2);
    expect(result.currency).toBe('MAD');
    expect(parseXml(result.xml).errors).toEqual([]);
  });

  it('produit un XML bien formé pour un AVOIR (CreditNote, code de type 381)', () => {
    const invoice = buildInvoice();
    const item = (invoice.items ?? [])[0];
    const creditNote = DocumentRepository.createCreditNote({
      original_invoice_id: invoice.id,
      entity_id: invoice.entity_id,
      date: '2026-09-14',
      return_items: [{ product_id: item.product_id, quantity: 1, unit_price: item.unit_price, discount: item.discount }],
      reason: 'Test UBL avoir',
    });
    docIds.push(creditNote.id);
    const xml = documentToUbl(creditNote);
    const parsed = parseXml(xml);
    expect(parsed.errors, parsed.errors.join('\n')).toEqual([]);
    expect(parsed.rootLocalName).toBe('CreditNote');
    expect(xml).toContain('<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>');
    expect(parsed.elementNames).toContain('CreditNoteLine');
  });
});

describe('§DGI — échappement XML (distinct de l\'échappement HTML)', () => {
  it('échappe exactement les cinq entités XML 1.0', () => {
    expect(escapeXmlText('a & b < c > d " e')).toBe(`a ${AMP} b ${LT} c ${GT} d ${QUOT} e`);
    expect(escapeXmlText("'")).toBe(APOS);
  });

  it('un seul passage : l\'esperluette des entités déjà échappées est ré-échappée', () => {
    // Entrée = « & » (6 caractères). L'esperluette initiale devient « & »,
    // la suite « amp; » reste telle quelle → « &amp; ».
    expect(escapeXmlText(AMP)).toBe(`${AMP}amp;`);
    expect(escapeXmlText('&')).toBe(AMP);
  });

  it('une chaîne vide reste vide', () => {
    expect(escapeXmlText('')).toBe('');
  });
});

describe('§DGI — module isolé et honnête (aucun faux succès)', () => {
  it('le connecteur par défaut n\'est pas configuré et échoue explicitement', async () => {
    const connector = createDgiConnector();
    expect(connector.id).toBe('dgi-stub');
    expect(connector.isConfigured()).toBe(false);

    const stub = new StubDgiConnector();
    await expect(
      stub.submitInvoice({
        documentId: 'x', documentNumber: 'FAC-2026-00001', documentDate: '2026-09-13', ublXml: '<Invoice/>',
      }),
    ).rejects.toBeInstanceOf(DgiNotConfiguredError);

    await expect(
      stub.submitInvoice({
        documentId: 'x', documentNumber: 'FAC-2026-00001', documentDate: '2026-09-13', ublXml: '<Invoice/>',
      }),
    ).rejects.toThrow('Intégration DGI non encore disponible — en attente des spécifications officielles');
  });

  it('l\'intégration n\'est pas disponible et aucun statut CLEARED ne peut être affiché', () => {
    expect(DGI_INTEGRATION_AVAILABLE).toBe(false);

    // Module désactivé → NOT_APPLICABLE (aucune contrainte).
    expect(resolveDgiDisplayStatus({ enabled: false, stored: null })).toBe('NOT_APPLICABLE');
    // Module activé sans intégration → PENDING (jamais de faux succès).
    expect(resolveDgiDisplayStatus({ enabled: true, stored: null })).toBe('PENDING');
    // Même si la base contenait CLEARED, l'absence d'intégration force PENDING.
    expect(resolveDgiDisplayStatus({ enabled: true, stored: 'CLEARED' })).toBe('PENDING');
    // Libellés honnêtes.
    expect(DGI_STATUS_LABEL.PENDING).toContain('attente');
    expect(DGI_STATUS_LABEL.NOT_APPLICABLE).toBe('Non applicable');
  });
});
