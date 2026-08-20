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

/**
 * Applique une restauration en attente au démarrage (avant ouverture de la base).
 *
 * Sur Windows, on ne peut pas remplacer un fichier SQLite ouvert. La restauration
 * est donc déposée comme marqueur `.restore_pending.db` par BackupService, puis
 * appliquée ici au prochain démarrage, avec :
 *   1. backup de sécurité de l'état actuel
 *   2. copie du backup → base
 *   3. integrity_check (sinon rollback automatique)
 *   4. suppression du marqueur
 */
function applyPendingRestore(): void {
  try {
    const dataPath = DataStorageService.getConfig().dataPath;
    const markerPath = path.join(dataPath, '.restore_pending.db');
    if (!fs.existsSync(markerPath)) return;

    const backupsDir = DataStorageService.getBackupsPath();
    if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

    // 1. Backup de sécurité de l'état actuel
    const safetyPath = path.join(backupsDir, `pre-restore-${Date.now()}.db`);
    if (fs.existsSync(dbPath)) {
      fs.copyFileSync(dbPath, safetyPath);
    }

    // 2. Copier le backup en attente → base
    fs.copyFileSync(markerPath, dbPath);

    // 3. Vérification d'intégrité sur une connexion en lecture seule
    let ok = false;
    try {
      const testDb = new Database(dbPath, { readonly: true });
      const result = testDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
      ok = result[0]?.integrity_check === 'ok';
      testDb.close();
    } catch {
      ok = false;
    }

    // 4. Rollback si invalide, sinon supprimer le marqueur
    if (ok) {
      fs.unlinkSync(markerPath);
      console.log('[Restore] Restauration appliquée avec succès au démarrage.');
    } else {
      if (fs.existsSync(safetyPath)) {
        fs.copyFileSync(safetyPath, dbPath);
      }
      fs.unlinkSync(markerPath);
      console.warn('[Restore] Intégrité invalide : restauration annulée, backup de sécurité restauré.');
    }
  } catch (e) {
    console.warn('[Restore] Échec de l\'application de la restauration en attente :', e);
  }
}

applyPendingRestore();

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

