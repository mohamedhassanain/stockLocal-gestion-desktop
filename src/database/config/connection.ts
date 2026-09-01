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

// ═══════════════════════════════════════════════════════════════════════════
// DÉCISION CHIFFREMENT DE LA BASE (§1.5) — documentée, volontairement NON
// appliquée pour préserver la stabilité du build à grande échelle.
//
// OPTION ÉVALUÉE : SQLCipher via `better-sqlite3-multiple-ciphers` (fork du
// binding natif). RAISON DU REFUS :
//   1. Le projet repose sur `better-sqlite3` compilé par `postinstall`
//      (`electron-builder install-app-deps`) pour l'ABI Electron 31. Passer au
//      fork remplace le module natif par un autre binding dont les prebuilds
//      ne couvrent pas l'ABI d'Electron → recompilation locale exigée (chaîne
//      d'outils VS Build Tools absente de la plupart des machines non-dev).
//   2. Le chiffrement implique une clé : stockée localement, elle protège la
//      base contre l'ouverture "curieuse" (DB Browser), pas contre un acteur
//      ayant accès au dossier de données (clé + base sur la même machine).
//      L'effort de migration (toutes les bases existantes, restore, tests
//      sous ELECTRON_RUN_AS_NODE) est dépensé pour un gain de sécurité faible
//      dans le modèle mono-utilisateur 100 % local assumé par le produit.
//   3. Chaque correctif de sécurité/ABI du fork devient une dépendance
//      supplémentaire de l'éditeur, au prix d'un risque de build cassé sur
//      les milliers d'installations distribuées.
//
// ALTERNATIVE RETENUE (limites) : les données restent non chiffrées au repos,
// comme pour tout logiciel desktop mono-utilisateur (QuickBooks Desktop, Sage
// 50, Ciel...). La protection repose sur : dossier de données utilisateur
// (hors Program Files, permissions OS), sandbox du renderer, confinement des
// chemins IPC, et backups locaux. Cela reste un choix produit assumé ; si
// l'activation de SQLCipher devient nécessaire, la migration est décrite dans
// le README (section Sécurité) et les backups héritent automatiquement du
// chiffrement car ce sont des copies VACUUM INTO de la base (cf. §1.6).
// ═══════════════════════════════════════════════════════════════════════════

// Pragmas SQLite pour la performance, l'intégrité et la robustesse
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('temp_store = MEMORY');
db.pragma('cache_size = -64000');
db.pragma('foreign_keys = ON');
// §2.1 : en cas de lock bref (dossier synchronisé OneDrive/Dropbox, antivirus…),
// better-sqlite3 attend jusqu'à 5 s au lieu d'échouer immédiatement. Les
// erreurs SQLITE_BUSY résiduelles sont traduites par toHumanError côté IPC.
db.pragma('busy_timeout = 5000');

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

/**
 * SOURCE DE VÉRITÉ UNIQUE du schéma.
 *
 * `database.sql` est le seul fichier définissant la structure complète d'une
 * base NEUVE : tables, index, contraintes, defaults, checks. Il utilise
 * `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`, donc il est
 * aussi sûr sur une base existante (les tables déjà présentes sont ignorées,
 * les tables/index manquants sont créés).
 */
function applySchema(): void {
  const schemaPath = resolveSchemaPath();
  if (!schemaPath) {
    console.warn('[DB] Fichier de schéma introuvable.');
    return;
  }
  db.exec(fs.readFileSync(schemaPath, 'utf-8'));
  console.log('[DB] Schéma appliqué (database.sql).');
}

/** Ajoute une colonne si elle n'existe pas encore (upgrade de bases anciennes). */
function addColumnIfMissing(table: string, column: string, definition: string): void {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some(c => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      console.log(`[DB] Colonne ajoutée (upgrade) : ${table}.${column}`);
    }
  } catch {
    // Table n'existe peut-être pas encore
  }
}

/** Retourne le SQL de création d'une table, ou undefined. */
function getTableSql(table: string): string | undefined {
  const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(table) as { sql?: string } | undefined;
  return row?.sql;
}

/**
 * Reconstruit une table pour corriger sa définition (changement de FK ou de
 * type de colonne) en préservant TOUTES les données. Utilisé uniquement pour
 * les bases anciennes — jamais pour une base neuve.
 */
