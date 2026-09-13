import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/database/config/connection';
import { ClientRepository } from '../src/repositories/ClientRepository';
import { SupplierRepository } from '../src/repositories/SupplierRepository';
import { StatementRepository } from '../src/repositories/StatementRepository';
import { DocumentRepository } from '../src/repositories/DocumentRepository';
import { DocumentService } from '../src/services/DocumentService';
import { ClientService } from '../src/services/ClientService';
import { ProductService } from '../src/services/ProductService';
import { StockLedgerService } from '../src/services/StockLedgerService';
import { todayDateOnly, addDaysDateOnly } from '../src/utils/date';
import type { ProductInput } from '../src/repositories/ProductRepository';

/**
 * §Solde client / fournisseur — DÉFINITION UNIQUE.
 *
 * INVARIANT CENTRAL vérifié ici : `ClientRepository.getBalance` (et le champ
 * `balance` de la liste des clients) doivent être STRICTEMENT ÉGAUX au solde du
 * relevé de compte (`StatementRepository.getClientStatement`).
 *
 * Bug historique couvert (régression) : le solde était calculé sur la SEULE
 * table `client_credits`, dans laquelle les FACTURES ne sont jamais écrites.
 * Un client endetté de 1 000 MAD par une vente à crédit affichait donc 0 MAD :
 * le plafond de crédit n'était jamais appliqué et l'encaissement manuel était
 * refusé (« le paiement dépasse la dette actuelle »).
 */

function clean(): void {
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec(`
    DELETE FROM credit_note_refs;
    DELETE FROM client_credits;
    DELETE FROM supplier_credits;
    DELETE FROM payments;
    DELETE FROM document_items;
    DELETE FROM stock_movements;
    DELETE FROM documents;
    DELETE FROM inventory_balances;
    DELETE FROM purchase_orders;
    DELETE FROM customers;
    DELETE FROM suppliers;
    DELETE FROM products;
  `);
  db.exec('PRAGMA foreign_keys = ON;');
}

const today = todayDateOnly();
const dueDate = addDaysDateOnly(today, 30)!;

let sequence = 0;

function createProductWithStock(): string {
  sequence += 1;
  const input: ProductInput = {
    reference: `SOLDE-${sequence}`,
    designation: `Produit Solde ${sequence}`,
    purchase_price: 10,
    selling_price: 100,
    wholesale_price: 100,
    min_stock: 0,
    unit: 'PIÈCE',
    vat_rate: 0, // TVA à 0 : TTC = HT, les montants des tests restent lisibles.
    status: 'ACTIVE',
  };
  const productId = ProductService.createProduct(input).id;
  // Le repository produit n'expose pas `vat_rate` à la création : on le fixe
  // explicitement à 0 en base pour que TTC = HT dans ces tests de solde.
  db.prepare('UPDATE products SET vat_rate = 0 WHERE id = ?').run(productId);
  StockLedgerService.recordMovement({
    product_id: productId,
    movement_type: 'PURCHASE_IN',
    quantity: 1000,
    unit_price: 10,
  });
  return productId;
}

function createCustomer(creditLimit = 0): string {
  sequence += 1;
  return ClientRepository.create({
    name: `Client Solde ${sequence}`,
    credit_limit: creditLimit,
    category: 'DÉTAIL',
  }).id;
}

/** Facture de `amount` MAD TTC (TVA 0) pour ce client. */
function createInvoice(customerId: string, productId: string, amount: number): string {
  const doc = DocumentService.createDocument({
    type: 'INVOICE',
    entity_id: customerId,
    date: today,
    due_date: dueDate,
    items: [{ product_id: productId, quantity: 1, unit_price: amount, discount: 0 }],
  });
  return doc.id;
}

