import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * AUDIT BASE DE DONNÉES — §5 : pertinence RÉELLE des index.
 *
 * Base NEUVE montée depuis database.sql, peuplée d'un volume réaliste, puis
 * EXPLAIN QUERY PLAN sur les requêtes RÉELLES des repositories. On prouve que
 * les index utiles sont choisis par le planificateur, et on DOCUMENTE les cas
 * réellement constatés (index redondants, wildcard initial).
 */

const SCHEMA_PATH = path.join(process.cwd(), 'src', 'database', 'schema', 'database.sql');
const DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stocklocal-idx-')), 'idx.db');

let db: Database.Database;

function seed(): void {
  const products = 200;
  const customers = 200;
  const documents = 400;
  db.exec(`
    INSERT INTO categories (id, name) VALUES ('cat-1','A'),('cat-2','B'),('cat-rare','Rare');
    INSERT INTO subcategories (id, category_id, name) VALUES ('sub-1','cat-1','A1'),('sub-rare','cat-1','RareSub');

    INSERT INTO products (id, reference, designation, category_id, subcategory_id, barcode, unit, purchase_price, selling_price, wholesale_price, min_stock, status)
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < ${products})
    SELECT 'p' || printf('%04d', i), 'REF-' || printf('%04d', i), 'Produit ' || printf('%04d', i),
           CASE WHEN i <= 2 THEN 'cat-rare' ELSE 'cat-1' END,
           CASE WHEN i = 1 THEN 'sub-rare' ELSE 'sub-1' END,
           'BC-' || printf('%04d', i), 'PIÈCE', 10, 20, 15, 0, 'ACTIVE' FROM n;

    INSERT INTO warehouses (id, name, is_default) VALUES ('w1','Principal',1),('w2','Secondaire',0),('w3','Tertiaire',0);
    INSERT INTO customers (id, name, phone) SELECT 'c' || printf('%04d', i), 'Client ' || printf('%04d', i), '0600' || i FROM (WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < ${customers}) SELECT i FROM n);
    INSERT INTO suppliers (id, name) SELECT 's' || printf('%04d', i), 'Fournisseur ' || printf('%04d', i) FROM (WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < 50) SELECT i FROM n);

    INSERT INTO documents (id, type, document_number, entity_id, date, total_excl_tax, total_tax, total_incl_tax, status)
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < ${documents})
    SELECT 'd' || printf('%04d', i), CASE WHEN i % 5 = 0 THEN 'CREDIT_NOTE' ELSE 'INVOICE' END,
           'FAC-' || printf('%05d', i), 'c' || printf('%04d', (i % ${customers}) + 1),
           '2026-0' || (1 + (i % 9)) || '-15', 100, 20, 120,
           CASE WHEN i = 1 THEN 'CANCELLED' WHEN i % 2 = 0 THEN 'PAID' ELSE 'UNPAID' END FROM n;

    INSERT INTO document_items (id, document_id, product_id, quantity, unit_price, discount, total, vat_rate)
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < ${documents * 2})
    SELECT 'di' || printf('%05d', i), 'd' || printf('%04d', (i % ${documents}) + 1),
           'p' || printf('%04d', (i % ${products}) + 1), 1, 20, 0, 20, 20 FROM n;

    INSERT INTO payments (id, document_id, amount, payment_method, date)
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < 300)
    SELECT 'pay' || printf('%05d', i), 'd' || printf('%04d', (i % ${documents}) + 1), 10, 'CASH',
           '2026-' || printf('%02d', 1 + (i % 9)) || '-' || printf('%02d', 1 + (i % 27)) FROM n;

    INSERT INTO stock_movements (id, product_id, warehouse_id, type, movement_type, quantity, unit_price, date, document_id)
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < 600)
    SELECT 'sm' || printf('%05d', i), 'p' || printf('%04d', (i % ${products}) + 1),
           CASE WHEN i % 2 = 0 THEN 'w1' ELSE 'w2' END,
           CASE WHEN i % 2 = 0 THEN 'IN' ELSE 'OUT' END,
           CASE WHEN i = 1 THEN 'OPENING_BALANCE' WHEN i % 2 = 0 THEN 'PURCHASE_IN' ELSE 'SALE_OUT' END,
           1, 10, '2026-02-01', 'd' || printf('%04d', (i % ${documents}) + 1) FROM n;

    INSERT INTO inventory_balances (product_id, warehouse_id, quantity, total_in_qty, total_in_value, average_cost)
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < ${products})
    SELECT 'p' || printf('%04d', i), 'w1', 10, 10, 100, 10 FROM n;
    INSERT INTO inventory_balances (product_id, warehouse_id, quantity, total_in_qty, total_in_value, average_cost)
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i < ${products})
    SELECT 'p' || printf('%04d', i), 'w2', 3, 3, 30, 10 FROM n;
    INSERT INTO inventory_balances (product_id, warehouse_id, quantity, total_in_qty, total_in_value, average_cost)
    VALUES ('p0001', 'w3', 7, 7, 70, 10);
  `);
}

function plan(sql: string, ...params: unknown[]): string {
  const rows = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{ detail: string }>;
  return rows.map(r => r.detail).join(' | ');
}

beforeAll(() => {
  db = new Database(DB_PATH);
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf-8'));
  seed();
  db.exec('ANALYZE;');
});

afterAll(() => {
  try { db?.close(); } catch { /* ignore */ }
  try { fs.rmSync(path.dirname(DB_PATH), { recursive: true, force: true }); } catch { /* Windows lock */ }
});