function rebuildTable(target: string, newSql: string, copyColumns: string[]): void {
  // `newSql` DOIT déjà créer la table temporaire `<target>_upgrade` (les appels
  // passent un template nommé avec le suffixe `_upgrade`). On ne fait PAS de
  // `replace(target, temp)` ici — cela double-appendrait le suffixe.
  const temp = `${target}_upgrade`;
  try {
    db.transaction(() => {
      db.exec(`DROP TABLE IF EXISTS ${temp};`);
      db.exec(newSql);
      db.exec(`INSERT INTO ${temp} (${copyColumns.join(', ')}) SELECT ${copyColumns.join(', ')} FROM ${target};`);
      db.exec(`DROP TABLE ${target};`);
      db.exec(`ALTER TABLE ${temp} RENAME TO ${target};`);
    })();
    console.log(`[DB] Table ${target} reconstruite (upgrade).`);
  } catch (e) {
    console.warn(`[DB] Upgrade de ${target} ignoré :`, e);
    try { db.exec(`DROP TABLE IF EXISTS ${temp};`); } catch { /* ignore */ }
  }
}

/**
 * UPGRADE MINIMAL, CENTRALISÉ des bases EXISTANTES.
 *
 * `database.sql` crée le schéma complet pour une base NEUVE. Cette fonction ne
 * définit PAS le schéma : elle n'applique que des correctifs ADDITIFS aux bases
 * anciennes (colonnes manquantes, anciennes FK vers `users`, quantités INTEGER,
 * price_history encore CASCADE, séquences de numérotation). Idempotente.
 */
