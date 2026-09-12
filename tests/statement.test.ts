import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/database/config/connection';
import { StatementRepository } from '../src/repositories/StatementRepository';
import { DocumentService } from '../src/services/DocumentService';
import { ProductService } from '../src/services/ProductService';
import type { ProductInput } from '../src/repositories/ProductRepository';
import { StockService } from '../src/services/StockService';
import { ClientRepository } from '../src/repositories/ClientRepository';
import { SupplierRepository } from '../src/repositories/SupplierRepository';
import { PurchaseOrderRepository } from '../src/repositories/PurchaseOrderRepository';
import { SupplierService } from '../src/services/SupplierService';
import { evaluateCredit } from '../src/domain/credit/CreditStatus';
import { todayDateOnly } from '../src/utils/date';

/**
 * §Phase 8 & 9 — Relevés de compte client et fournisseur.
 * Lignes débit/crédit, solde cumulé, totaux, échéances à venir / en retard.
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

function clean(): void {
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec(`
    DELETE FROM credit_note_refs;
    DELETE FROM payments;
    DELETE FROM document_items;
    DELETE FROM stock_movements;
    DELETE FROM purchase_order_items;
    DELETE FROM purchase_orders;
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

/**
 * Facture de `qty` × `unitPrice` (HT) pour un client, avec échéance.
 * `date` est paramétrable car §Phase 2.1 impose due_date >= date.
 */
function invoice(
  customerId: string,
  productId: string,
  qty: number,
  unitPrice: number,
  dueDate = '2026-09-15',
  date = '2026-09-08',
) {
  return DocumentService.createDocument({
    type: 'INVOICE',
    entity_id: customerId,
    date,
    due_date: dueDate,
    items: [{ product_id: productId, quantity: qty, unit_price: unitPrice, discount: 0 }],
  });
}

describe('§Phase 8 — Relevé de compte CLIENT', () => {
  beforeEach(() => { clean(); });

  it('facture + paiement partiel : lignes, totaux et solde exacts', () => {
    const customerId = ClientRepository.create({ name: 'Épicerie Hassan', credit_limit: 0, category: 'DÉTAIL' }).id;
    const productId = makeProduct('ST-P1');
    StockService.addStockEntry({ product_id: productId, quantity: 100, unit_price: 60 });

    // 10 × 120 HT = 1200 HT → 1440 TTC (TVA 20%)
    const doc = invoice(customerId, productId, 10, 120);
    expect(doc.total_incl_tax).toBe(1440);

    DocumentService.addPayment({ document_id: doc.id, amount: 500, payment_method: 'CASH' });

    const st = StatementRepository.getClientStatement(customerId);
    expect(st.entityName).toBe('Épicerie Hassan');
    expect(st.lines).toHaveLength(2);

    const invLine = st.lines.find(l => l.kind === 'INVOICE')!;
    expect(invLine.debit).toBe(1440);
    expect(invLine.credit).toBe(0);
    expect(invLine.balance).toBe(1440);

    const payLine = st.lines.find(l => l.kind === 'PAYMENT')!;
    expect(payLine.debit).toBe(0);
    expect(payLine.credit).toBe(500);
    expect(payLine.balance).toBe(940); // solde cumulé après paiement

    expect(st.totalDebit).toBe(1440);
    expect(st.totalCredit).toBe(500);
    expect(st.balance).toBe(940);
  });

  it('paiement intégral → solde 0', () => {
    const customerId = ClientRepository.create({ name: 'Client Soldé', credit_limit: 0, category: 'DÉTAIL' }).id;
    const productId = makeProduct('ST-P2');
    StockService.addStockEntry({ product_id: productId, quantity: 100, unit_price: 60 });

    const doc = invoice(customerId, productId, 5, 100); // 500 HT → 600 TTC
    DocumentService.addPayment({ document_id: doc.id, amount: 600, payment_method: 'CASH' });

    const st = StatementRepository.getClientStatement(customerId);
    expect(st.balance).toBe(0);
    expect(st.totalDebit).toBe(600);
    expect(st.totalCredit).toBe(600);
  });

  it('une facture ANNULÉE (retour total) et ses paiements sont exclus du relevé', () => {
    const customerId = ClientRepository.create({ name: 'Client Retour', credit_limit: 0, category: 'DÉTAIL' }).id;
    const productId = makeProduct('ST-P3');
    StockService.addStockEntry({ product_id: productId, quantity: 100, unit_price: 60 });

    const doc = invoice(customerId, productId, 2, 100);
    // Retour total (facture impayée) → avoir, facture CANCELLED
    DocumentService.createCreditNote(doc.id, [{ product_id: productId, quantity: 2 }], 'retour total');

    const st = StatementRepository.getClientStatement(customerId);
    // La facture annulée n'apparaît pas ; seul l'avoir (crédit) reste
    expect(st.lines.some(l => l.kind === 'INVOICE')).toBe(false);
    expect(st.balance).toBe(0);
  });

  it('classe correctement les échéances à venir et en retard', () => {
    const customerId = ClientRepository.create({ name: 'Client Délais', credit_limit: 0, category: 'DÉTAIL' }).id;
    const productId = makeProduct('ST-P4');
    StockService.addStockEntry({ product_id: productId, quantity: 100, unit_price: 60 });

    // Échéance passée (2000-01-02) : facture ancienne → EN RETARD
    // (date de facture antérieure pour respecter §Phase 2.1 : due_date >= date)
    invoice(customerId, productId, 1, 100, '2000-01-02', '2000-01-01');
    // Échéance future : À VENIR
    invoice(customerId, productId, 1, 100, '2099-12-31');

    const st = StatementRepository.getClientStatement(customerId);
    expect(st.overdue.length).toBe(1);
    expect(st.upcoming.length).toBe(1);
    expect(st.overdue[0].overdue).toBe(true);
    expect(st.upcoming[0].overdue).toBe(false);
    expect(st.overdueTotal).toBeGreaterThan(0);
  });

  it('un client inexistant lève une erreur explicite', () => {
    expect(() => StatementRepository.getClientStatement('inexistant')).toThrow(/Client introuvable/);
  });

  it('aucune écriture → relevé vide et solde nul', () => {
    const customerId = ClientRepository.create({ name: 'Client Vide', credit_limit: 0, category: 'DÉTAIL' }).id;
    const st = StatementRepository.getClientStatement(customerId);
    expect(st.lines).toHaveLength(0);
    expect(st.balance).toBe(0);
    expect(st.overdue).toHaveLength(0);
  });
});