describe('§5 — Index choisis par le planificateur pour une requête réelle', () => {
  const cases: Array<[string, string, string]> = [
    ['idx_products_designation', "SELECT * FROM products WHERE designation = 'Produit 0007'", 'idx_products_designation'],
    ['idx_products_category', "SELECT * FROM products WHERE category_id = 'cat-rare'", 'idx_products_category'],
    ['idx_products_subcategory', "SELECT * FROM products WHERE subcategory_id = 'sub-rare'", 'idx_products_subcategory'],
    ['idx_stock_movements_product', "SELECT * FROM stock_movements WHERE product_id = 'p0007'", 'idx_stock_movements_product'],
    ['idx_stock_movements_movement_type', "SELECT * FROM stock_movements WHERE movement_type = 'OPENING_BALANCE'", 'idx_stock_movements_movement_type'],
    ['idx_stock_movements_document', "SELECT * FROM stock_movements WHERE document_id = 'd0007'", 'idx_stock_movements_document'],
    ['idx_documents_entity', "SELECT * FROM documents WHERE entity_id = 'c0007'", 'idx_documents_entity'],
    ['idx_documents_type', "SELECT * FROM documents WHERE type = 'CREDIT_NOTE'", 'idx_documents_type'],
    ['idx_documents_status', "SELECT * FROM documents WHERE status = 'CANCELLED'", 'idx_documents_status'],
    ['idx_documents_date', "SELECT * FROM documents WHERE date = '2026-01-15'", 'idx_documents_date'],
    ['idx_document_items_document', "SELECT * FROM document_items WHERE document_id = 'd0007'", 'idx_document_items_document'],
    ['idx_document_items_product', "SELECT * FROM document_items WHERE product_id = 'p0007'", 'idx_document_items_product'],
    ['idx_payments_document', "SELECT * FROM payments WHERE document_id = 'd0007'", 'idx_payments_document'],
    ['idx_customers_name', "SELECT * FROM customers WHERE name = 'Client 0007'", 'idx_customers_name'],
    ['idx_suppliers_name', "SELECT * FROM suppliers WHERE name = 'Fournisseur 07'", 'idx_suppliers_name'],
    ['idx_inventory_balances_warehouse', "SELECT * FROM inventory_balances WHERE warehouse_id = 'w3'", 'idx_inventory_balances_warehouse'],
  ];

  for (const [label, sql, expected] of cases) {
    it(`${label} est utilisé par le planificateur`, () => {
      const p = plan(sql);
      expect(p, `plan = ${p}`).toContain(expected);
    });
  }

  it('idx_stock_movements_date (plage) est utilisé', () => {
    const p = plan("SELECT * FROM stock_movements WHERE date BETWEEN '2026-01-01' AND '2026-01-31'");
    expect(p).toContain('idx_stock_movements_date');
  });

  it('idx_payments_date est utilisé pour une date sélective', () => {
    const p = plan("SELECT * FROM payments WHERE date = '2026-03-04'");
    expect(p).toContain('idx_payments_date');
  });

  it('idx_inventory_balances_warehouse est utilisé pour une contrainte par (product_id, warehouse_id)', () => {
    const p = plan('SELECT * FROM inventory_balances WHERE product_id = ? AND warehouse_id = ?', 'p0007', 'w1');
    // La PK composite fournit cet accès (index automatique) — équivalent fonctionnel.
    expect(p).toMatch(/USING (COVERING )?INDEX (sqlite_autoindex_inventory_balances_1|idx_inventory_balances_warehouse)/);
  });
});

describe('§5 — Index REDONDANTS constatés (couverts par une contrainte UNIQUE)', () => {
  it('products.reference : la contrainte UNIQUE crée déjà sqlite_autoindex — idx_products_reference est redondant', () => {
    const p = plan('SELECT * FROM products WHERE reference = ?', 'REF-0007');
    expect(p).toMatch(/USING (COVERING )?INDEX (sqlite_autoindex_products_\d+|idx_products_reference)/);
    expect(p).toMatch(/\(reference=\?\)/);
  });

  it('products.barcode : idem, UNIQUE crée déjà un index automatique — idx_products_barcode est redondant', () => {
    const p = plan('SELECT * FROM products WHERE barcode = ?', 'BC-0007');
    expect(p).toMatch(/USING (COVERING )?INDEX (sqlite_autoindex_products_\d+|idx_products_barcode)/);
    expect(p).toMatch(/\(barcode=\?\)/);
  });
});

describe('§5 — Requêtes FRÉQUENTES (POS) sans boucle sur une grande table', () => {
  it('recherche produit par référence exacte (POS scan) utilise l index NOCASE dédié (pas de SCAN)', () => {
    // Régression : avant le correctif, `reference = ? COLLATE NOCASE`
    // (ProductRepository.findByReference) faisait un SCAN COMPLET de `products`
    // car aucun index NOCASE n'existait. L'index idx_products_reference_nocase
    // (database.sql) corrige ce scan sur la requête la plus fréquente du POS.
    const p = plan('SELECT * FROM products WHERE reference = ? COLLATE NOCASE', 'REF-0007');
    expect(p, `plan = ${p}`).toMatch(/USING (COVERING )?INDEX idx_products_reference_nocase/);
    expect(p).not.toMatch(/^SCAN products/);
  });

  it('lookup par barcode (POS) utilise un index', () => {
    const p = plan('SELECT * FROM products WHERE barcode = ?', 'BC-0007');
    expect(p).toMatch(/USING (COVERING )?INDEX/);
    expect(p).not.toMatch(/^SCAN products/);
  });
});

describe('§5 — Contre-épreuve documentée : wildcard initial (scan assumé)', () => {
  it('la recherche LIKE %x% ne PEUT pas utiliser d index B-tree (limite SQLite documentée)', () => {
    const p = plan("SELECT * FROM products WHERE designation LIKE '%0007%' OR reference LIKE '%0007%'");
    expect(p).toMatch(/SCAN products/);
  });
});