function upgradeLegacyDatabase(): void {
  // ── Colonnes ajoutées au fil du temps (additives, sans perte) ──────────────
  addColumnIfMissing('documents', 'due_date', 'DATETIME');
  addColumnIfMissing('documents', 'notes', 'TEXT');
  addColumnIfMissing('documents', 'total_tax', 'REAL NOT NULL DEFAULT 0.0');
  addColumnIfMissing('documents', 'discount_amount', 'REAL NOT NULL DEFAULT 0.0');
  addColumnIfMissing('customers', 'category', "TEXT NOT NULL DEFAULT 'DÉTAIL'");
  addColumnIfMissing('customers', 'status', "TEXT NOT NULL DEFAULT 'ACTIVE'");
  addColumnIfMissing('suppliers', 'status', "TEXT NOT NULL DEFAULT 'ACTIVE'");
  addColumnIfMissing('products', 'unit', "TEXT NOT NULL DEFAULT 'PIÈCE'");
  addColumnIfMissing('products', 'vat_rate', 'REAL DEFAULT 20.0');
  addColumnIfMissing('products', 'max_stock', 'INTEGER DEFAULT 0');
  addColumnIfMissing('products', 'location', 'TEXT');
  addColumnIfMissing('products', 'brand', 'TEXT');
  addColumnIfMissing('products', 'supplier_id', 'TEXT');
  addColumnIfMissing('audit_logs', 'old_value', 'TEXT');
  addColumnIfMissing('audit_logs', 'new_value', 'TEXT');
  addColumnIfMissing('stock_movements', 'movement_type', "TEXT NOT NULL DEFAULT 'ADJUSTMENT_IN'");
  addColumnIfMissing('stock_movements', 'document_id', 'TEXT');
  addColumnIfMissing('inventory_balances', 'average_cost', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('document_items', 'vat_rate', 'REAL NOT NULL DEFAULT 0.0');

  // ── Anciennes bases avec FK vers `users` (audit_logs, stock_movements,
  //    client_credits, supplier_credits) → reconstruire sans cette FK ─────────
  const rebuildIfHasUsersFk = (table: string, newSqlTemplate: string, cols: string[]) => {
    const sql = getTableSql(table);
    if (sql && sql.includes('REFERENCES users')) {
      rebuildTable(table, newSqlTemplate, cols);
    }
  };

  rebuildIfHasUsersFk(
    'audit_logs',
    `CREATE TABLE audit_logs_upgrade (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      details TEXT,
      old_value TEXT,
      new_value TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`,
    ['id', 'action', 'entity_type', 'entity_id', 'details', 'old_value', 'new_value', 'created_at']
  );

  rebuildIfHasUsersFk(
    'stock_movements',
    `CREATE TABLE stock_movements_upgrade (
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
    );`,
    ['id', 'product_id', 'type', 'movement_type', 'quantity', 'unit_price', 'date', 'reference_doc', 'document_id', 'supplier_id', 'notes', 'created_at']
  );

  rebuildIfHasUsersFk(
    'client_credits',
    `CREATE TABLE client_credits_upgrade (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE RESTRICT
    );`,
    ['id', 'customer_id', 'type', 'amount', 'description', 'date', 'created_at']
  );

  rebuildIfHasUsersFk(
    'supplier_credits',
    `CREATE TABLE supplier_credits_upgrade (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE RESTRICT
    );`,
    ['id', 'supplier_id', 'type', 'amount', 'description', 'date', 'created_at']
  );

  // ── price_history : passer de CASCADE à RESTRICT (donnée comptable) ────────
  const phSql = getTableSql('price_history');
  if (phSql && phSql.includes('ON DELETE CASCADE')) {
    rebuildTable(
      'price_history',
      `CREATE TABLE price_history_upgrade (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        purchase_price REAL,
        selling_price REAL,
        wholesale_price REAL,
        changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        reason TEXT,
        FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT
      );`,
      ['id', 'product_id', 'purchase_price', 'selling_price', 'wholesale_price', 'changed_at', 'reason']
    );
  }

  // ── Quantités INTEGER → REAL (support des quantités décimales) ─────────────
  const rebuildIfQtyInteger = (table: string, qtyCol: string, newSqlTemplate: string, cols: string[]) => {
    try {
      const colInfo = (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; type: string }>)
        .find(c => c.name === qtyCol);
      if (colInfo && colInfo.type === 'INTEGER') {
        rebuildTable(table, newSqlTemplate, cols);
      }
    } catch { /* ignore */ }
  };

  rebuildIfQtyInteger(
    'document_items', 'quantity',
    `CREATE TABLE document_items_upgrade (
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
    );`,
    ['id', 'document_id', 'product_id', 'quantity', 'unit_price', 'discount', 'total', 'vat_rate', 'created_at']
  );

  rebuildIfQtyInteger(
    'purchase_order_items', 'quantity',
    `CREATE TABLE purchase_order_items_upgrade (
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
    );`,
    ['id', 'purchase_order_id', 'product_id', 'quantity', 'unit_price', 'received_qty', 'total', 'created_at']
  );

  rebuildIfQtyInteger(
    'inventory_items', 'expected_qty',
    `CREATE TABLE inventory_items_upgrade (
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
    );`,
    ['id', 'session_id', 'product_id', 'expected_qty', 'counted_qty', 'difference', 'status', 'created_at']
  );

  rebuildIfQtyInteger(
    'stock_movements', 'quantity',
    `CREATE TABLE stock_movements_upgrade (
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
    );`,
    ['id', 'product_id', 'type', 'movement_type', 'quantity', 'unit_price', 'date', 'reference_doc', 'document_id', 'supplier_id', 'notes', 'created_at']
  );

  // Recréer les index qui peuvent avoir disparu après les rebuilds ci-dessus.
  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements (product_id);
      CREATE INDEX IF NOT EXISTS idx_stock_movements_date ON stock_movements (date);
      CREATE INDEX IF NOT EXISTS idx_stock_movements_type ON stock_movements (type);
      CREATE INDEX IF NOT EXISTS idx_stock_movements_movement_type ON stock_movements (movement_type);
      CREATE INDEX IF NOT EXISTS idx_stock_movements_document ON stock_movements (document_id);
      CREATE INDEX IF NOT EXISTS idx_document_items_document ON document_items (document_id);
      CREATE INDEX IF NOT EXISTS idx_document_items_product ON document_items (product_id);
      CREATE INDEX IF NOT EXISTS idx_purchase_order_items_order ON purchase_order_items (purchase_order_id);
      CREATE INDEX IF NOT EXISTS idx_purchase_order_items_product ON purchase_order_items (product_id);
      CREATE INDEX IF NOT EXISTS idx_inventory_items_session ON inventory_items (session_id);
      CREATE INDEX IF NOT EXISTS idx_inventory_items_product ON inventory_items (product_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_date ON audit_logs (created_at);
      CREATE INDEX IF NOT EXISTS idx_price_history_product ON price_history (product_id);
      CREATE INDEX IF NOT EXISTS idx_price_history_date ON price_history (changed_at);
    `);
  } catch { /* ignore */ }

  // Recalculer la TVA existante si des documents ont total_tax = 0.
  try {
    db.exec(`
      UPDATE documents SET total_tax = total_incl_tax - total_excl_tax
      WHERE total_tax = 0 AND total_incl_tax != total_excl_tax
    `);
  } catch { /* ignore */ }

  // Backfill des séquences de numérotation depuis les documents existants.
  try {
    const docs = db.prepare(`
      SELECT type, strftime('%Y', date) AS year, document_number
      FROM documents
    `).all() as Array<{ type: string; year: string; document_number: string }>;

    const orders = db.prepare(`
      SELECT strftime('%Y', date) AS year, order_number
      FROM purchase_orders
    `).all() as Array<{ year: string; order_number: string }>;

    const sources: Array<{ type: string; year: string; number: string }> = [
      ...docs.map(d => ({ type: d.type, year: d.year, number: d.document_number })),
      ...orders.map(o => ({ type: 'PURCHASE_ORDER', year: o.year, number: o.order_number })),
    ];

    if (sources.length > 0) {
      const stmt = db.prepare(`
        INSERT INTO document_sequences (type, year, last_number)
        VALUES (?, ?, ?)
        ON CONFLICT(type, year) DO UPDATE SET
          last_number = MAX(last_number, excluded.last_number)
      `);
      db.transaction(() => {
        for (const src of sources) {
          const match = /-(\d+)$/.exec(src.number);
          if (!match) continue;
          const seq = parseInt(match[1], 10);
          const year = parseInt(src.year, 10);
          if (Number.isFinite(seq) && Number.isFinite(year)) {
            stmt.run(src.type, year, seq);
          }
        }
      })();
      console.log('[DB] Séquences de numérotation initialisées depuis les documents existants.');
    }
  } catch { /* ignore */ }
}

/**
 * §2.2 : copie de sécurité automatique AVANT toute migration modifiant la
 * structure des tables. Ce backup est horodaté dans backups/ et conservé en
 * plus des sauvegardes régulières (rétention : les 5 plus récents).
 */
function createPreMigrationBackup(): string | null {
  try {
    if (!fs.existsSync(dbPath) || fs.statSync(dbPath).size === 0) return null;

    const backupsDir = DataStorageService.getBackupsPath();
    if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

    // Checkpoint WAL pour que la copie du fichier principal soit cohérente.
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch { /* WAL absent (base neuve) ou verrou passé — la copie reste exploitable */ }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupsDir, `pre-migration-${timestamp}.db`);
    fs.copyFileSync(dbPath, backupPath);
    console.log(`[DB] Backup de sécurité avant migration : ${backupPath}`);

    // Rétention : ne garder que les 5 backups pre-migration les plus récents.
    const preMigration = fs.readdirSync(backupsDir)
      .filter(f => f.startsWith('pre-migration-') && f.endsWith('.db'))
      .sort()
      .reverse();
    for (const old of preMigration.slice(5)) {
      try { fs.unlinkSync(path.join(backupsDir, old)); } catch { /* ignore */ }
    }

    return backupPath;
  } catch (e) {
    console.warn('[DB] Backup pré-migration ignoré (non bloquant) :', e);
    return null;
  }
}

function initDb(): void {
  const safetyBackup = createPreMigrationBackup();
  try {
    // Base NEUVE : database.sql est la SOURCE DE VÉRITÉ UNIQUE du schéma.
    applySchema();

    // Base EXISTANTE : correctifs additifs minimaux + centralisés.
    upgradeLegacyDatabase();
  } catch (e: unknown) {
    const detail = safetyBackup
      ? `Erreur lors de la migration de la base de données. Une copie de sécurité a été créée ici : ${safetyBackup}. Vous pouvez joindre ce fichier au support pour diagnostiquer le problème.`
      : `Erreur lors de la migration de la base de données : ${e instanceof Error ? e.message : String(e)}`;
    console.error(`[DB] ${detail}`);
    throw new Error(detail);
  }
}

initDb();

// §14 — Reconstruire les balances de stock depuis l'historique (backfill).
//
// Import dynamique différé : évite la dépendance circulaire
// connection ↔ StockLedgerService (ce service importe `db` d'ici).
// L'import se résout après l'évaluation du graphe de modules, donc toujours
// APRÈS le schéma et les migrations — exactement ce qu'on veut.
// Idempotent : DELETE + re-INSERT agrégé depuis stock_movements.
void import('../../services/StockLedgerService').then(({ StockLedgerService }) => {
  try {
    StockLedgerService.rebuildBalances();
    console.log('[DB] Balances de stock recalculées.');
  } catch (e) {
    // Non bloquant : les écritures futures maintiennent les balances à jour,
    // et un rebuild est relancable manuellement via StockLedgerService.
    console.warn('[DB] Recalcul des balances échoué (non bloquant) :', e);
  }
});

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
  } catch (e: unknown) {
    return { valid: false, message: `Erreur de vérification : ${e instanceof Error ? e.message : String(e)}` };
  }
}