describe('§Phase 9 — Relevé FOURNISSEUR', () => {
  beforeEach(() => { clean(); });

  it('achat + règlement : crédit puis débit, solde exact', () => {
    const supplierId = SupplierRepository.create({ name: 'Grossiste Nord' }).id;
    const productId = makeProduct('ST-F1');

    PurchaseOrderRepository.create({
      supplier_id: supplierId,
      items: [{ product_id: productId, quantity: 10, unit_price: 50 }],
    });

    SupplierService.recordPayment(supplierId, 200, 'Règlement partiel');

    const st = StatementRepository.getSupplierStatement(supplierId);
    expect(st.entityName).toBe('Grossiste Nord');

    const purchaseLine = st.lines.find(l => l.kind === 'PURCHASE')!;
    expect(purchaseLine.credit).toBe(500);
    expect(purchaseLine.debit).toBe(0);

    // Solde fournisseur = ce que NOUS devons = totalCrédit − totalDébit.
    // L'achat (500) augmente la dette ; notre règlement (200) la diminue.
    expect(st.totalCredit).toBe(500);
    expect(st.totalDebit).toBe(200);
    expect(st.balance).toBe(300);
  });

  it('un fournisseur inexistant lève une erreur explicite', () => {
    expect(() => StatementRepository.getSupplierStatement('inexistant')).toThrow(/Fournisseur introuvable/);
  });
});
/**
 * §Phase 2 — SOURCE UNIQUE de l'état d'échéance.
 *
 * Le relevé NE DOIT PAS avoir sa propre règle « en retard » : il doit dériver
 * l'état du moteur unique `evaluateCredit`, sinon les libellés divergent entre
 * l'écran Relevé, le Tableau de bord et les PDF (règle A du cahier des charges).
 */