describe('§Solde client — les factures comptent (régression)', () => {
  beforeEach(clean);

  it('une facture impayée donne un solde ÉGAL au TTC (et non 0)', () => {
    const productId = createProductWithStock();
    const customerId = createCustomer();
    createInvoice(customerId, productId, 1000);

    // AVANT le correctif : 0 MAD (les factures n'étaient pas prises en compte).
    expect(ClientRepository.getBalance(customerId)).toBe(1000);
    expect(ClientRepository.getById(customerId)?.balance).toBeCloseTo(1000, 6);
  });

  it('un paiement partiel réduit le solde du montant encaissé', () => {
    const productId = createProductWithStock();
    const customerId = createCustomer();
    const invoiceId = createInvoice(customerId, productId, 1000);

    DocumentRepository.addPayment({ document_id: invoiceId, amount: 400, payment_method: 'CASH' });

    expect(ClientRepository.getBalance(customerId)).toBe(600);
    expect(db.prepare('SELECT status FROM documents WHERE id = ?').get(invoiceId)).toEqual({ status: 'PARTIAL' });
  });

  it('une facture soldée ramène le solde à 0', () => {
    const productId = createProductWithStock();
    const customerId = createCustomer();
    const invoiceId = createInvoice(customerId, productId, 1000);

    DocumentRepository.addPayment({ document_id: invoiceId, amount: 1000, payment_method: 'TRANSFER' });

    expect(ClientRepository.getBalance(customerId)).toBe(0);
  });

  it('dette manuelle et encaissement manuel s\'additionnent aux factures', () => {
    const productId = createProductWithStock();
    const customerId = createCustomer();

    createInvoice(customerId, productId, 1000);
    ClientService.addDebt(customerId, 500, 'Vente comptoir à crédit');
    expect(ClientRepository.getBalance(customerId)).toBe(1500);

    ClientService.recordPayment(customerId, 1500, 'Règlement intégral');
    expect(ClientRepository.getBalance(customerId)).toBe(0);
  });

  it('un retour TOTAL d\'une facture impayée annule la dette (facture annulée, avoir non crédité)', () => {
    const productId = createProductWithStock();
    const customerId = createCustomer();
    const invoiceId = createInvoice(customerId, productId, 1000);
    expect(ClientRepository.getBalance(customerId)).toBe(1000);

    DocumentService.createCreditNote(invoiceId, undefined, 'Retour intégral impayé');

    expect(ClientRepository.getBalance(customerId)).toBe(0);
    expect(db.prepare('SELECT status FROM documents WHERE id = ?').get(invoiceId)).toEqual({ status: 'CANCELLED' });
  });

  it('INVARIANT : le solde du repository ÉGALE toujours le solde du relevé de compte', () => {
    const productId = createProductWithStock();
    const customerId = createCustomer();
    const invoiceId = createInvoice(customerId, productId, 1000);
    createInvoice(customerId, productId, 250);
    DocumentRepository.addPayment({ document_id: invoiceId, amount: 100, payment_method: 'CASH' });
    ClientService.addDebt(customerId, 75, 'Frais de livraison');

    const repositoryBalance = ClientRepository.getBalance(customerId);
    const statementBalance = StatementRepository.getClientStatement(customerId).balance;

    expect(repositoryBalance).toBeCloseTo(statementBalance, 6);
    expect(repositoryBalance).toBeCloseTo(1000 - 100 + 250 + 75, 6);
    // Le champ `balance` de la LISTE doit être identique au solde unitaire.
    const listed = ClientRepository.getAll().find(c => c.id === customerId);
    expect(Number(listed?.balance)).toBeCloseTo(repositoryBalance, 6);
  });

  it('le plafond de crédit est appliqué aux VENTES (factures), pas seulement aux dettes manuelles', () => {
    const productId = createProductWithStock();
    const customerId = createCustomer(800);

    createInvoice(customerId, productId, 700);
    // Solde réel = 700 : une nouvelle vente de 200 dépasse le plafond de 800.
    expect(() => ClientService.assertWithinCreditLimit(customerId, 200)).toThrow(/CREDIT_LIMIT_EXCEEDED/);
    // Une vente de 100 reste dans le plafond.
    expect(() => ClientService.assertWithinCreditLimit(customerId, 100)).not.toThrow();
  });
});

describe('§Dette fournisseur — les commandes d\'achat comptent (régression)', () => {
  beforeEach(clean);

  it('une commande d\'achat non annulée crée une dette égale à son total', () => {
    sequence += 1;
    const supplier = SupplierRepository.create({ name: `Fournisseur Solde ${sequence}` });

    db.prepare(`
      INSERT INTO purchase_orders (id, order_number, supplier_id, date, status, total)
      VALUES (?, ?, ?, ?, 'CONFIRMED', ?)
    `).run('po-1', 'CMD-2026-00001', supplier.id, today, 2500);

    expect(SupplierRepository.getBalance(supplier.id)).toBe(2500);
    // Invariant : identique au relevé fournisseur.
    expect(SupplierRepository.getBalance(supplier.id))
      .toBeCloseTo(StatementRepository.getSupplierStatement(supplier.id).balance, 6);

    // Une commande ANNULÉE ne compte plus.
    db.prepare("UPDATE purchase_orders SET status = 'CANCELLED' WHERE id = 'po-1'").run();
    expect(SupplierRepository.getBalance(supplier.id)).toBe(0);
  });
});
