import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * ─── AUDIT BASE DE DONNÉES — §1 (schéma déclaré vs réel) & §7 (PRAGMA) ────────
 *
 * §1 : `database.sql` est la source de vérité pour une base NEUVE. On vérifie
 *      que le pipeline RÉEL de `connection.ts` (`applySchema` +
 *      `upgradeLegacyDatabase`) n'ajoute/ne modifie AUCUNE colonne sur une base
 *      déjà au schéma courant — c'est-à-dire qu'aucune colonne issue d'une
 *      fonctionnalité récente n'est absente de `database.sql`.
 *
 * §7 : les PRAGMA de connexion (WAL, synchronous, foreign_keys, busy_timeout…)
 *      sont vérifiés tels qu'appliqués réellement par `connection.ts`.
 *
 * Ce fichier n'importe PAS `connection` de façon statique : il monte d'abord une
 * base NEUVE à partir de `database.sql`, puis importe dynamiquement le module
 * réel pour laisser le pipeline s'exécuter dessus.
 */

const SCHEMA_PATH = path.join(process.cwd(), 'src', 'database', 'schema', 'database.sql');
const SCHEMA_SQL = fs.readFileSync(SCHEMA_PATH, 'utf-8');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'stocklocal-dbaudit-schema-'));
const DATA_DIR = path.join(ROOT, 'data');

interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

function tableNames(d: Database.Database): string[] {
  return (d.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as Array<{ name: string }>).map(r => r.name);
}

function indexNames(d: Database.Database): string[] {
  return (d.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as Array<{ name: string }>).map(r => r.name);
}

function columnsOf(d: Database.Database, table: string): ColumnInfo[] {
  return d.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
}

interface SchemaSnapshot {
  tables: string[];
  indexes: string[];
  columns: Map<string, ColumnInfo[]>;
}

