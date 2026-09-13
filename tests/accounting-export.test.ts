import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { db } from '../src/database/config/connection';
import { AccountingExportService } from '../src/services/AccountingExportService';

/**
 * §Export comptable simplifié — le CSV doit refléter EXACTEMENT les données
 * saisies (CA net des avoirs, TVA, marge, dépenses, encaissements) et rester
 * aligné sur la méthode du tableau de bord (`getRevenueAndCost`).
 *
 * Période dédiée (2019-03) : aucun autre enregistrement n'y tombe, donc les
 * montants attendus sont exacts et non sensibles à l'ordre des tests.
 */

const P = 'TEST_ACC_';
const FROM = '2019-03-01';
const TO = '2019-03-31';
const IN_PERIOD = '2019-03-15 12:00:00';
const OUT_OF_PERIOD = '2019-04-15 12:00:00';

function cleanup(): void {
  // Ordre imposé par les FK : payments (RESTRICT) avant documents ;
  // documents cascade sur document_items / credit_note_refs ;
  // stock_movements (RESTRICT) avant products.
  db.prepare(`DELETE FROM payments WHERE document_id LIKE '${P}%'`).run();
  db.prepare(`DELETE FROM documents WHERE id LIKE '${P}%'`).run();
  db.prepare(`DELETE FROM stock_movements WHERE id LIKE '${P}%'`).run();
  db.prepare(`DELETE FROM expenses WHERE id LIKE '${P}%'`).run();
  db.prepare(`DELETE FROM products WHERE id LIKE '${P}%'`).run();
  db.prepare(`DELETE FROM customers WHERE id LIKE '${P}%'`).run();
  db.prepare(`DELETE FROM warehouses WHERE id LIKE '${P}%'`).run();
}

function seedWarehouse(): string {
  const id = `${P}wh`;
  db.prepare(`INSERT INTO warehouses (id, name, is_default) VALUES (?, ?, 0)`).run(id, 'Dépôt TEST ACC');
  return id;
}

function seedCustomer(): string {
  const id = `${P}customer`;
  db.prepare(`INSERT INTO customers (id, name) VALUES (?, ?)`).run(id, 'Client TEST ACC');
  return id;
}

function seedProduct(): string {
  const id = `${P}product`;
  db.prepare(`INSERT INTO products (id, reference, designation) VALUES (?, ?, ?)`)
    .run(id, 'REF-ACC', 'Produit TEST ACC');
  return id;
}

/**
 * Insère un document + ses lignes. `direction` = 1 pour une vente (CANCEL…),
 * -1 pour un avoir. Les TOTAUX du document restent POSITIFS en base (c'est le
 * calcul du CA qui les soustrait pour un avoir), tandis que les lignes
 * (`document_items.total`) sont stockées NÉGATIVES pour un avoir.
 */
function seedDocument(params: {
  suffix: string;
  type: 'INVOICE' | 'CREDIT_NOTE';
  date: string;
  ht: number;
  tax: number;
  productId: string;
  direction: 1 | -1;
}): string {
  const { suffix, type, date, ht, tax, productId, direction } = params;
  const id = `${P}doc-${suffix}`;
  db.prepare(`
    INSERT INTO documents (id, type, document_number, entity_id, date, total_excl_tax, total_tax, total_incl_tax, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PAID')
  `).run(id, type, `${P}NUM-${suffix}`, `${P}customer`, date, ht, tax, ht + tax);
  db.prepare(`
    INSERT INTO document_items (id, document_id, product_id, quantity, unit_price, discount, total, vat_rate)
    VALUES (?, ?, ?, 1, ?, 0, ?, 20)
  `).run(`${P}item-${suffix}`, id, productId, direction * ht, direction * ht);
  return id;
}

function seedExpense(id: string, category: string, amount: number, date: string): void {
  db.prepare(`INSERT INTO expenses (id, date, category, amount, payment_method) VALUES (?, ?, ?, ?, 'CASH')`)
    .run(id, date, category, amount);
}

function seedPayment(id: string, documentId: string, amount: number, method: string, date: string): void {
  db.prepare(`INSERT INTO payments (id, document_id, amount, payment_method, date) VALUES (?, ?, ?, ?, ?)`)
    .run(id, documentId, amount, method, date);
}

function seedPurchaseIn(id: string, productId: string, warehouseId: string, qty: number, unitCost: number, date: string): void {
  db.prepare(`
    INSERT INTO stock_movements (id, product_id, warehouse_id, type, movement_type, quantity, unit_price, unit_cost, date)
    VALUES (?, ?, ?, 'IN', 'PURCHASE_IN', ?, ?, ?, ?)
  `).run(id, productId, warehouseId, qty, unitCost, unitCost, date);
}

/** Lit le CSV généré et renvoie le contenu brut (BOM retiré). */
function readExport(from?: string, to?: string): string {
  const filePath = AccountingExportService.exportAccountingSummary(from, to);
  expect(fs.existsSync(filePath)).toBe(true);
  return fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
}

/**
 * Valeur d'une ligne `libellé;valeur1;valeur2…`. On exige que la ligne
 * COMMENCE par le libellé suivi de `;` : un titre de section qui contient les
 * mêmes mots (« --- TVA COLLECTÉE — … --- ») n'est donc jamais confondu.
 */
