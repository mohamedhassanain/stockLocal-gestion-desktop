import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { db } from '../src/database/config/connection';

/**
 * Vérifie que `src/database/schema/database.sql` est LA source de vérité unique
 * et crée une base NEUVE complète (toutes les tables/contraintes/index attendus),
 * puis vérifie qu'un upgrade de base ANCIENNE préserve les données.
 */

const SCHEMA_PATH = path.join(process.cwd(), 'src', 'database', 'schema', 'database.sql');

function readSchema(): string {
  return fs.readFileSync(SCHEMA_PATH, 'utf-8');
}

function tableNames(d: Database.Database): string[] {
  return (d.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all() as Array<{ name: string }>).map(r => r.name);
}

function indexNames(d: Database.Database): string[] {
  return (d.prepare(`SELECT name FROM sqlite_master WHERE type='index'`).all() as Array<{ name: string }>).map(r => r.name);
}

const EXPECTED_TABLES = [
  'categories', 'subcategories', 'products',
  'stock_movements', 'inventory_balances',
  'customers', 'suppliers', 'client_credits', 'supplier_credits',
  'documents', 'credit_note_refs', 'document_items', 'payments',
  'document_sequences', 'audit_logs', 'company_settings', 'global_settings',
  'volume_discounts', 'warehouses', 'product_batches', 'unit_conversions', 'price_history',
  'purchase_orders', 'purchase_order_items',
  'inventory_sessions', 'inventory_items', 'inventory_versions', 'inventory_item_versions',
];

const EXPECTED_INDEXES = [
  'idx_products_reference', 'idx_products_barcode', 'idx_products_designation',
  'idx_products_category', 'idx_products_subcategory',
  'idx_stock_movements_product', 'idx_stock_movements_date', 'idx_stock_movements_type',
  'idx_stock_movements_movement_type', 'idx_stock_movements_document',
  'idx_documents_entity', 'idx_documents_status', 'idx_documents_date', 'idx_documents_type',
  'idx_document_items_document', 'idx_document_items_product',
  'idx_credit_note_refs_original', 'idx_credit_note_refs_credit',
  'idx_payments_document', 'idx_payments_date',
  'idx_audit_logs_entity', 'idx_audit_logs_date',
  'idx_customers_name', 'idx_customers_phone',
  'idx_client_credits_customer', 'idx_client_credits_date', 'idx_client_credits_type',
  'idx_suppliers_name', 'idx_supplier_credits_supplier', 'idx_supplier_credits_date',
  'idx_volume_discounts_qty',
  'idx_product_batches_product', 'idx_product_batches_expiry',
  'idx_price_history_product', 'idx_price_history_date',
  'idx_purchase_orders_supplier', 'idx_purchase_orders_status',
  'idx_purchase_order_items_order', 'idx_purchase_order_items_product',
  'idx_inventory_sessions_status', 'idx_inventory_items_session', 'idx_inventory_items_product',
  'idx_unit_conversions_product',
  'idx_inventory_versions_session', 'idx_inventory_item_versions_version', 'idx_inventory_item_versions_product',
];

