import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * ─── AUDIT BASE DE DONNÉES — §6 : migration d'une base EXISTANTE RÉELLE ───────
 *
 * On construit une base ANTÉRIEURE au multi-dépôts ET au module DGI (avec une
 * FK `users` historique, des quantités INTEGER, un `inventory_balances` à clé
 * simple, des documents sans colonnes DGI/TVA). On la fait migrer par le VRAI
 * pipeline `connection.ts`, puis on vérifie :
 *   - aucune perte de données (compteurs + TOTAUX FINANCIERS identiques) ;
 *   - un dépôt par défaut est créé et TOUS les mouvements y sont rattachés ;
 *   - dgi_status normalisé (jamais NULL) ;
 *   - foreign_key_check + integrity_check OK.
 */

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'stocklocal-dbaudit-mig-'));
const DATA_DIR = path.join(ROOT, 'data');
const LEGACY_DB = path.join(DATA_DIR, 'stocklocal.db');

interface Before {
  documents: { c: number; incl: number; excl: number };
  payments: { c: number; sum: number };
  movements: { c: number; inQty: number; outQty: number };
  balances: { c: number; qty: number; value: number };
}

let before: Before;

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
/* eslint-enable @typescript-eslint/no-explicit-any */

function buildLegacyDb(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const legacy = new Database(LEGACY_DB);
  legacy.pragma('foreign_keys = ON');
  legacy.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL);

    CREATE TABLE products (
      id TEXT PRIMARY KEY,
      reference TEXT NOT NULL UNIQUE,
      designation TEXT NOT NULL,
      purchase_price REAL NOT NULL DEFAULT 0,
      selling_price REAL NOT NULL DEFAULT 0,
      wholesale_price REAL NOT NULL DEFAULT 0,
      min_stock INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ACTIVE'
    );

    CREATE TABLE customers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT, address TEXT, ice TEXT,
      payment_conditions TEXT, credit_limit REAL DEFAULT 0
    );

    -- stock_movements ANCIENNE : quantité INTEGER, FK vers users, PAS de warehouse_id.
    CREATE TABLE stock_movements (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      type TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      unit_price REAL NOT NULL DEFAULT 0,
      date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reference_doc TEXT,
      supplier_id TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      user_id TEXT,
      FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT,
      FOREIGN KEY (user_id) REFERENCES users (id)
    );

    -- inventory_balances ANCIEN : clé simple product_id, pas de warehouse_id.
    CREATE TABLE inventory_balances (
      product_id TEXT PRIMARY KEY,
      quantity REAL NOT NULL DEFAULT 0,
      total_in_qty REAL NOT NULL DEFAULT 0,
      total_in_value REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT
    );

    -- documents ANCIEN : pas de colonnes DGI, ni total_tax, ni due_date/notes/discount_amount.
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

    -- document_items ANCIEN : quantité INTEGER.
    CREATE TABLE document_items (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      unit_price REAL NOT NULL,
      discount REAL DEFAULT 0,
      total REAL NOT NULL,
      FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT
    );

    CREATE TABLE payments (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL,
      date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reference TEXT,
      FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE RESTRICT
    );
  `);

  legacy.exec(`
    INSERT INTO users (id, username) VALUES ('u1', 'admin');
    INSERT INTO products (id, reference, designation, purchase_price, selling_price, wholesale_price, min_stock, status) VALUES
      ('p1', 'LEG-1', 'Produit legacy 1', 10, 20, 15, 0, 'ACTIVE'),
      ('p2', 'LEG-2', 'Produit legacy 2', 4, 9, 7, 0, 'ACTIVE');
    INSERT INTO customers (id, name, phone, address, ice, payment_conditions, credit_limit) VALUES
      ('c1', 'Client legacy', '0600', 'Casa', 'ICE1', 'COMPTANT', 0);

    INSERT INTO stock_movements (id, product_id, type, quantity, unit_price, date, user_id) VALUES
      ('m1', 'p1', 'IN', 100, 10, '2026-01-10T10:00:00.000Z', 'u1'),
      ('m2', 'p1', 'OUT', 30, 10, '2026-01-11T10:00:00.000Z', 'u1'),
      ('m3', 'p2', 'IN', 50, 4, '2026-01-12T10:00:00.000Z', 'u1');

    INSERT INTO inventory_balances (product_id, quantity, total_in_qty, total_in_value) VALUES
      ('p1', 70, 100, 1000),
      ('p2', 50, 50, 200);

    INSERT INTO documents (id, type, document_number, entity_id, date, total_excl_tax, total_incl_tax, status) VALUES
      ('d1', 'INVOICE', 'FAC-2026-00001', 'c1', '2026-01-10', 100, 120, 'UNPAID'),
      ('d2', 'INVOICE', 'FAC-2026-00002', 'c1', '2026-01-12', 50, 60, 'PARTIAL');
    INSERT INTO document_items (id, document_id, product_id, quantity, unit_price, discount, total) VALUES
      ('di1', 'd1', 'p1', 5, 20, 0, 100),
      ('di2', 'd2', 'p2', 5, 10, 0, 50);
    INSERT INTO payments (id, document_id, amount, payment_method, date) VALUES
      ('pay1', 'd1', 60, 'CASH', '2026-01-10'),
      ('pay2', 'd2', 20, 'CASH', '2026-01-12');
  `);

  const num = (sql: string) => Object.values(legacy.prepare(sql).get() as Record<string, number>)[0];
  before = {
    documents: {
      c: num('SELECT COUNT(*) FROM documents'),
      incl: num('SELECT COALESCE(SUM(total_incl_tax),0) FROM documents'),
      excl: num('SELECT COALESCE(SUM(total_excl_tax),0) FROM documents'),
    },
    payments: { c: num('SELECT COUNT(*) FROM payments'), sum: num('SELECT COALESCE(SUM(amount),0) FROM payments') },
    movements: {
      c: num('SELECT COUNT(*) FROM stock_movements'),
      inQty: num("SELECT COALESCE(SUM(quantity),0) FROM stock_movements WHERE type='IN'"),
      outQty: num("SELECT COALESCE(SUM(quantity),0) FROM stock_movements WHERE type='OUT'"),
    },
    balances: {
      c: num('SELECT COUNT(*) FROM inventory_balances'),
      qty: num('SELECT COALESCE(SUM(quantity),0) FROM inventory_balances'),
      value: num('SELECT COALESCE(SUM(total_in_value),0) FROM inventory_balances'),
    },
  };
  legacy.close();
}

beforeAll(async () => {
  buildLegacyDb();
  process.env.STOCKLOCAL_TEST_DATA_PATH = ROOT;
  vi.resetModules();
  const conn = await import('../src/database/config/connection');
  db = conn.db;
});

afterAll(() => {
  try { db?.close(); } catch { /* ignore */ }
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { /* Windows lock */ }
});

describe('§6 — Migration d\'une base existante réelle (aucune perte de données)', () => {
  it('conserve TOUS les totaux financiers et compteurs critiques', () => {
    const num = (sql: string) => Number((db.prepare(sql).get() as Record<string, number>)[Object.keys(db.prepare(sql).get() as Record<string, number>)[0]]);

    expect(num('SELECT COUNT(*) AS c FROM documents')).toBe(before.documents.c);
    expect(num('SELECT COALESCE(SUM(total_incl_tax),0) AS v FROM documents')).toBeCloseTo(before.documents.incl, 6);
    expect(num('SELECT COALESCE(SUM(total_excl_tax),0) AS v FROM documents')).toBeCloseTo(before.documents.excl, 6);

    expect(num('SELECT COUNT(*) AS c FROM payments')).toBe(before.payments.c);
    expect(num('SELECT COALESCE(SUM(amount),0) AS v FROM payments')).toBeCloseTo(before.payments.sum, 6);

    expect(num('SELECT COUNT(*) AS c FROM stock_movements')).toBe(before.movements.c);
    expect(num("SELECT COALESCE(SUM(quantity),0) AS v FROM stock_movements WHERE type='IN'")).toBeCloseTo(before.movements.inQty, 6);
    expect(num("SELECT COALESCE(SUM(quantity),0) AS v FROM stock_movements WHERE type='OUT'")).toBeCloseTo(before.movements.outQty, 6);

    expect(num('SELECT COUNT(*) AS c FROM products')).toBe(2);
    expect(num('SELECT COUNT(*) AS c FROM document_items')).toBe(2);
  });

  it('crée un dépôt par défaut et rattache TOUS les mouvements existants', () => {
    const def = db.prepare('SELECT id, name, is_default FROM warehouses WHERE is_default = 1').get() as { id: string; name: string; is_default: number };
    expect(def?.is_default).toBe(1);

    const total = Number((db.prepare('SELECT COUNT(*) AS c FROM stock_movements').get() as { c: number }).c);
    const attached = Number((db.prepare('SELECT COUNT(*) AS c FROM stock_movements WHERE warehouse_id = ?').get(def.id) as { c: number }).c);
    expect(attached).toBe(total);

    const nullish = Number((db.prepare("SELECT COUNT(*) AS c FROM stock_movements WHERE warehouse_id IS NULL OR warehouse_id=''").get() as { c: number }).c);
    expect(nullish).toBe(0);
  });

  it('les soldes restent identiques (recalculés depuis le journal, rattachés au dépôt)', () => {
    const num = (sql: string) => Object.values(db.prepare(sql).get() as Record<string, number>)[0];
    expect(num('SELECT COALESCE(SUM(quantity),0) FROM inventory_balances')).toBeCloseTo(before.balances.qty, 6);
    // p1 = +100 −30 = 70 ; p2 = +50 → total 120 (valeur d'entrée conservée).
    expect(num('SELECT COALESCE(SUM(total_in_qty),0) FROM inventory_balances')).toBeCloseTo(150, 6);
    expect(num('SELECT COALESCE(SUM(total_in_value),0) FROM inventory_balances')).toBeCloseTo(1200, 6);
    const withWarehouse = num("SELECT COUNT(*) FROM inventory_balances WHERE warehouse_id IS NULL OR warehouse_id=''");
    expect(withWarehouse).toBe(0);
  });

  it('dgi_status est normalisé à NOT_APPLICABLE (jamais NULL) après migration', () => {
    const nulls = Number((db.prepare('SELECT COUNT(*) AS c FROM documents WHERE dgi_status IS NULL').get() as { c: number }).c);
    expect(nulls).toBe(0);
    const wrong = Number((db.prepare("SELECT COUNT(*) AS c FROM documents WHERE dgi_status <> 'NOT_APPLICABLE'").get() as { c: number }).c);
    expect(wrong).toBe(0);
    // dgi_reference / dgi_submitted_at restent NULL (aucune soumission réelle).
    const refs = Number((db.prepare('SELECT COUNT(*) AS c FROM documents WHERE dgi_reference IS NOT NULL').get() as { c: number }).c);
    expect(refs).toBe(0);
  });

  it('recalcule la TVA des documents anciens (total_tax = TTC − HT)', () => {
    const d = db.prepare('SELECT total_excl_tax, total_tax, total_incl_tax FROM documents WHERE id = ?').get('d1') as { total_excl_tax: number; total_tax: number; total_incl_tax: number };
    expect(d.total_tax).toBeCloseTo(d.total_incl_tax - d.total_excl_tax, 6);
  });

  it('foreign_key_check vide et integrity_check = ok après migration', () => {
    expect(db.pragma('foreign_key_check') as unknown[]).toEqual([]);
    const integrity = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
    expect(integrity[0]?.integrity_check).toBe('ok');
  });
});