function migrateStockMovementV2(): void {
  addColumnIfMissing('stock_movements', 'movement_type', "TEXT NOT NULL DEFAULT 'ADJUSTMENT_IN'");
  addColumnIfMissing('stock_movements', 'document_id', 'TEXT');

  // Reclasser les mouvements hérités ET corriger le signe des anciens INVENTORY :
  //  - INVENTORY avec "+N" (surplus) → type IN,  ADJUSTMENT_IN,  quantity = N (positif)
  //  - INVENTORY avec "−N" (manque)  → type OUT, ADJUSTMENT_OUT, quantity = N (positif)
  //  - IN                    → PURCHASE_IN  (entrée fournisseur)
  //  - IN RETOUR_CLIENT      → RETURN_IN
  //  - IN "Stock initial"    → OPENING_BALANCE
  //  - OUT avec notes SORTIE → selon le type encodé (VENTE/CASSE/PERTE/RETOUR)
  //  - OUT vente (notes VENTE —) → SALE_OUT
  db.exec(`
    UPDATE stock_movements
    SET
      type = CASE
        WHEN type = 'INVENTORY' AND notes LIKE '%:+%' THEN 'IN'
        WHEN type = 'INVENTORY' THEN 'OUT'
        ELSE type
      END,
      movement_type = CASE
        WHEN type = 'IN' AND notes LIKE '%RETOUR_CLIENT%' THEN 'RETURN_IN'
        WHEN type = 'IN' AND notes LIKE '%Inventaire : +%' THEN 'ADJUSTMENT_IN'
        WHEN type = 'IN' AND notes LIKE '%INVENTAIRE%' AND notes LIKE '%:+%' THEN 'ADJUSTMENT_IN'
        WHEN type = 'IN' AND notes LIKE '%Stock initial%' THEN 'OPENING_BALANCE'
        WHEN type = 'IN' AND notes LIKE '%Inventaire "%' AND notes LIKE '%:+%' THEN 'ADJUSTMENT_IN'
        WHEN type = 'IN' THEN 'PURCHASE_IN'
        WHEN type = 'OUT' AND notes LIKE '%SORTIE:CASSE%' THEN 'DAMAGE_OUT'
        WHEN type = 'OUT' AND notes LIKE '%SORTIE:PERTE%' THEN 'LOSS_OUT'
        WHEN type = 'OUT' AND notes LIKE '%SORTIE:RETOUR%' THEN 'RETURN_OUT'
        WHEN type = 'OUT' AND notes LIKE '%SORTIE:VENTE%' THEN 'SALE_OUT'
        WHEN type = 'OUT' AND notes LIKE 'VENTE —%' THEN 'SALE_OUT'
        WHEN type = 'OUT' AND notes LIKE '%INVENTAIRE%' THEN 'ADJUSTMENT_OUT'
        WHEN type = 'OUT' THEN 'SALE_OUT'
        WHEN type = 'INVENTORY' AND notes LIKE '%:+%' THEN 'ADJUSTMENT_IN'
        WHEN type = 'INVENTORY' THEN 'ADJUSTMENT_OUT'
        ELSE movement_type
      END
    WHERE movement_type = 'ADJUSTMENT_IN'
  `);

  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_stock_movements_movement_type ON stock_movements (movement_type);
      CREATE INDEX IF NOT EXISTS idx_stock_movements_document ON stock_movements (document_id);
    `);
  } catch (e) {
    console.warn('[DB] Index stock_movements v2 ignorés:', e);
  }
}

function migrateDocumentsV2(): void {
  addColumnIfMissing('documents', 'total_tax', 'REAL NOT NULL DEFAULT 0.0');
  addColumnIfMissing('documents', 'discount_amount', 'REAL NOT NULL DEFAULT 0.0');
  addColumnIfMissing('document_items', 'vat_rate', 'REAL NOT NULL DEFAULT 0.0');

  // Recalculer la TVA sur les documents existants dont total_tax = 0 mais total_incl_tax > total_excl_tax
  try {
    db.exec(`
      UPDATE documents SET total_tax = total_incl_tax - total_excl_tax
      WHERE total_tax = 0 AND total_incl_tax != total_excl_tax
    `);
  } catch (e) {
    console.warn('[DB] Recalcul TVA existante ignoré:', e);
  }
}

function migrateQuantitiesReal(): void {
  // Les colonnes de quantité passent en REAL pour supporter les quantités décimales (0.5, 1.25, ...)
  // SQLite permet le déclenchement sur ALTER TYPE ? Non : ALTER COLUMN n'existe pas.
  // On reconstruit les tables concernées si elles sont encore INTEGER.
  try {
    const cols = db.prepare(`PRAGMA table_info(document_items)`).all() as { name: string; type: string }[];
    const qtyCol = cols.find(c => c.name === 'quantity');
    if (qtyCol && qtyCol.type === 'INTEGER') {
      console.log('[DB] Migration document_items.quantity → REAL...');
      db.exec(`
        CREATE TABLE document_items_new (
          id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL,
          product_id TEXT NOT NULL,
          quantity REAL NOT NULL CHECK (quantity > 0),
          unit_price REAL NOT NULL,
          discount REAL DEFAULT 0.0,
          total REAL NOT NULL,
          vat_rate REAL NOT NULL DEFAULT 0.0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE,
          FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT
        );
        INSERT INTO document_items_new (id, document_id, product_id, quantity, unit_price, discount, total, vat_rate, created_at)
          SELECT id, document_id, product_id, quantity, unit_price, discount, total, vat_rate, created_at FROM document_items;
        DROP TABLE document_items;
        ALTER TABLE document_items_new RENAME TO document_items;
        CREATE INDEX IF NOT EXISTS idx_document_items_document ON document_items (document_id);
        CREATE INDEX IF NOT EXISTS idx_document_items_product ON document_items (product_id);
      `);
      console.log('[DB] document_items.quantity migré vers REAL.');
    }
  } catch (e) {
    console.warn('[DB] Migration document_items.quantity REAL ignorée:', e);
  }

  try {
    const cols = db.prepare(`PRAGMA table_info(purchase_order_items)`).all() as { name: string; type: string }[];
    const qtyCol = cols.find(c => c.name === 'quantity');
    if (qtyCol && qtyCol.type === 'INTEGER') {
      console.log('[DB] Migration purchase_order_items.quantity → REAL...');
      db.exec(`
        CREATE TABLE purchase_order_items_new (
          id TEXT PRIMARY KEY,
          purchase_order_id TEXT NOT NULL,
          product_id TEXT NOT NULL,
          quantity REAL NOT NULL,
          unit_price REAL NOT NULL,
          received_qty REAL NOT NULL DEFAULT 0,
          total REAL NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders (id) ON DELETE CASCADE,
          FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT
        );
        INSERT INTO purchase_order_items_new (id, purchase_order_id, product_id, quantity, unit_price, received_qty, total, created_at)
          SELECT id, purchase_order_id, product_id, quantity, unit_price, received_qty, total, created_at FROM purchase_order_items;
        DROP TABLE purchase_order_items;
        ALTER TABLE purchase_order_items_new RENAME TO purchase_order_items;
        CREATE INDEX IF NOT EXISTS idx_purchase_order_items_order ON purchase_order_items (purchase_order_id);
        CREATE INDEX IF NOT EXISTS idx_purchase_order_items_product ON purchase_order_items (product_id);
      `);
      console.log('[DB] purchase_order_items.quantity migré vers REAL.');
    }
  } catch (e) {
    console.warn('[DB] Migration purchase_order_items.quantity REAL ignorée:', e);
  }

  try {
    const cols = db.prepare(`PRAGMA table_info(inventory_items)`).all() as { name: string; type: string }[];
    const qtyCol = cols.find(c => c.name === 'expected_qty');
    if (qtyCol && qtyCol.type === 'INTEGER') {
      console.log('[DB] Migration inventory_items.quantity → REAL...');
      db.exec(`
        CREATE TABLE inventory_items_new (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          product_id TEXT NOT NULL,
          expected_qty REAL NOT NULL DEFAULT 0,
          counted_qty REAL,
          difference REAL,
          status TEXT NOT NULL DEFAULT 'PENDING',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (session_id) REFERENCES inventory_sessions (id) ON DELETE CASCADE,
          FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT
        );
        INSERT INTO inventory_items_new (id, session_id, product_id, expected_qty, counted_qty, difference, status, created_at)
          SELECT id, session_id, product_id, expected_qty, counted_qty, difference, status, created_at FROM inventory_items;
        DROP TABLE inventory_items;
        ALTER TABLE inventory_items_new RENAME TO inventory_items;
        CREATE INDEX IF NOT EXISTS idx_inventory_items_session ON inventory_items (session_id);
        CREATE INDEX IF NOT EXISTS idx_inventory_items_product ON inventory_items (product_id);
      `);
      console.log('[DB] inventory_items.quantities migré vers REAL.');
    }
  } catch (e) {
    console.warn('[DB] Migration inventory_items.quantity REAL ignorée:', e);
  }

  // stock_movements.quantity → REAL (reconstruire si INTEGER)
  try {
    const cols = db.prepare(`PRAGMA table_info(stock_movements)`).all() as { name: string; type: string }[];
    const qtyCol = cols.find(c => c.name === 'quantity');
    if (qtyCol && qtyCol.type === 'INTEGER') {
      console.log('[DB] Migration stock_movements.quantity → REAL...');
      db.exec(`
        CREATE TABLE stock_movements_new (
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
          FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
        );
        INSERT INTO stock_movements_new (id, product_id, type, movement_type, quantity, unit_price, date, reference_doc, document_id, supplier_id, notes, created_at)
          SELECT id, product_id, type, movement_type, quantity, unit_price, date, reference_doc, document_id, supplier_id, notes, created_at FROM stock_movements;
        DROP TABLE stock_movements;
        ALTER TABLE stock_movements_new RENAME TO stock_movements;
        CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements (product_id);
        CREATE INDEX IF NOT EXISTS idx_stock_movements_date ON stock_movements (date);
        CREATE INDEX IF NOT EXISTS idx_stock_movements_type ON stock_movements (type);
        CREATE INDEX IF NOT EXISTS idx_stock_movements_movement_type ON stock_movements (movement_type);
        CREATE INDEX IF NOT EXISTS idx_stock_movements_document ON stock_movements (document_id);
      `);
      console.log('[DB] stock_movements.quantity migré vers REAL.');
    }
  } catch (e) {
    console.warn('[DB] Migration stock_movements.quantity REAL ignorée:', e);
  }
}

function initDb(): void {
  applySchema();
  migrateColumns();
  migrateAuditLogs();
  migrateStockMovements();
  migrateClientCredits();
  migrateSupplierCredits();
  migrateAddProductFields();
  migrateStockMovementV2();
  migrateDocumentsV2();
  migrateQuantitiesReal();
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
