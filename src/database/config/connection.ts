import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';

const isProd = process.env.NODE_ENV === 'production';
const userDataPath = app ? app.getPath('userData') : process.cwd();
const dbPath = path.join(userDataPath, 'stocklocal.db');

export const db = new Database(dbPath, {
  verbose: !isProd ? console.log : undefined,
});

// Chiffrement SQLCipher (commenté si sqlite3 standard est utilisé pour l'instant)
// db.pragma(`key = 'VOTRE_CLE_DE_CHIFFREMENT_SECRETE'`);

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
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`[DB] Colonne ajoutée : ${table}.${column}`);
  }
}

function migrateColumns(): void {
  addColumnIfMissing('documents', 'due_date', 'DATETIME');
  addColumnIfMissing('documents', 'notes', 'TEXT');
  addColumnIfMissing('customers', 'category', "TEXT NOT NULL DEFAULT 'DÉTAIL'");
  addColumnIfMissing('products', 'unit', "TEXT NOT NULL DEFAULT 'PIÈCE'");
}

function seedDefaultUser(): void {
  const { count } = db.prepare('SELECT count(*) as count FROM users').get() as { count: number };
  if (count === 0) {
    db.prepare(
      `INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)`
    ).run('user_1', 'admin', 'changeme', 'ADMIN');
    console.log('[DB] Utilisateur par défaut créé (admin / changeme).');
  }
}

function initDb(): void {
  applySchema();
  migrateColumns();
  seedDefaultUser();
}

initDb();

export function runInTransaction<T>(fn: () => T): T {
  const transaction = db.transaction(fn);
  return transaction();
}
