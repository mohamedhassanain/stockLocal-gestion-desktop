import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Migration multi-dépôts — PREUVE sur une base LEGACY réelle (pas une base neuve).
 *
 * On construit une base au schéma D'AVANT la mission :
 *   - `stock_movements` SANS `warehouse_id` ;
 *   - `inventory_balances` à clé SIMPLE `product_id` ;
 *   - pas de table `warehouses` ni `stock_transfers`.
 * On la fait migrer par le VRAI `initDb()` de connection.ts (import dynamique
 * après `vi.resetModules()`), puis on vérifie que :
 *   - un dépôt par défaut est créé ;
 *   - TOUS les mouvements existants y sont rattachés (aucune perte) ;
 *   - les soldes après migration sont IDENTIQUES aux soldes avant migration ;
 *   - `inventory_balances` a désormais la clé composite (produit, dépôt) ;
 *   - l'intégrité physique + référentielle est OK.
 */

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'stocklocal-legacy-'));
const DATA_DIR = path.join(ROOT, 'data');

// Soldes « avant migration » (référence) — doivent être reproduits à l'identique.
const BEFORE = { p1: 70, p2: 60 };

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
let StockLedgerService: any;
let WarehouseRepository: any;
/* eslint-enable @typescript-eslint/no-explicit-any */

function buildLegacyDb(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const legacy = new Database(path.join(DATA_DIR, 'stocklocal.db'));
  legacy.pragma('journal_mode = WAL');
  legacy.exec(`
    CREATE TABLE products (
      id TEXT PRIMARY KEY,
      reference TEXT NOT NULL UNIQUE,
      designation TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'PIÈCE',
      purchase_price REAL NOT NULL DEFAULT 0,
      selling_price REAL NOT NULL DEFAULT 0,
      wholesale_price REAL NOT NULL DEFAULT 0,
      min_stock INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE stock_movements (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      type TEXT NOT NULL,
      movement_type TEXT NOT NULL DEFAULT 'ADJUSTMENT_IN',
      quantity REAL NOT NULL CHECK (quantity > 0),
      unit_price REAL NOT NULL DEFAULT 0,
      date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reference_doc TEXT,
      document_id TEXT,
      supplier_id TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT
    );

    CREATE TABLE inventory_balances (
      product_id TEXT PRIMARY KEY,
      quantity REAL NOT NULL DEFAULT 0,
      total_in_qty REAL NOT NULL DEFAULT 0,
      total_in_value REAL NOT NULL DEFAULT 0,
      average_cost REAL NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT
    );
  `);

  const insProduct = legacy.prepare(`
    INSERT INTO products (id, reference, designation, unit, purchase_price, selling_price, wholesale_price, min_stock, status)
    VALUES (?, ?, ?, 'PIÈCE', ?, ?, ?, 0, 'ACTIVE')
  `);
  insProduct.run('p1', 'REF1', 'Produit 1', 10, 20, 15);
  insProduct.run('p2', 'REF2', 'Produit 2', 4, 9, 7);

  const insMovement = legacy.prepare(`
    INSERT INTO stock_movements (id, product_id, type, movement_type, quantity, unit_price, date)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const d = '2026-01-15T10:00:00.000Z';
  insMovement.run('m1', 'p1', 'IN', 'PURCHASE_IN', 100, 10, d);
  insMovement.run('m2', 'p1', 'OUT', 'SALE_OUT', 30, 10, d);
  insMovement.run('m3', 'p2', 'IN', 'PURCHASE_IN', 50, 4, d);
  insMovement.run('m4', 'p2', 'IN', 'PURCHASE_IN', 10, 6, d);

  legacy.exec(`
    INSERT INTO inventory_balances (product_id, quantity, total_in_qty, total_in_value, average_cost)
    VALUES ('p1', 70, 100, 1000, 10), ('p2', 60, 60, 260, 4.333333333333333)
  `);
  legacy.close();
}

beforeAll(async () => {
  buildLegacyDb();
  process.env.STOCKLOCAL_TEST_DATA_PATH = ROOT;
  vi.resetModules();

  const conn = await import('../src/database/config/connection');
  db = conn.db;

  const sl = await import('../src/services/StockLedgerService');
  StockLedgerService = sl.StockLedgerService;

  const wr = await import('../src/repositories/WarehouseRepository');
  WarehouseRepository = wr.WarehouseRepository;
});

afterAll(() => {
  try { db?.close(); } catch { /* ignore */ }
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { /* Windows lock */ }
});

describe('Migration multi-dépôts sur base legacy', () => {
  it('crée un dépôt par défaut', () => {
    const warehouses = WarehouseRepository.getAll();
    expect(warehouses).toHaveLength(1);
    expect(warehouses[0].is_default).toBe(1);
    expect(warehouses[0].name).toBe('Dépôt principal');
  });

  it('rattache TOUS les mouvements existants au dépôt par défaut (aucune perte)', () => {
    const warehouses = WarehouseRepository.getAll();
    const total = (db.prepare('SELECT COUNT(*) AS c FROM stock_movements').get() as { c: number }).c;
    expect(total).toBe(4);

    const distinct = db.prepare('SELECT DISTINCT warehouse_id FROM stock_movements').all() as Array<{ warehouse_id: string }>;
    expect(distinct).toHaveLength(1);
    expect(distinct[0].warehouse_id).toBe(warehouses[0].id);
  });

  it('conserve des soldes IDENTIQUES après migration (juste rattachés au dépôt)', () => {
    expect(StockLedgerService.getStockLevel('p1')).toBe(BEFORE.p1);
    expect(StockLedgerService.getStockLevel('p2')).toBe(BEFORE.p2);
    const warehouses = WarehouseRepository.getAll();
    expect(StockLedgerService.getStockLevel('p1', warehouses[0].id)).toBe(BEFORE.p1);
    expect(StockLedgerService.getStockLevel('p2', warehouses[0].id)).toBe(BEFORE.p2);
  });

  it('reconstruit inventory_balances avec la clé composite (produit, dépôt)', () => {
    const rows = db.prepare('SELECT product_id, warehouse_id, quantity FROM inventory_balances ORDER BY product_id').all() as Array<{ product_id: string; warehouse_id: string; quantity: number }>;
    expect(rows).toHaveLength(2);
    expect(rows.every(r => typeof r.warehouse_id === 'string' && r.warehouse_id.length > 0)).toBe(true);
    expect(rows.find(r => r.product_id === 'p1')?.quantity).toBe(BEFORE.p1);
    expect(rows.find(r => r.product_id === 'p2')?.quantity).toBe(BEFORE.p2);
  });

  it('passe integrity_check et foreign_key_check après migration', () => {
    expect((db.pragma('foreign_key_check') as unknown[])).toHaveLength(0);
    const integrity = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
    expect(integrity[0].integrity_check).toBe('ok');
  });
});