describe('§Phase 2 — Le relevé dérive l’échéance du moteur UNIQUE', () => {
  beforeEach(() => { clean(); });

  it('échéance passée → « En retard » sur la ligne ET sur l’échéance', () => {
    const customerId = ClientRepository.create({ name: 'Client Retard', credit_limit: 0, category: 'DÉTAIL' }).id;
    const productId = makeProduct('SS-P1');
    StockService.addStockEntry({ product_id: productId, quantity: 100, unit_price: 60 });

    invoice(customerId, productId, 1, 100, '2000-01-02', '2000-01-01');

    const st = StatementRepository.getClientStatement(customerId);
    expect(st.overdue).toHaveLength(1);
    expect(st.overdue[0].status).toBe('EN_RETARD');
    expect(st.overdue[0].statusLabel).toBe('En retard');
    expect(st.overdue[0].daysUntilDue).toBeLessThan(0);

    const line = st.lines.find(l => l.kind === 'INVOICE')!;
    expect(line.dueStatus).toBe('EN_RETARD');
    expect(line.dueStatusLabel).toBe('En retard');

    // Cohérence STRICTE avec le moteur : même entrée → même verdict.
    const expected = evaluateCredit({
      totalDue: line.debit,
      amountPaid: 0,
      dueDate: line.dueDate as string,
    });
    expect(line.dueStatus).toBe(expected.status);
    expect(line.dueStatusLabel).toBe(expected.label);
  });

  it('échéance future → « À venir »', () => {
    const customerId = ClientRepository.create({ name: 'Client Futur', credit_limit: 0, category: 'DÉTAIL' }).id;
    const productId = makeProduct('SS-P2');
    StockService.addStockEntry({ product_id: productId, quantity: 100, unit_price: 60 });

    invoice(customerId, productId, 1, 100, '2099-12-31');

    const st = StatementRepository.getClientStatement(customerId);
    expect(st.upcoming).toHaveLength(1);
    expect(st.upcoming[0].status).toBe('A_VENIR');
    expect(st.upcoming[0].statusLabel).toBe('À venir');

    const line = st.lines.find(l => l.kind === 'INVOICE')!;
    expect(line.dueStatus).toBe('A_VENIR');
    expect(line.dueStatusLabel).toBe('À venir');
  });

  it('échéance AUJOURD’HUI → « À échéance » (jamais « En retard »)', () => {
    const customerId = ClientRepository.create({ name: 'Client Jour', credit_limit: 0, category: 'DÉTAIL' }).id;
    const productId = makeProduct('SS-P3');
    StockService.addStockEntry({ product_id: productId, quantity: 100, unit_price: 60 });

    const today = todayDateOnly();
    invoice(customerId, productId, 1, 100, today, today);

    const st = StatementRepository.getClientStatement(customerId);
    expect(st.overdue).toHaveLength(0);
    expect(st.upcoming).toHaveLength(1);
    expect(st.upcoming[0].status).toBe('A_ECHEANCE');
    expect(st.upcoming[0].statusLabel).toBe('À échéance');
    expect(st.upcoming[0].daysUntilDue).toBe(0);

    const line = st.lines.find(l => l.kind === 'INVOICE')!;
    expect(line.dueStatus).toBe('A_ECHEANCE');
    expect(line.dueStatusLabel).toBe('À échéance');
  });

  it('facture SOLDÉE avec échéance passée → « Payée », jamais « En retard »', () => {
    const customerId = ClientRepository.create({ name: 'Client Payé', credit_limit: 0, category: 'DÉTAIL' }).id;
    const productId = makeProduct('SS-P4');
    StockService.addStockEntry({ product_id: productId, quantity: 100, unit_price: 60 });

    const doc = invoice(customerId, productId, 1, 100, '2000-01-02', '2000-01-01');
    DocumentService.addPayment({ document_id: doc.id, amount: doc.total_incl_tax, payment_method: 'CASH' });

    const st = StatementRepository.getClientStatement(customerId);
    // Reste dû = 0 → aucune échéance ouverte, donc ni « en retard » ni « à venir ».
    expect(st.overdue).toHaveLength(0);
    expect(st.upcoming).toHaveLength(0);

    const line = st.lines.find(l => l.kind === 'INVOICE')!;
    expect(line.dueStatus).toBe('PAYE');
    expect(line.dueStatusLabel).toBe('Payée');
  });
});
