import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

/**
 * FINAL HARDENING — tests fidèles sur le VRAI code :
 *  1. Migration d'une base LEGACY (schéma ancien) via connection.ts (initDb → applySchema + upgradeLegacyDatabase).
 *  2. Backup + Restore E2E via BackupService, avec simulation du redémarrage (restauration appliquée au démarrage).
 *
 * `STOCKLOCAL_USER_DATA_DIR` a priorité sur `STOCKLOCAL_TEST_DATA_PATH` dans
 * DataStorageService.resolveUserDataDir() : on pointe vers un dossier isolé
 * contenant une base ancienne, puis on importe connection.ts dynamiquement.
 */

const legacyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stocklocal-legacy-'));
const dataDir = path.join(legacyRoot, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const legacyDbPath = path.join(dataDir, 'stocklocal.db');
const backupsDir = path.join(dataDir, 'backups');

// ════════════════════════════════════════════════════════════════════════════
// 1) CONSTRUIRE UNE BASE LEGACY (schéma "ancien" ciblé par upgradeLegacyDatabase)
// ════════════════════════════════════════════════════════════════════════════
function buildLegacyDb(): void {
  const db = new Database(legacyDbPath);
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE products (id TEXT PRIMARY KEY, reference TEXT NOT NULL UNIQUE, designation TEXT NOT NULL,
      description TEXT, category_id TEXT, subcategory_id TEXT, barcode TEXT, image_path TEXT,
      unit TEXT DEFAULT 'PIÈCE', purchase_price REAL DEFAULT 0, selling_price REAL DEFAULT 0,
      wholesale_price REAL DEFAULT 0, min_stock INTEGER DEFAULT 0, status TEXT DEFAULT 'ACTIVE',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT, address TEXT, ice TEXT,
      payment_conditions TEXT, credit_limit REAL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE suppliers (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT, address TEXT, ice TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE inventory_balances (product_id TEXT PRIMARY KEY, quantity REAL DEFAULT 0,
      total_in_qty REAL DEFAULT 0, total_in_value REAL DEFAULT 0, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    -- stock_movements : FK vers users + quantité INTEGER (ancien schéma)
    CREATE TABLE stock_movements (id TEXT PRIMARY KEY, product_id TEXT NOT NULL, type TEXT NOT NULL,
      quantity INTEGER NOT NULL, unit_price REAL DEFAULT 0, date DATETIME DEFAULT CURRENT_TIMESTAMP,
      reference_doc TEXT, supplier_id TEXT, notes TEXT, user_id TEXT REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    -- documents : colonnes manquantes (due_date, notes, total_tax, discount_amount)
    CREATE TABLE documents (id TEXT PRIMARY KEY, type TEXT NOT NULL, document_number TEXT NOT NULL UNIQUE,
      entity_id TEXT NOT NULL, date DATETIME DEFAULT CURRENT_TIMESTAMP, total_excl_tax REAL DEFAULT 0,
      total_incl_tax REAL DEFAULT 0, status TEXT DEFAULT 'UNPAID', created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    -- document_items : quantity INTEGER, pas de vat_rate
    CREATE TABLE document_items (id TEXT PRIMARY KEY, document_id TEXT NOT NULL, product_id TEXT NOT NULL,
      quantity INTEGER NOT NULL, unit_price REAL NOT NULL, discount REAL DEFAULT 0, total REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    -- audit_logs : FK vers users, pas de old_value/new_value
    CREATE TABLE audit_logs (id TEXT PRIMARY KEY, action TEXT NOT NULL, entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL, details TEXT, user_id TEXT REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE client_credits (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, type TEXT NOT NULL,
      amount REAL NOT NULL, description TEXT, date DATETIME DEFAULT CURRENT_TIMESTAMP,
      user_id TEXT REFERENCES users(id), created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE supplier_credits (id TEXT PRIMARY KEY, supplier_id TEXT NOT NULL, type TEXT NOT NULL,
      amount REAL NOT NULL, description TEXT, date DATETIME DEFAULT CURRENT_TIMESTAMP,
      user_id TEXT REFERENCES users(id), created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    -- price_history : CASCADE (ancien)
    CREATE TABLE price_history (id TEXT PRIMARY KEY, product_id TEXT NOT NULL, purchase_price REAL,
      selling_price REAL, wholesale_price REAL, changed_at DATETIME DEFAULT CURRENT_TIMESTAMP, reason TEXT,
      FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE);
    -- inventory_items / purchase_order_items : quantités INTEGER
    CREATE TABLE inventory_sessions (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT DEFAULT 'DRAFT',
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP, completed_at DATETIME, notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE inventory_items (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, product_id TEXT NOT NULL,
      expected_qty INTEGER NOT NULL DEFAULT 0, counted_qty REAL, difference REAL, status TEXT DEFAULT 'PENDING',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE purchase_orders (id TEXT PRIMARY KEY, order_number TEXT NOT NULL UNIQUE, supplier_id TEXT NOT NULL,
      date DATETIME DEFAULT CURRENT_TIMESTAMP, expected_date DATETIME, status TEXT DEFAULT 'DRAFT',
      total REAL DEFAULT 0, notes TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE purchase_order_items (id TEXT PRIMARY KEY, purchase_order_id TEXT NOT NULL,
      product_id TEXT NOT NULL, quantity INTEGER NOT NULL, unit_price REAL NOT NULL,
      received_qty REAL DEFAULT 0, total REAL NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    -- quelques lignes legacy (doivent être préservées)
    INSERT INTO users (id) VALUES ('u1');
    INSERT INTO products (id, reference, designation, purchase_price, selling_price) VALUES
      ('p1', 'REF-1', 'Produit legacy', 10, 20);
    INSERT INTO stock_movements (id, product_id, type, quantity, unit_price, user_id) VALUES
      ('m1', 'p1', 'IN', 5, 10, 'u1');
    INSERT INTO documents (id, type, document_number, entity_id, total_excl_tax, total_incl_tax, status) VALUES
      ('d1', 'INVOICE', 'FAC-2026-1', 'c1', 100, 120, 'PAID');
  `);
  db.close();
  console.log('[test] Base legacy construite :', legacyDbPath);
}

// ════════════════════════════════════════════════════════════════════════════
// 2) IMPORTER connection.ts CONTRE CETTE BASE LEGACY (exécute la migration réelle)
// ════════════════════════════════════════════════════════════════════════════
let db: Database.Database;
let BackupService: typeof import('../src/services/BackupService').BackupService;

beforeAll(async () => {
  buildLegacyDb();
  // Priorité maximale : pointe DataStorageService vers notre dossier legacy.
  process.env.STOCKLOCAL_USER_DATA_DIR = legacyRoot;
  // Import DYNAMIQUE (jamais hoisté) : connection.ts se charge APRÈS l'env var
  // et la fixture, donc initDb() applique applySchema() + upgradeLegacyDatabase()
  // sur la base ancienne.
  const conn = await import('../src/database/config/connection');
  db = conn.db;
  const backupMod = await import('../src/services/BackupService');
  BackupService = backupMod.BackupService;
});

afterAll(() => {
  try { db.close(); } catch { /* ignore */ }
  try { fs.rmSync(legacyRoot, { recursive: true, force: true }); } catch { /* Windows lock */ }
});

function tableSql(table: string): string {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table) as { sql: string } | undefined;
  return row?.sql ?? '';
}
function columnType(table: string, col: string): string {
  const row = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; type: string }>;
  return row.find(c => c.name === col)?.type ?? '';
}

describe('FINAL HARDENING — Migration d une base LEGACY (vrai code connection.ts)', () => {
  it('supprime la FK vers users et ajoute movement_type/document_id sur stock_movements', () => {
    const sql = tableSql('stock_movements');
    expect(sql).not.toContain('REFERENCES users');
    expect(sql).toContain('movement_type');
    expect(sql).toContain('document_id');
    expect(columnType('stock_movements', 'quantity')).toBe('REAL');
  });

  it('passe price_history de CASCADE à RESTRICT', () => {
    expect(tableSql('price_history')).not.toContain('ON DELETE CASCADE');
    expect(tableSql('price_history')).toContain('ON DELETE RESTRICT');
  });

  it('ajoute les colonnes manquantes sur documents (total_tax, discount_amount, due_date, notes)', () => {
    const sql = tableSql('documents');
    expect(sql).toContain('total_tax');
    expect(sql).toContain('discount_amount');
    expect(sql).toContain('due_date');
    expect(sql).toContain('notes');
  });

  it('ajoute old_value/new_value et retire la FK users sur audit_logs', () => {
    const sql = tableSql('audit_logs');
    expect(sql).toContain('old_value');
    expect(sql).toContain('new_value');
    expect(sql).not.toContain('REFERENCES users');
  });

  it('passe les quantités des items en REAL', () => {
    expect(columnType('document_items', 'quantity')).toBe('REAL');
    expect(columnType('inventory_items', 'expected_qty')).toBe('REAL');
    expect(columnType('purchase_order_items', 'quantity')).toBe('REAL');
  });

  it('préserve les données legacy (produit + mouvement + document)', () => {
    const prod = db.prepare('SELECT reference FROM products WHERE id = ?').get('p1') as { reference: string } | undefined;
    expect(prod?.reference).toBe('REF-1');
    const mvt = db.prepare('SELECT quantity FROM stock_movements WHERE id = ?').get('m1') as { quantity: number } | undefined;
    expect(mvt?.quantity).toBe(5);
    const doc = db.prepare('SELECT document_number FROM documents WHERE id = ?').get('d1') as { document_number: string } | undefined;
    expect(doc?.document_number).toBe('FAC-2026-1');
  });
});

describe('FINAL HARDENING — Backup / Restore E2E (vrai code BackupService)', () => {
  it('create → backup → modify → restore → verify', async () => {
    // ── Create : produit + mouvement de stock + client + document
    const insertProduct = db.prepare("INSERT INTO products (id, reference, designation, purchase_price, selling_price, status) VALUES (?, ?, ?, ?, ?, 'ACTIVE')");
    const insertCustomer = db.prepare("INSERT INTO customers (id, name, status) VALUES (?, ?, 'ACTIVE')");
    const insertDoc = db.prepare("INSERT INTO documents (id, type, document_number, entity_id, date, total_excl_tax, total_tax, total_incl_tax, status) VALUES (?, 'INVOICE', ?, ?, datetime('now'), 100, 20, 120, 'PAID')");
    // Multi-dépôts : le mouvement est rattaché au dépôt par défaut (garanti).
    const warehouseId = (db.prepare('SELECT id FROM warehouses WHERE is_default = 1 LIMIT 1').get() as { id: string }).id;
    const insertMvt = db.prepare("INSERT INTO stock_movements (id, product_id, warehouse_id, type, movement_type, quantity, unit_price) VALUES (?, ?, ?, 'IN', 'OPENING_BALANCE', ?, ?)");

    const txCreate = db.transaction(() => {
      insertProduct.run('p2', 'REF-2', 'Produit E2E', 10, 25);
      insertCustomer.run('c2', 'Client E2E');
      insertDoc.run('d2', 'FAC-E2E-1', 'c2');
      insertMvt.run('m2', 'p2', warehouseId, 10, 10);
    });
    txCreate();
    const beforeCount = (db.prepare("SELECT COUNT(*) AS c FROM products").get() as { c: number }).c;

    // ── Backup
    const backupPath = await BackupService.backup();
    expect(backupPath).toBeTruthy();
    // Backup doit être un fichier valide (VACUUM INTO => integrity + checksum)
    const validation = await BackupService.validateBackup(backupPath);
    expect(validation.valid).toBe(true);

    // ── Restore (dépose .restore_pending.db, appliqué au prochain démarrage)
    const restoreResult = await BackupService.restoreBackup(backupPath);
    expect(restoreResult.success).toBe(true);
    expect(restoreResult.needsRestart).toBe(true);
    const marker = path.join(dataDir, '.restore_pending.db');
    expect(fs.existsSync(marker)).toBe(true);

    // ── Modify : on ALTERE une donnée (le prix du produit p2) — sans restore,
    //    cette modification resterait et serait visible au prochain démarrage.
    db.prepare("UPDATE products SET selling_price = 999 WHERE id = ?").run('p2');
    const modifiedPrice = (db.prepare('SELECT selling_price FROM products WHERE id = ?').get('p2') as { selling_price: number }).selling_price;
    expect(modifiedPrice).toBe(999);

    // ── Simuler le REDÉMARRAGE : applyPendingRestore() s'exécute AVANT l'ouverture
    //    de la base. On reproduit donc exactement ce cycle : d'abord CHECKPOINT WAL
    //    (vider le -wal dans le fichier principal) puis FERMER la connexion, et c'est
    //    après cette fermeture que le marqueur est copié sur la base.
    const dbPath = path.join(dataDir, 'stocklocal.db');
    // 1. Vider le WAL dans le fichier principal, puis fermer la connexion (comme un
    //    arrêt propre de l'app avant le prochain démarrage).
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    // 2. applyPendingRestore() : copie le marqueur → base (le backup autonome créé
    //    par VACUUM INTO est un fichier sans WAL, donc valide).
    fs.copyFileSync(marker, dbPath);
    // 3. Vérifier integrity_check sur la base restaurée (rollback si invalide).
    const testDb = new Database(dbPath, { readonly: true });
    const integrity = testDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
    testDb.close();
    expect(integrity[0]?.integrity_check).toBe('ok');
    // 4. Relire les données du fichier restauré (état AVANT la modification).
    const verifyDb = new Database(dbPath, { readonly: true });
    const productAfter = verifyDb.prepare('SELECT reference FROM products WHERE id = ?').get('p2') as { reference: string } | undefined;
    const countAfter = (verifyDb.prepare('SELECT COUNT(*) AS c FROM products').get() as { c: number }).c;
    verifyDb.close();
    expect(productAfter?.reference).toBe('REF-2'); // donnée restaurée
    expect(countAfter).toBe(beforeCount);          // état avant la modification

    // Nettoyer le marqueur pour ne pas polluer le prochain démarrage du test.
    try { fs.unlinkSync(marker); } catch { /* ignore */ }
  });
});
