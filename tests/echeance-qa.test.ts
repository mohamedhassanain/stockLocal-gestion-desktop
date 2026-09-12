import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/database/config/connection';
import { DocumentService } from '../src/services/DocumentService';
import { DocumentRepository } from '../src/repositories/DocumentRepository';
import { DashboardRepository } from '../src/repositories/DashboardRepository';
import { ProductService } from '../src/services/ProductService';
import type { ProductInput } from '../src/repositories/ProductRepository';
import { StockService } from '../src/services/StockService';
import { StockLedgerService } from '../src/services/StockLedgerService';
import { ClientRepository } from '../src/repositories/ClientRepository';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeProduct(ref: string, price = 100, cost = 50): string {
  const input: ProductInput = {
    reference: ref,
    designation: `Produit ${ref}`,
    purchase_price: cost,
    selling_price: price,
    wholesale_price: cost + 5,
    min_stock: 1,
    unit: 'PIÈCE',
    status: 'ACTIVE',
  };
  return ProductService.createProduct(input).id;
}

function makeClient(name: string): string {
  return ClientRepository.create({
    name,
    credit_limit: 100000,
    category: 'DÉTAIL',
  }).id;
}

/** Insertion initiale de stock pour pouvoir vendre. */
function seedStock(productId: string, qty: number, unitPrice = 50): void {
  StockService.addStockEntry({ product_id: productId, quantity: qty, unit_price: unitPrice });
}

