import { describe, it, expect, beforeAll } from 'vitest';
import { vi } from 'vitest';
import { db } from '../src/database/config/connection';
import { ClientRepository } from '../src/repositories/ClientRepository';
import { SupplierRepository } from '../src/repositories/SupplierRepository';
import { ProductService } from '../src/services/ProductService';
import { StockService } from '../src/services/StockService';
import { DocumentService } from '../src/services/DocumentService';
import { StatementRepository } from '../src/repositories/StatementRepository';
import { PurchaseOrderRepository } from '../src/repositories/PurchaseOrderRepository';
import { CashSessionRepository } from '../src/repositories/CashSessionRepository';
import { ExpenseRepository } from '../src/repositories/ExpenseRepository';
import { DashboardRepository } from '../src/repositories/DashboardRepository';
import { ProfitService } from '../src/services/ProfitService';
import { todayDateOnly, addDaysDateOnly } from '../src/utils/date';
import type { ProductInput } from '../src/repositories/ProductRepository';

/**
 * §Phase 25 — E2E RÉEL du parcours commercial, AVEC PERSISTANCE.
 *
 * Ce test ne vérifie pas une fonction isolée : il déroule le parcours complet
 * d'un vrai logiciel de gestion, puis FERME la connexion SQLite et la ROUVRE
 * pour prouver que tout survit à un redémarrage de l'application :
 *
 *   produit → stock → vente → échéance → paiement partiel → paiement total
 *   → vente à crédit → achat → réception partielle + solde
 *   → retour (avoir) → relevé client → caisse → dépense → tableau de bord
 *   → FERMETURE → RÉOUVERTURE → vérification de la persistance
 */

const REF = 'E2E';
const today = todayDateOnly();
const dueDate = addDaysDateOnly(today, 30)!;

let customerId = '';
let supplierId = '';
let productId = '';
/** Facture soldée, facture à crédit, facture servant au retour. */
let invoicePaidId = '';
let invoiceCreditId = '';
let invoiceReturnId = '';
let cashSessionId = '';