function snapshot(d: Database.Database): SchemaSnapshot {
  const tables = tableNames(d);
  const columns = new Map<string, ColumnInfo[]>();
  for (const t of tables) columns.set(t, columnsOf(d, t));
  return { tables, indexes: indexNames(d), columns };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
let db: any;
/* eslint-enable @typescript-eslint/no-explicit-any */
let before: SchemaSnapshot;
let after: SchemaSnapshot;

beforeAll(async () => {
  // 1. Base NEUVE strictement issue de `database.sql` (aucune migration encore).
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const freshPath = path.join(DATA_DIR, 'stocklocal.db');
  const fresh = new Database(freshPath);
  fresh.pragma('foreign_keys = ON');
  fresh.exec(SCHEMA_SQL);
  before = snapshot(fresh);
  fresh.close();

  // 2. Pipeline RÉEL de l'application sur cette même base (applySchema +
  //    upgradeLegacyDatabase) via l'import dynamique de connection.ts.
  process.env.STOCKLOCAL_TEST_DATA_PATH = ROOT;
  vi.resetModules();
  const conn = await import('../src/database/config/connection');
  db = conn.db;
  after = snapshot(db);
});

afterAll(() => {
  try { db?.close(); } catch { /* ignore */ }
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch { /* Verrou Windows */ }
});

describe('§1 — Schéma déclaré (database.sql) vs schéma réel après migration', () => {
  it('le pipeline n\'ajoute AUCUNE colonne à une base déjà au schéma courant (idempotence structurelle)', () => {
    for (const t of before.tables) {
      const beforeCols = before.columns.get(t) ?? [];
      const afterCols = after.columns.get(t) ?? [];
      if (beforeCols.length !== afterCols.length) {
        throw new Error(`Table ${t} : ${beforeCols.length} colonnes déclarées vs ${afterCols.length} après migration.`);
      }
      const sig = (cols: ColumnInfo[]) => cols.map(c => `${c.cid}:${c.name}:${c.type}:${c.notnull}:${c.dflt_value}:${c.pk}`).join('|');
      expect(sig(afterCols), `Structure de ${t} modifiée par la migration`).toBe(sig(beforeCols));
    }
    expect(after.tables).toEqual(before.tables);
  });

  it('aucune table déclarée n\'est absente de la base migrée (et inversement)', () => {
    const missing = before.tables.filter(t => !after.tables.includes(t));
    const extra = after.tables.filter(t => !before.tables.includes(t));
    expect(missing).toEqual([]);
    expect(extra).toEqual([]);
  });

  it('toute colonne ajoutée à chaud par upgradeLegacyDatabase est AUSSI déclarée dans database.sql', () => {
    // Liste EXACTE des colonnes ajoutées par `addColumnIfMissing(...)` dans
    // connection.ts. Toute colonne ajoutée à chaud mais absente de la base
    // déclarée signalerait une base NEUVE structurellement incomplète.
    const hotAdded: Array<[string, string]> = [
      ['documents', 'due_date'],
      ['documents', 'notes'],
      ['documents', 'total_tax'],
      ['documents', 'discount_amount'],
      ['customers', 'category'],
      ['customers', 'status'],
      ['suppliers', 'status'],
      ['products', 'unit'],
      ['products', 'vat_rate'],
      ['products', 'max_stock'],
      ['products', 'batch_managed'],
      ['products', 'location'],
      ['products', 'brand'],
      ['products', 'supplier_id'],
      ['audit_logs', 'old_value'],
      ['audit_logs', 'new_value'],
      ['stock_movements', 'movement_type'],
      ['stock_movements', 'document_id'],
      ['inventory_balances', 'average_cost'],
      ['document_items', 'vat_rate'],
      ['inventory_sessions', 'warehouse_id'],
      ['documents', 'dgi_status'],
      ['documents', 'dgi_reference'],
      ['documents', 'dgi_submitted_at'],
    ];

    const missing: string[] = [];
    for (const [table, column] of hotAdded) {
      const cols = before.columns.get(table) ?? [];
      if (!cols.some(c => c.name === column)) missing.push(`${table}.${column}`);
    }
    expect(missing, `Colonnes ajoutées à chaud mais ABSENTES de database.sql : ${missing.join(', ')}`).toEqual([]);
  });

  it('les colonnes multi-dépôts / caisse / DGI sont bien présentes sur une base NEUVE', () => {
    const mustHave: Array<[string, string]> = [
      ['stock_movements', 'warehouse_id'],
      ['inventory_balances', 'warehouse_id'],
      ['inventory_sessions', 'warehouse_id'],
      ['documents', 'dgi_status'],
      ['documents', 'dgi_reference'],
      ['documents', 'dgi_submitted_at'],
      ['cash_sessions', 'warehouse_id'],
      ['expenses', 'warehouse_id'],
      ['expenses', 'cash_session_id'],
    ];
    for (const [table, column] of mustHave) {
      const cols = before.columns.get(table) ?? [];
      expect(cols.some(c => c.name === column), `${table}.${column} absent d'une base neuve`).toBe(true);
    }
  });
});

describe('§7 — PRAGMA de connexion appliqués par connection.ts', () => {
  it('journal_mode = wal', () => {
    const rows = db.pragma('journal_mode') as Array<{ journal_mode: string }>;
    expect(String(rows[0]?.journal_mode).toLowerCase()).toBe('wal');
  });

  it('foreign_keys = ON', () => {
    expect(Number((db.pragma('foreign_keys') as Array<{ foreign_keys: number }>)[0]?.foreign_keys)).toBe(1);
  });

  it('synchronous = NORMAL (1)', () => {
    expect(Number((db.pragma('synchronous') as Array<{ synchronous: number }>)[0]?.synchronous)).toBe(1);
  });

  it('busy_timeout = 5000 ms', () => {
    const rows = db.pragma('busy_timeout') as Array<{ timeout: number }>;
    expect(Number(rows[0]?.timeout)).toBe(5000);
  });

  it('temp_store = MEMORY (2) et cache_size = -64000', () => {
    expect(Number((db.pragma('temp_store') as Array<{ temp_store: number }>)[0]?.temp_store)).toBe(2);
    expect(Number((db.pragma('cache_size') as Array<{ cache_size: number }>)[0]?.cache_size)).toBe(-64000);
  });
});
