import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { DataStorageService } from '../../services/DataStorageService';

// Initialiser le DataStorageService avant tout
DataStorageService.init();

const dbPath = DataStorageService.getDatabasePath();

// Vérifier que le dossier parent existe
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new Database(dbPath, {
  verbose: process.env.NODE_ENV !== 'production' ? console.log : undefined,
});

// Pragmas SQLite pour la performance et l'intégrité
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('temp_store = MEMORY');
db.pragma('cache_size = -64000');
db.pragma('foreign_keys = ON');

function resolveSchemaPath(): string | null {
  const candidates = [
    path.join(process.cwd(), 'src', 'database', 'schema', 'database.sql'),
    path.join(process.cwd(), 'database', 'schema', 'database.sql'),
  ];
  if (process.env.APP_ROOT) {
    candidates.push(path.join(process.env.APP_ROOT, 'src', 'database', 'schema', 'database.sql'));
  }
  return candidates.find(p => fs.existsSync(p)) ?? null;
}

function applySchema(): void {
  const schemaPath = resolveSchemaPath();
  if (!schemaPath) {
    console.warn('[DB] Fichier de schéma introuvable.');
    return;
  }
  db.exec(fs.readFileSync(schemaPath, 'utf-8'));
  console.log('[DB] Schéma appliqué.');
}

function addColumnIfMissing(table: string, column: string, definition: string): void {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some(c => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      console.log(`[DB] Colonne ajoutée : ${table}.${column}`);
    }
  } catch {
    // Table n'existe peut-être pas encore
  }
}

function migrateColumns(): void {
  addColumnIfMissing('documents', 'due_date', 'DATETIME');
  addColumnIfMissing('documents', 'notes', 'TEXT');
  addColumnIfMissing('customers', 'category', "TEXT NOT NULL DEFAULT 'DÉTAIL'");
  addColumnIfMissing('products', 'unit', "TEXT NOT NULL DEFAULT 'PIÈCE'");
}

function migrateAuditLogs(): void {
  // Migration : retirer la dépendance FK vers users dans audit_logs
  // On recrée la table si elle a encore une FK vers users
  try {
    const tableInfo = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='audit_logs'`).get() as { sql: string } | undefined;
    if (tableInfo && tableInfo.sql.includes('REFERENCES users')) {
      console.log('[DB] Migration audit_logs : suppression de la FK users...');
      db.exec(`
        CREATE TABLE IF NOT EXISTS audit_logs_new (
          id TEXT PRIMARY KEY,
          action TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          details TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO audit_logs_new (id, action, entity_type, entity_id, details, created_at)
          SELECT id, action, entity_type, entity_id, details, created_at FROM audit_logs;
        DROP TABLE audit_logs;
        ALTER TABLE audit_logs_new RENAME TO audit_logs;
      `);
      console.log('[DB] audit_logs migré sans FK users.');
    }
  } catch (e) {
    console.warn('[DB] Migration audit_logs ignorée (normal si nouvelle DB):', e);
  }
}

function migrateStockMovements(): void {
  try {
    const tableInfo = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='stock_movements'`).get() as { sql: string } | undefined;
    if (tableInfo && tableInfo.sql.includes('REFERENCES users')) {
      console.log('[DB] Migration stock_movements : suppression de la FK users...');
      db.exec(`
        CREATE TABLE IF NOT EXISTS stock_movements_new (
          id TEXT PRIMARY KEY,
          product_id TEXT NOT NULL,
          type TEXT NOT NULL,
          quantity INTEGER NOT NULL,
          unit_price REAL NOT NULL,
          date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          reference_doc TEXT,
          supplier_id TEXT,
          notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
        );
        INSERT INTO stock_movements_new (id, product_id, type, quantity, unit_price, date, reference_doc, supplier_id, notes, created_at)
          SELECT id, product_id, type, quantity, unit_price, date, reference_doc, supplier_id, notes, created_at FROM stock_movements;
        DROP TABLE stock_movements;
        ALTER TABLE stock_movements_new RENAME TO stock_movements;
      `);
      console.log('[DB] stock_movements migré sans FK users.');
    }
  } catch (e) {
    console.warn('[DB] Migration stock_movements ignorée:', e);
  }
}

function migrateClientCredits(): void {
  try {
    const tableInfo = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='client_credits'`).get() as { sql: string } | undefined;
    if (tableInfo && tableInfo.sql.includes('REFERENCES users')) {
      console.log('[DB] Migration client_credits : suppression de la FK users...');
      db.exec(`
        CREATE TABLE IF NOT EXISTS client_credits_new (
          id TEXT PRIMARY KEY,
          customer_id TEXT NOT NULL,
          type TEXT NOT NULL,
          amount REAL NOT NULL,
          description TEXT,
          date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE
        );
        INSERT INTO client_credits_new (id, customer_id, type, amount, description, date, created_at)
          SELECT id, customer_id, type, amount, description, date, created_at FROM client_credits;
        DROP TABLE client_credits;
        ALTER TABLE client_credits_new RENAME TO client_credits;
      `);
      console.log('[DB] client_credits migré sans FK users.');
    }
  } catch (e) {
    console.warn('[DB] Migration client_credits ignorée:', e);
  }
}

function migrateSupplierCredits(): void {
  try {
    const tableInfo = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='supplier_credits'`).get() as { sql: string } | undefined;
    if (tableInfo && tableInfo.sql.includes('REFERENCES users')) {
      console.log('[DB] Migration supplier_credits : suppression de la FK users...');
      db.exec(`
        CREATE TABLE IF NOT EXISTS supplier_credits_new (
          id TEXT PRIMARY KEY,
          supplier_id TEXT NOT NULL,
          type TEXT NOT NULL,
          amount REAL NOT NULL,
          description TEXT,
          date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE CASCADE
        );
        INSERT INTO supplier_credits_new (id, supplier_id, type, amount, description, date, created_at)
          SELECT id, supplier_id, type, amount, description, date, created_at FROM supplier_credits;
        DROP TABLE supplier_credits;
        ALTER TABLE supplier_credits_new RENAME TO supplier_credits;
      `);
      console.log('[DB] supplier_credits migré sans FK users.');
    }
  } catch (e) {
    console.warn('[DB] Migration supplier_credits ignorée:', e);
  }
}

function migrateAddProductFields(): void {
  addColumnIfMissing('products', 'vat_rate', 'REAL DEFAULT 20.0');
  addColumnIfMissing('products', 'max_stock', 'INTEGER DEFAULT 0');
  addColumnIfMissing('products', 'location', 'TEXT');
  addColumnIfMissing('products', 'brand', 'TEXT');
  addColumnIfMissing('products', 'supplier_id', 'TEXT');
}

function initDb(): void {
  applySchema();
  migrateColumns();
  migrateAuditLogs();
  migrateStockMovements();
  migrateClientCredits();
  migrateSupplierCredits();
  migrateAddProductFields();
}

initDb();

export function runInTransaction<T>(fn: () => T): T {
  const transaction = db.transaction(fn);
  return transaction();
}

/** Vérifie l'intégrité de la base de données */
export function checkIntegrity(): { valid: boolean; message: string } {
  try {
    const result = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
    if (result[0]?.integrity_check === 'ok') {
      return { valid: true, message: 'Base de données intacte.' };
    }
    return { valid: false, message: `Problème d'intégrité : ${result[0]?.integrity_check}` };
  } catch (e: any) {
    return { valid: false, message: `Erreur de vérification : ${e.message}` };
  }
}