describe('Database schema — database.sql is the single source of truth', () => {
  let freshDb: Database.Database;
  let freshDbPath: string;

  beforeEach(() => {
    freshDbPath = path.join(os.tmpdir(), `stocklocal-schema-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.db`);
    freshDb = new Database(freshDbPath);
  });

  afterAll(() => {
    try {
      // Ne pas fermer `db` — il est partagé par les autres suites. On nettoie la
      // base de test fraîche si elle est encore ouverte.
      freshDb?.close();
    } catch { /* ignore */ }
  });

  it('database.sql crée TOUTES les tables attendues sur une base neuve', () => {
    freshDb.exec(readSchema());
    const tables = tableNames(freshDb);
    for (const t of EXPECTED_TABLES) {
      expect(tables).toContain(t);
    }
  });

  it('database.sql crée TOUS les index attendus', () => {
    freshDb.exec(readSchema());
    const indexes = indexNames(freshDb);
    for (const i of EXPECTED_INDEXES) {
      expect(indexes).toContain(i);
    }
  });

  it('PRAGMA foreign_keys = ON + integrity_check = ok sur une base neuve', () => {
    freshDb.pragma('foreign_keys = ON');
    freshDb.exec(readSchema());
    const integrity = freshDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
    expect(integrity[0]?.integrity_check).toBe('ok');
    const fk = freshDb.pragma('foreign_key_check') as Array<Record<string, unknown>>;
    expect(fk).toHaveLength(0);
  });

  it('price_history utilise ON DELETE RESTRICT (donnée comptable protégée)', () => {
    freshDb.exec(readSchema());
    const sql = (freshDb.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='price_history'`).get() as { sql: string }).sql;
    expect(sql).toContain('ON DELETE RESTRICT');
  });

  it('les contraintes CHECK et UNIQUE sont présentes (stock_movements.quantity > 0)', () => {
    freshDb.exec(readSchema());
    const sql = (freshDb.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='stock_movements'`).get() as { sql: string }).sql;
    expect(sql).toContain('CHECK (quantity > 0)');
  });

  it('l\'application réelle créée via connection.ts expose bien les tables (intégration)', () => {
    const tables = tableNames(db);
    for (const t of ['products', 'stock_movements', 'inventory_sessions', 'price_history']) {
      expect(tables).toContain(t);
    }
  });

  it('UPGRADE d\'une base ANCIENNE : ajoute les colonnes manquantes sans perdre les données', () => {
    const oldDbPath = path.join(os.tmpdir(), `stocklocal-old-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.db`);
    const oldDb = new Database(oldDbPath);
    oldDb.pragma('foreign_keys = ON');
    oldDb.exec(`
      CREATE TABLE products (
        id TEXT PRIMARY KEY,
        reference TEXT NOT NULL UNIQUE,
        designation TEXT NOT NULL,
        description TEXT,
        category_id TEXT,
        subcategory_id TEXT,
        barcode TEXT UNIQUE,
        image_path TEXT,
        purchase_price REAL NOT NULL DEFAULT 0,
        selling_price REAL NOT NULL DEFAULT 0,
        wholesale_price REAL NOT NULL DEFAULT 0,
        min_stock INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'ACTIVE'
      );
      CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        document_number TEXT NOT NULL UNIQUE,
        entity_id TEXT NOT NULL,
        date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        total_excl_tax REAL NOT NULL DEFAULT 0,
        total_incl_tax REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'UNPAID'
      );
      INSERT INTO products (id, reference, designation, purchase_price, selling_price, wholesale_price, min_stock, status)
        VALUES ('p1', 'REF-1', 'Produit 1', 10, 20, 11, 5, 'ACTIVE');
      INSERT INTO documents (id, type, document_number, entity_id, date, total_excl_tax, total_incl_tax, status)
        VALUES ('d1', 'INVOICE', 'FAC-2025-00001', 'c1', '2025-01-01', 100, 120, 'UNPAID');
    `);
    oldDb.close();

    // Copier la « vieille » base vers un nouveau fichier, puis reproduire le
    // pipeline connection.ts : applySchema (CREATE TABLE IF NOT EXISTS) + upgrade.
    const upgradedPath = path.join(os.tmpdir(), `stocklocal-upgraded-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.db`);
    fs.copyFileSync(oldDbPath, upgradedPath);
    const upgraded = new Database(upgradedPath);
    upgraded.pragma('foreign_keys = ON');
    upgraded.exec(readSchema());

    const addCol = (t: string, c: string, d: string) => {
      const cols = (upgraded.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map(r => r.name);
      if (!cols.includes(c)) {
        upgraded.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${d}`);
      }
    };
    addCol('documents', 'due_date', 'DATETIME');
    addCol('documents', 'notes', 'TEXT');
    addCol('documents', 'total_tax', 'REAL NOT NULL DEFAULT 0.0');
    addCol('documents', 'discount_amount', 'REAL NOT NULL DEFAULT 0.0');
    addCol('products', 'unit', "TEXT NOT NULL DEFAULT 'PIÈCE'");
    addCol('products', 'vat_rate', 'REAL DEFAULT 20.0');
    addCol('products', 'max_stock', 'INTEGER DEFAULT 0');

    const p = upgraded.prepare('SELECT * FROM products WHERE id = ?').get('p1') as Record<string, unknown>;
    expect(p.reference).toBe('REF-1');
    expect(p.purchase_price).toBe(10);
    expect(p.unit).toBe('PIÈCE');
    const d = upgraded.prepare('SELECT * FROM documents WHERE id = ?').get('d1') as Record<string, unknown>;
    expect(d.document_number).toBe('FAC-2025-00001');
    expect(d.total_tax).toBe(0);

    const integrity = upgraded.pragma('integrity_check') as Array<{ integrity_check: string }>;
    expect(integrity[0]?.integrity_check).toBe('ok');
    upgraded.close();
  });

  it('UPGRADE — price_history CASCADE → RESTRICT sur une base ancienne (données conservées)', () => {
    const oldDbPath = path.join(os.tmpdir(), `stocklocal-ph-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.db`);
    const oldDb = new Database(oldDbPath);
    oldDb.pragma('foreign_keys = ON');
    oldDb.exec(`
      CREATE TABLE products (id TEXT PRIMARY KEY, reference TEXT NOT NULL UNIQUE, designation TEXT NOT NULL, barcode TEXT UNIQUE, category_id TEXT, subcategory_id TEXT);
      CREATE TABLE price_history (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        purchase_price REAL,
        selling_price REAL,
        wholesale_price REAL,
        changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        reason TEXT,
        FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
      );
      INSERT INTO products (id, reference, designation) VALUES ('p1', 'R1', 'P1');
      INSERT INTO price_history (id, product_id, purchase_price, selling_price) VALUES ('h1', 'p1', 5, 10);
    `);
    oldDb.close();

    const upPath = path.join(os.tmpdir(), `stocklocal-ph-up-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.db`);
    fs.copyFileSync(oldDbPath, upPath);
    const up = new Database(upPath);
    up.pragma('foreign_keys = ON');
    up.exec(readSchema());

    const phSql = (up.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='price_history'`).get() as { sql: string }).sql;
    if (phSql.includes('ON DELETE CASCADE')) {
      up.exec(`
        DROP TABLE IF EXISTS price_history_upgrade;
        CREATE TABLE price_history_upgrade (
          id TEXT PRIMARY KEY,
          product_id TEXT NOT NULL,
          purchase_price REAL,
          selling_price REAL,
          wholesale_price REAL,
          changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          reason TEXT,
          FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT
        );
        INSERT INTO price_history_upgrade (id, product_id, purchase_price, selling_price, wholesale_price, changed_at, reason)
          SELECT id, product_id, purchase_price, selling_price, wholesale_price, changed_at, reason FROM price_history;
        DROP TABLE price_history;
        ALTER TABLE price_history_upgrade RENAME TO price_history;
      `);
    }

    const h = up.prepare('SELECT * FROM price_history WHERE id = ?').get('h1') as Record<string, unknown>;
    expect(h.product_id).toBe('p1');
    expect(h.purchase_price).toBe(5);
    const newSql = (up.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='price_history'`).get() as { sql: string }).sql;
    expect(newSql).toContain('ON DELETE RESTRICT');
    up.close();
  });
});