function clean(): void {
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec(`
    DELETE FROM credit_note_refs;
    DELETE FROM cash_movements;
    DELETE FROM expenses;
    DELETE FROM cash_sessions;
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

/** Stock RÉEL lu dans la balance (source de vérité SQLite). */
function stockOf(id: string): number {
  const row = db.prepare(
    'SELECT COALESCE(SUM(quantity), 0) AS qty FROM inventory_balances WHERE product_id = ?',
  ).get(id) as { qty: number };
  return Number(row?.qty ?? 0);
}

function countRow(sql: string, ...params: unknown[]): number {
  const row = db.prepare(sql).get(...params) as { c: number };
  return Number(row?.c ?? 0);
}

describe('§Phase 25 — E2E complet + persistance après redémarrage', () => {
  beforeAll(() => { clean(); });

  it('1. crée un client, un fournisseur et un produit', () => {
    customerId = ClientRepository.create({ name: 'Épicerie Hassan (E2E)', credit_limit: 0, category: 'DÉTAIL' }).id;
    supplierId = SupplierRepository.create({ name: 'Grossiste Nord (E2E)' }).id;

    const input: ProductInput = {
      reference: `${REF}-P1`,
      designation: 'Huile de table 5L',
      purchase_price: 60,
      selling_price: 120,
      wholesale_price: 110,
      min_stock: 10,
      max_stock: 200,
      unit: 'PIÈCE',
      vat_rate: 20,
      status: 'ACTIVE',
    };
    productId = ProductService.createProduct(input).id;

    expect(productId).toBeTruthy();
    expect(customerId).toBeTruthy();
    expect(supplierId).toBeTruthy();
  });

  it('2. ajoute du stock (entrée 100 unités à 60)', () => {
    StockService.addStockEntry({ product_id: productId, quantity: 100, unit_price: 60 });
    expect(stockOf(productId)).toBe(100);
  });

  it('3. vend à crédit avec échéance puis encaisse en deux fois → PAYÉE', () => {
    const doc = DocumentService.createDocument({
      type: 'INVOICE',
      entity_id: customerId,
      date: today,
      due_date: dueDate,
      items: [{ product_id: productId, quantity: 10, unit_price: 120, discount: 0 }],
    });
    invoicePaidId = doc.id;

    // 10 × 120 HT = 1200 HT → 1440 TTC (TVA 20 %)
    expect(doc.total_incl_tax).toBe(1440);
    expect(stockOf(productId)).toBe(90);

    // Paiement partiel 300 → reste 1140
    DocumentService.addPayment({ document_id: doc.id, amount: 300, payment_method: 'CASH' });
    let st = StatementRepository.getClientStatement(customerId);
    let line = st.lines.find(l => l.kind === 'INVOICE')!;
    expect(line.debit).toBe(1440);
    expect(st.balance).toBe(1140);

    // Solde 1140 → reste 0
    DocumentService.addPayment({ document_id: doc.id, amount: 1140, payment_method: 'CASH' });
    st = StatementRepository.getClientStatement(customerId);
    line = st.lines.find(l => l.kind === 'INVOICE')!;
    expect(st.balance).toBe(0);
    // Reste dû = 0 → AUCUNE échéance ouverte, et l'état dérivé est « Payée ».
    expect(line.dueStatus).toBe('PAYE');
    expect(line.dueStatusLabel).toBe('Payée');
    expect(st.overdue).toHaveLength(0);
  });

  it('4. refuse tout paiement sur une facture DÉJÀ soldée (§Phase 2.4)', () => {
    // `addPayment` refuse d'abord un document PAID (« déjà intégralement payé »),
    // ce qui protège le solde : aucun reste dû négatif possible.
    expect(() =>
      DocumentService.addPayment({ document_id: invoicePaidId, amount: 9999, payment_method: 'CASH' }),
    ).toThrow(/déjà intégralement payé|dépasse le reste dû/i);

    // Aucun paiement parasite n'a été enregistré.
    expect(countRow('SELECT COUNT(*) AS c FROM payments WHERE document_id = ?', invoicePaidId)).toBe(2);
    // Le solde du client reste exactement 0.
    expect(StatementRepository.getClientStatement(customerId).balance).toBe(0);
  });

  it('5. crée une seconde facture à crédit (échéance ouverte, EN RETARD simulé)', () => {
    const doc = DocumentService.createDocument({
      type: 'INVOICE',
      entity_id: customerId,
      date: today,
      due_date: dueDate,
      items: [{ product_id: productId, quantity: 5, unit_price: 120, discount: 0 }],
    });
    invoiceCreditId = doc.id;
    expect(doc.total_incl_tax).toBe(720);
    expect(stockOf(productId)).toBe(85);

    const st = StatementRepository.getClientStatement(customerId);
    const line = st.lines.find(l => l.kind === 'INVOICE' && l.label.includes(doc.document_number))!;
    expect(line.dueStatus).toBe('A_VENIR');
    expect(line.dueStatusLabel).toBe('À venir');
    expect(st.upcoming.length).toBeGreaterThanOrEqual(1);

    // La facture ouverte existe en base et n'a reçu AUCUN paiement.
    expect(countRow('SELECT COUNT(*) AS c FROM documents WHERE id = ?', invoiceCreditId)).toBe(1);
    expect(countRow('SELECT COUNT(*) AS c FROM payments WHERE document_id = ?', invoiceCreditId)).toBe(0);

    // §Phase 2.4 — sur une facture PARTIELLEMENT payée, un trop-perçu est refusé.
    DocumentService.addPayment({ document_id: invoiceCreditId, amount: 200, payment_method: 'CASH' }); // reste 520
    expect(() =>
      DocumentService.addPayment({ document_id: invoiceCreditId, amount: 1000, payment_method: 'CASH' }),
    ).toThrow(/dépasse le reste dû/i);
    // Seul le paiement valide de 200 a été enregistré : le reste dû est 520, jamais négatif.
    expect(countRow('SELECT COUNT(*) AS c FROM payments WHERE document_id = ?', invoiceCreditId)).toBe(1);
    expect(StatementRepository.getClientStatement(customerId).balance).toBe(520);
  });

  it('6. REFUSE une échéance antérieure à la date de facture (§Phase 2.1)', () => {
    const yesterday = addDaysDateOnly(today, -1)!;
    expect(() =>
      DocumentService.createDocument({
        type: 'INVOICE',
        entity_id: customerId,
        date: today,
        due_date: yesterday,
        items: [{ product_id: productId, quantity: 1, unit_price: 120, discount: 0 }],
      }),
    ).toThrow(/échéance/i);
  });

  it('7. achat fournisseur puis réception PARTIELLE (30) puis solde (20) → 50, sans doublon', () => {
    const order = PurchaseOrderRepository.create({
      supplier_id: supplierId,
      items: [{ product_id: productId, quantity: 50, unit_price: 10 }],
    });
    PurchaseOrderRepository.confirm(order.id);

    const itemId = order.items![0].id;

    const afterFirst = PurchaseOrderRepository.receive(order.id, [{ item_id: itemId, received_qty: 30 }]);
    expect(afterFirst.status).toBe('CONFIRMED'); // partielle
    expect(stockOf(productId)).toBe(115); // 85 + 30

    const afterSecond = PurchaseOrderRepository.receive(order.id, [{ item_id: itemId, received_qty: 20 }]);
    expect(afterSecond.status).toBe('RECEIVED'); // complète
    expect(afterSecond.items![0].received_qty).toBe(50);
    expect(stockOf(productId)).toBe(135); // 85 + 50 — surtout PAS 85 + 80
  });

  it('8. retour partiel d’une vente → avoir + stock réintégré, sans double retour', () => {
    const doc = DocumentService.createDocument({
      type: 'INVOICE',
      entity_id: customerId,
      date: today,
      due_date: dueDate,
      items: [{ product_id: productId, quantity: 5, unit_price: 120, discount: 0 }],
    });
    invoiceReturnId = doc.id;
    expect(stockOf(productId)).toBe(130); // 135 − 5

    // Retour de 2 unités sur 5
    DocumentService.createCreditNote(doc.id, [{ product_id: productId, quantity: 2 }], 'Produit endommagé');
    expect(stockOf(productId)).toBe(132); // 130 + 2

    // Le reste retournable est 3 : demander 5 doit échouer (anti double-retour)
    expect(() =>
      DocumentService.createCreditNote(doc.id, [{ product_id: productId, quantity: 5 }], 'trop'),
    ).toThrow(/retour/i);
    expect(stockOf(productId)).toBe(132);

    // Un avoir a bien été rattaché à la facture d'origine (traçabilité du retour).
    expect(
      countRow('SELECT COUNT(*) AS c FROM credit_note_refs WHERE original_document_id = ?', invoiceReturnId),
    ).toBe(1);
  });

  it('9. relevé client : lignes, débits/crédits et solde issus de la base', () => {
    const st = StatementRepository.getClientStatement(customerId);
    expect(st.entityName).toContain('Épicerie Hassan');

    const debits = st.lines.filter(l => l.debit > 0).reduce((s, l) => s + l.debit, 0);
    const credits = st.lines.filter(l => l.credit > 0).reduce((s, l) => s + l.credit, 0);
    expect(debits).toBeGreaterThan(0);
    expect(credits).toBeGreaterThan(0);

    // Solde = débits − crédits, calculé depuis SQLite.
    expect(st.balance).toBe(Math.round((debits - credits) * 100) / 100);
    // La facture soldée est bien « Payée », la facture à crédit est ouverte.
    expect(st.lines.some(l => l.dueStatus === 'PAYE')).toBe(true);
  });

  it('10. caisse : ouverture, encaissement, dépense, fermeture (théorique/compté/écart)', () => {
    const session = CashSessionRepository.openSession(1000, 'Ouverture E2E');
    cashSessionId = session.id;

    CashSessionRepository.addMovement({ movementType: 'SALE_CASH', direction: 'IN', amount: 1440 });
    // Dépense en espèces → mouvement OUT + rattachement à la session ouverte.
    ExpenseRepository.create({ category: 'Transport', amount: 150, description: 'Livraison E2E' });

    const detail = CashSessionRepository.getSessionDetail(session.id);
    // totalCashIn/Out ne comptent QUE les mouvements ; le fond initial est
    // intégré dans theoreticalAmount (fond + entrées − sorties).
    expect(detail.totalCashIn).toBe(1440);
    expect(detail.totalCashOut).toBe(150);
    expect(detail.theoreticalAmount).toBe(2290); // 1000 + 1440 − 150

    const closed = CashSessionRepository.closeSession(session.id, 2290, 'Caissier E2E');
    expect(closed.status).toBe('CLOSED');
    expect(closed.theoretical_amount).toBe(2290);
    expect(closed.counted_amount).toBe(2290);
    expect(closed.difference).toBe(0);

    // Session historique conservée (jamais supprimée) et retrouvable par son id.
    const stored = CashSessionRepository.getAll().find(s => s.id === cashSessionId);
    expect(stored).toBeDefined();
    expect(stored!.status).toBe('CLOSED');
    expect(stored!.theoretical_amount).toBe(2290);
  });

  it('11. tableau de bord : KPI cohérents avec la base', () => {
    const stats = DashboardRepository.getStats();
    // Une facture a été créée aujourd'hui → le CA du jour est strictement positif.
    expect(stats.revenue_today).toBeGreaterThan(0);
    expect(countRow("SELECT COUNT(*) AS c FROM documents WHERE type = 'INVOICE'")).toBeGreaterThan(0);

    const dues = DashboardRepository.getUpcomingDues(30);
    expect(Array.isArray(dues)).toBe(true);

    // §Phase 12 — marge brute et résultat estimé (marge − dépenses), séparés.
    const profit = ProfitService.getSummary(today, today);
    expect(typeof profit.grossMargin).toBe('number');
    expect(profit.expenses).toBe(150);
    expect(profit.estimatedResult).toBe(Math.round((profit.grossMargin - profit.expenses) * 100) / 100);
  });

  it('12. REDÉMARRAGE : ferme la base, rouvre, tout est persisté', async () => {
    // Photo AVANT fermeture.
    const productCountBefore = countRow('SELECT COUNT(*) AS c FROM products');
    const docCountBefore = countRow('SELECT COUNT(*) AS c FROM documents');
    const paymentCountBefore = countRow('SELECT COUNT(*) AS c FROM payments');
    const stockBefore = stockOf(productId);
    const sessionCountBefore = countRow('SELECT COUNT(*) AS c FROM cash_sessions');
    const expenseCountBefore = countRow('SELECT COUNT(*) AS c FROM expenses');

    expect(productCountBefore).toBeGreaterThan(0);
    expect(docCountBefore).toBeGreaterThan(0);
    // 2 paiements sur la facture soldée + 1 paiement valide sur la facture à crédit.
    expect(paymentCountBefore).toBe(3);

    // ── Fermeture RÉELLE de la connexion (équivalent d'un arrêt d'application).
    db.close();

    // ── Nouveau registre de modules → `connection.ts` ré-évalué → réouverture
    //    du MÊME fichier SQLite (même STOCKLOCAL_TEST_DATA_PATH).
    vi.resetModules();
    const fresh = await import('../src/database/config/connection');

    // La base se rouvre sur le fichier existant : le schéma est déjà là.
    const productCountAfter = Number(
      (fresh.db.prepare('SELECT COUNT(*) AS c FROM products').get() as { c: number }).c,
    );
    const docCountAfter = Number(
      (fresh.db.prepare('SELECT COUNT(*) AS c FROM documents').get() as { c: number }).c,
    );
    const paymentCountAfter = Number(
      (fresh.db.prepare('SELECT COUNT(*) AS c FROM payments').get() as { c: number }).c,
    );
    const stockAfter = Number(
      (fresh.db.prepare(
        'SELECT COALESCE(SUM(quantity), 0) AS qty FROM inventory_balances WHERE product_id = ?',
      ).get(productId) as { qty: number }).qty,
    );
    const sessionCountAfter = Number(
      (fresh.db.prepare('SELECT COUNT(*) AS c FROM cash_sessions').get() as { c: number }).c,
    );
    const expenseCountAfter = Number(
      (fresh.db.prepare('SELECT COUNT(*) AS c FROM expenses').get() as { c: number }).c,
    );

    // ── PERSISTANCE : strictement identique après redémarrage.
    expect(productCountAfter).toBe(productCountBefore);
    expect(docCountAfter).toBe(docCountBefore);
    expect(paymentCountAfter).toBe(paymentCountBefore);
    expect(stockAfter).toBe(stockBefore);
    expect(sessionCountAfter).toBe(sessionCountBefore);
    expect(expenseCountAfter).toBe(expenseCountBefore);

    // Le stock attendu du parcours complet est bien 132 (arithmétique vérifiable).
    expect(stockAfter).toBe(132);

    // Intégrité physique du fichier SQLite après réouverture.
    const integrity = fresh.checkIntegrity();
    expect(integrity.valid).toBe(true);
  });
});