function clean(): void {
  // Base de test isolée : on désactive temporairement les FK pour un nettoyage
  // complet sans se soucier de l'ordre (RESTRICT entre tables). Remis à ON
  // immédiatement après, car le code métier doit tourner avec les FK actives.
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

/**
 * Construit une facture crédit (impayée) avec échéance et un produit en stock,
 * et configure le stock initial pour que la vente soit possible.
 */
function makeCreditInvoice(opts: {
  due_date?: string;
  date?: string;
  qty?: number;
  unit_price?: number;
  discount?: number;
} = {}) {
  const customerId = makeClient('Client QA');
  const productId = makeProduct('QA-PROD');
  const qty = opts.qty ?? 1;
  const unitPrice = opts.unit_price ?? 100;
  seedStock(productId, qty + 10, 50);
  const doc = DocumentService.createDocument({
    type: 'INVOICE',
    entity_id: customerId,
    date: opts.date ?? '2026-09-08',
    // Distingue "clé absente" (défaut '2026-09-15') de "due_date: undefined"
    // explicite (doit rester NULL) — `??` ne le permet pas.
    due_date: 'due_date' in opts ? opts.due_date : '2026-09-15',
    items: [{ product_id: productId, quantity: qty, unit_price: unitPrice, discount: opts.discount ?? 0 }],
  });
  return { customerId, productId, doc };
}

describe('Échéance — QA end-to-end (SQLite réel)', () => {
  beforeEach(() => { clean(); });

  // ── PARTIE 2 : Produit / Stock ─────────────────────────────────────────────
  it('B. Stock IN puis C. Stock OUT : stock before ± qty = stock after', () => {
    const pid = makeProduct('QA-STOCK', 100, 50);
    expect(StockLedgerService.getStockLevel(pid)).toBe(0);

    // Stock IN
    StockService.addStockEntry({ product_id: pid, quantity: 10, unit_price: 50 });
    expect(StockLedgerService.getStockLevel(pid)).toBe(10);

    // Stock OUT
    StockService.addStockExit({ product_id: pid, quantity: 4, unit_price: 50, exitType: 'VENTE' });
    expect(StockLedgerService.getStockLevel(pid)).toBe(6);
  });

  it('D. refuse une sortie qui créerait un stock négatif (transact. atomique)', () => {
    const pid = makeProduct('QA-NEG', 100, 50);
    StockService.addStockEntry({ product_id: pid, quantity: 5, unit_price: 50 });
    expect(() =>
      StockService.addStockExit({ product_id: pid, quantity: 6, unit_price: 50, exitType: 'VENTE' }),
    ).toThrow(/Stock insuffisant/);
    // Le stock reste inchangé : la transaction a rolled back.
    expect(StockLedgerService.getStockLevel(pid)).toBe(5);
  });

  // ── PARTIE 3 : Vente / Facture ─────────────────────────────────────────────
  it('crée une facture impayée avec échéance, stock décrémenté, total correct', () => {
    const { productId, doc } = makeCreditInvoice({ qty: 2, unit_price: 100, due_date: '2026-09-15' });

    expect(doc.type).toBe('INVOICE');
    expect(doc.document_number).toMatch(/^FAC-\d{4}-\d{5}$/);
    expect(doc.due_date).toBe('2026-09-15');
    // TVA 20% par défaut sur le produit : 2 × 100 = 200 HT, +20% = 240 TTC.
    expect(doc.total_excl_tax).toBe(200);
    expect(doc.total_tax).toBe(40);
    expect(doc.total_incl_tax).toBe(240);
    expect(doc.status).toBe('UNPAID');
    expect(doc.amount_paid).toBe(0);
    // Stock décrémenté de 2 (12 initiaux → 10).
    expect(StockLedgerService.getStockLevel(productId)).toBe(10);
  });

  it('cash payment (paiement intégral) : status PAID, remaining 0', () => {
    const { doc } = makeCreditInvoice({ qty: 1, unit_price: 100 });
    DocumentService.addPayment({ document_id: doc.id, amount: 120, payment_method: 'CASH' });
    const d = DocumentRepository.getById(doc.id)!;
    expect(d.amount_paid).toBe(120);
    expect(d.total_incl_tax - d.amount_paid!).toBe(0);
    expect(d.status).toBe('PAID');
  });

  it('partial payment : remaining = total - paid, status PARTIAL', () => {
    const { doc } = makeCreditInvoice({ qty: 10, unit_price: 100 }); // 1200 TTC
    DocumentService.addPayment({ document_id: doc.id, amount: 300, payment_method: 'CASH' });
    let d = DocumentRepository.getById(doc.id)!;
    expect(d.amount_paid).toBe(300);
    expect(d.total_incl_tax - d.amount_paid!).toBe(900);
    expect(d.status).toBe('PARTIAL');
  });

  it('credit sale (aucun paiement) : status UNPAID, remaining = total', () => {
    const { doc } = makeCreditInvoice({ qty: 3, unit_price: 100 }); // 360 TTC
    const d = DocumentRepository.getById(doc.id)!;
    expect(d.status).toBe('UNPAID');
    expect(d.total_incl_tax - d.amount_paid!).toBe(360);
  });

  // ── PARTIE 4/5 : Échéance — source de vérité & création ────────────────────
  it('enregistre due_date en SQLite telle que fournie (YYYY-MM-DD)', () => {
    const { doc } = makeCreditInvoice({ due_date: '2026-09-15' });
    const row = db.prepare('SELECT due_date FROM documents WHERE id = ?').get(doc.id) as { due_date: string };
    expect(row.due_date).toBe('2026-09-15');
    expect(doc.due_date).toBe('2026-09-15');
  });

  it('DashboardRepository.getUpcomingDues expose due_date / remaining / days_left cohérents', () => {
    const { doc } = makeCreditInvoice({ due_date: '2026-09-15', qty: 1, unit_price: 100 });
    const dues = DashboardRepository.getUpcomingDues(3650);
    const found = dues.find(d => d.id === doc.id);
    expect(found).toBeTruthy();
    expect(found!.document_number).toBe(doc.document_number);
    expect(found!.due_date).toBe('2026-09-15');
    expect(found!.remaining).toBe(120);
    // days_left est calculé par SQLite : relativement à "now" (voir §timezone).
    expect(typeof found!.days_left).toBe('number');
  });

  // ── PARTIE 6 : Validation des dates ────────────────────────────────────────
  it('Case A — due_date postérieure à la date facture : accepté', () => {
    const { doc } = makeCreditInvoice({ date: '2026-09-08', due_date: '2026-09-15' });
    expect(doc.due_date).toBe('2026-09-15');
  });

  it('Case B — due_date identique à la date facture : accepté (règle autorisée)', () => {
    const { doc } = makeCreditInvoice({ date: '2026-09-08', due_date: '2026-09-08' });
    expect(doc.due_date).toBe('2026-09-08');
  });

  it('Case C — due_date antérieure à la date facture : REJETÉ (règle §Phase 2.1)', () => {
    // §Phase 2.1 — Changement de comportement INTENTIONNEL et documenté :
    // l'ancien code acceptait silencieusement une échéance antérieure à la
    // facture. Désormais le service (source de vérité unique) la refuse.
    expect(() => makeCreditInvoice({ date: '2026-09-15', due_date: '2026-09-08' }))
      .toThrow(/échéance ne peut pas être antérieure/);
  });

  it('Case D — due_date vide : optionnel et stocké NULL', () => {
    const { doc } = makeCreditInvoice({ date: '2026-09-08', due_date: undefined });
    expect(doc.due_date).toBeNull();
  });

  // ── PARTIE 7 : Overdue / Retard ────────────────────────────────────────────
  it('future échéance : days_left > 0, non overdue', () => {
    // Date future mais DANS l'horizon du dashboard (3650 j). 2027-01-01 est
    // ~114 j après le "now" du test (2026-09-09) → jours > 0 et <= 3650.
    const { doc } = makeCreditInvoice({ due_date: '2027-01-01' });
    const dues = DashboardRepository.getUpcomingDues(3650);
    const found = dues.find(d => d.id === doc.id)!;
    expect(found.days_left).toBeGreaterThan(0);
  });

  it('échéance passée + impayée → overdue (days_left < 0, remaining > 0)', () => {
    // Facture ancienne ET échéance passée, mais échéance > date de facture (§2.1).
    const { doc } = makeCreditInvoice({ date: '2000-01-01', due_date: '2000-01-02' });
    const dues = DashboardRepository.getUpcomingDues(3650);
    const found = dues.find(d => d.id === doc.id)!;
    expect(found.days_left).toBeLessThan(0);
    expect(found.remaining).toBe(120);
  });

  it('échéance passée + intégralement payée → PAS affichée comme overdue (status PAID exclu)', () => {
    const { doc } = makeCreditInvoice({ date: '2000-01-01', due_date: '2000-01-02', qty: 1, unit_price: 100 });
    DocumentService.addPayment({ document_id: doc.id, amount: 120, payment_method: 'CASH' }); // PAID
    const dues = DashboardRepository.getUpcomingDues(3650);
    const found = dues.find(d => d.id === doc.id);
    // La requête filtre status IN ('UNPAID','PARTIAL') → un document PAID n'apparaît pas.
    expect(found).toBeUndefined();
  });

  it('échéance passée + partiellement payée → overdue avec remaining > 0', () => {
    const { doc } = makeCreditInvoice({ date: '2000-01-01', due_date: '2000-01-02', qty: 10, unit_price: 100 });
    DocumentService.addPayment({ document_id: doc.id, amount: 300, payment_method: 'CASH' }); // PARTIAL
    const dues = DashboardRepository.getUpcomingDues(3650);
    const found = dues.find(d => d.id === doc.id)!;
    expect(found.days_left).toBeLessThan(0);
    expect(found.remaining).toBe(900);
  });

  // ── PARTIE 8 : Paiement partiel puis complet ───────────────────────────────
  it('300 → 700, puis +300 → 400, puis +400 → PAID, échéance conservée', () => {
    const { doc } = makeCreditInvoice({ due_date: '2026-09-15', qty: 10, unit_price: 100 }); // 1200
    DocumentService.addPayment({ document_id: doc.id, amount: 300, payment_method: 'CASH' });
    let d = DocumentRepository.getById(doc.id)!;
    expect(d.amount_paid).toBe(300);
    expect(d.total_incl_tax - d.amount_paid!).toBe(900);
    expect(d.status).toBe('PARTIAL');

    DocumentService.addPayment({ document_id: doc.id, amount: 300, payment_method: 'CASH' });
    d = DocumentRepository.getById(doc.id)!;
    expect(d.amount_paid).toBe(600);
    expect(d.total_incl_tax - d.amount_paid!).toBe(600);
    expect(d.status).toBe('PARTIAL');

    DocumentService.addPayment({ document_id: doc.id, amount: 600, payment_method: 'CASH' });
    d = DocumentRepository.getById(doc.id)!;
    expect(d.amount_paid).toBe(1200);
    expect(d.total_incl_tax - d.amount_paid!).toBe(0);
    expect(d.status).toBe('PAID');
    // L'échéance ne disparaît pas après paiement complet.
    expect(d.due_date).toBe('2026-09-15');
  });

  // ── PARTIE 9 : Overpayment ─────────────────────────────────────────────────
  it('refuse un paiement supérieur au reste dû (pas de remaining négatif)', () => {
    const { doc } = makeCreditInvoice({ qty: 10, unit_price: 100 }); // 1200 TTC
    expect(() =>
      DocumentService.addPayment({ document_id: doc.id, amount: 1200 + 1, payment_method: 'CASH' }),
    ).toThrow(/dépasse le reste dû/);

    const d = DocumentRepository.getById(doc.id)!;
    expect(d.amount_paid).toBe(0);
    expect(d.total_incl_tax - d.amount_paid!).toBe(1200); // pas de -200
  });

  it('refuse un paiement sur un document déjà payé', () => {
    const { doc } = makeCreditInvoice({ qty: 1, unit_price: 100 });
    DocumentService.addPayment({ document_id: doc.id, amount: 120, payment_method: 'CASH' });
    expect(() =>
      DocumentService.addPayment({ document_id: doc.id, amount: 10, payment_method: 'CASH' }),
    ).toThrow(/déjà intégralement payé/);
  });

  // ── PARTIE 10 : Édition de l'échéance ──────────────────────────────────────
  it('met à jour due_date, sans doublon, persisté en SQLite', () => {
    const { doc, customerId } = makeCreditInvoice({ due_date: '2026-09-15', qty: 1, unit_price: 100 });
    const updated = DocumentService.updateDocument(doc.id, {
      entity_id: customerId,
      date: '2026-09-08',
      due_date: '2026-09-20',
      items: [{ product_id: (doc.items ?? [])[0].product_id, quantity: 1, unit_price: 100, discount: 0 }],
    });
    expect(updated.due_date).toBe('2026-09-20');

    // Aucun doublon
    const count = db.prepare('SELECT COUNT(*) AS c FROM documents WHERE id = ?').get(doc.id) as { c: number };
    expect(count.c).toBe(1);

    // Persisté : relu via repository
    const reloaded = DocumentRepository.getById(doc.id)!;
    expect(reloaded.due_date).toBe('2026-09-20');
  });

  // ── PARTIE 11 : Persistance (UI vs IPC vs Service vs SQLite) ──────────────
  it('due_date / total / paid / remaining / status identiques entre Service et SQLite', () => {
    const { doc } = makeCreditInvoice({ due_date: '2026-09-15', qty: 10, unit_price: 100 });
    DocumentService.addPayment({ document_id: doc.id, amount: 300, payment_method: 'CASH' });

    // Valeurs SQLite brutes
    const row = db.prepare('SELECT due_date, total_incl_tax, status FROM documents WHERE id = ?').get(doc.id) as {
      due_date: string; total_incl_tax: number; status: string;
    };
    const paidRow = db.prepare('SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE document_id = ?').get(doc.id) as { s: number };

    // Valeurs Service (repository enrichi)
    const d = DocumentRepository.getById(doc.id)!;
    expect(d.due_date).toBe(row.due_date);
    expect(d.total_incl_tax).toBe(row.total_incl_tax);
    expect(d.status).toBe(row.status);
    expect(d.amount_paid).toBe(paidRow.s);
    expect(d.total_incl_tax - d.amount_paid!).toBe(1200 - 300);

    // Coût moyen / solde de stock restant : seed = qty + 10 = 20, vendu 10 → 10.
    const productId = (d.items ?? [])[0].product_id;
    expect(StockLedgerService.getStockLevel(productId)).toBe(10);
  });

  // ── PARTIE 14 : Audit date / timezone ──────────────────────────────────────
  it('documente le comportement date-only vs toISOString (timezone UTC+1)', () => {
    // new Date("YYYY-MM-DD") est parsé en MINUIT UTC → en UTC+1 la date locale reste la même
    const parsed = new Date('2026-09-08');
    expect(parsed.toISOString().split('T')[0]).toBe('2026-09-08');

    // POSPage/NewDocumentModal utilisent new Date().toISOString().split('T')[0]
    // → la date est prise en UTC, pas en heure locale (risque off-by-one près de minuit).
    const localNow = new Date();
    const utcDate = localNow.toISOString().split('T')[0];
    const localDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(localNow);
    // Ceci est un constat de comportement, pas un échec : la différence éventuelle
    // est le bug off-by-one potentiel (documenté dans le rapport).
    expect(typeof utcDate).toBe('string');
    expect(typeof localDate).toBe('string');
  });
});