function valueOf(csv: string, label: string): string[] {
  const line = csv.split(/\r?\n/).find(l => l.startsWith(`${label};`));
  if (line === undefined) throw new Error(`Ligne absente du CSV : « ${label} »`);
  return line.split(';').slice(1);
}

describe("Export comptable simplifié — AccountingExportService", () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it('calcule un CA NET DES AVOIRS, la TVA et les dépenses de la période', () => {
    const wh = seedWarehouse();
    seedCustomer();
    const product = seedProduct();

    // Vente : 1000 HT + 200 TVA = 1200 TTC.
    seedDocument({ suffix: 'inv', type: 'INVOICE', date: IN_PERIOD, ht: 1000, tax: 200, productId: product, direction: 1 });
    // Avoir : 100 HT + 20 TVA = 120 TTC → vient en DÉDUCTION.
    seedDocument({ suffix: 'cn', type: 'CREDIT_NOTE', date: IN_PERIOD, ht: 100, tax: 20, productId: product, direction: -1 });

    seedExpense(`${P}exp1`, 'TRANSPORT', 300, IN_PERIOD);
    seedPayment(`${P}pay1`, `${P}doc-inv`, 1200, 'CASH', IN_PERIOD);
    seedPurchaseIn(`${P}mov1`, product, wh, 10, 5, IN_PERIOD);

    const csv = readExport(FROM, TO);

    // CA HT = 1000 − 100 = 900 ; TVA = 200 − 20 = 180 ; TTC = 1080.
    expect(valueOf(csv, 'Ventes nettes HT')[0]).toBe('900.00');
    expect(valueOf(csv, 'TVA collectée')[0]).toBe('180.00');
    expect(valueOf(csv, "Chiffre d'affaires TTC")[0]).toBe('1080.00');
    expect(valueOf(csv, 'Nombre de ventes')[0]).toBe('1');

    // Détail TVA par taux : base 900, TVA 180 (un seul taux, 20 %).
    expect(csv).toContain('20.00;900.00;180.00');

    // Coût des marchandises vendues = 0 (aucune sortie de stock) → marge = 900.
    expect(valueOf(csv, 'Coût des marchandises vendues')[0]).toBe('0.00');
    expect(valueOf(csv, 'Marge brute')[0]).toBe('900.00');

    // Dépenses : TRANSPORT 300.
    expect(csv).toContain('TRANSPORT;1;300.00');

    // Encaissements : Espèces 1200.
    expect(csv).toContain('Espèces;1;1200.00');

    // Achats : 10 × 5 = 50.
    expect(valueOf(csv, 'Nombre d\'entrées')[0]).toBe('1');
    expect(valueOf(csv, 'Valeur HT estimée des achats')[0]).toBe('50.00');
  });

  it('EXCLUT les enregistrements hors période', () => {
    seedWarehouse();
    seedCustomer();
    const product = seedProduct();

    seedDocument({ suffix: 'in', type: 'INVOICE', date: IN_PERIOD, ht: 1000, tax: 200, productId: product, direction: 1 });
    seedDocument({ suffix: 'out', type: 'INVOICE', date: OUT_OF_PERIOD, ht: 9999, tax: 1999.8, productId: product, direction: 1 });
    seedExpense(`${P}exp-out`, 'LOYER', 5000, OUT_OF_PERIOD);

    const csv = readExport(FROM, TO);

    expect(valueOf(csv, 'Ventes nettes HT')[0]).toBe('1000.00');
    expect(valueOf(csv, "Chiffre d'affaires TTC")[0]).toBe('1200.00');
    // La dépense hors période n'apparaît pas.
    expect(csv).not.toContain('LOYER');
    expect(csv).not.toContain('TRANSPORT');
  });

  it('sans bornes, couvre tout l\'historique (aucune erreur, sections présentes)', () => {
    seedWarehouse();
    seedCustomer();
    const product = seedProduct();
    seedDocument({ suffix: 'all', type: 'INVOICE', date: OUT_OF_PERIOD, ht: 250, tax: 50, productId: product, direction: 1 });

    const csv = readExport();

    expect(csv).toContain('Export comptable simplifié');
    expect(csv).toContain('--- CHIFFRE D\'AFFAIRES');
    // Une vente hors de la période précédente est bien prise en compte.
    expect(valueOf(csv, 'Ventes nettes HT')[0]).toBe('250.00');
    // La section « situation des tiers » est bien produite.
    expect(valueOf(csv, 'Créances clients (total)')).toHaveLength(1);
  });

  it('exclut les documents CANCELLED des agrégats', () => {
    seedWarehouse();
    seedCustomer();
    const product = seedProduct();

    const docId = seedDocument({ suffix: 'cancel', type: 'INVOICE', date: IN_PERIOD, ht: 700, tax: 140, productId: product, direction: 1 });
    db.prepare(`UPDATE documents SET status = 'CANCELLED' WHERE id = ?`).run(docId);

    const csv = readExport(FROM, TO);

    expect(valueOf(csv, 'Ventes nettes HT')[0]).toBe('0.00');
    expect(valueOf(csv, "Chiffre d'affaires TTC")[0]).toBe('0.00');
  });
});
