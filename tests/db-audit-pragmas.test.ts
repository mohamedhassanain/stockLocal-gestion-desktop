import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { db } from '../src/database/config/connection';

/**
 * AUDIT BASE DE DONNÉES — §7 : verrouillage & accès concurrent (best-effort).
 *
 * Confirme que les PRAGMA de connexion (WAL, synchronous, foreign_keys,
 * busy_timeout, temp_store, cache_size) n'ont PAS été modifiés par les ajouts
 * récents (multi-dépôts, DGI, sessions de caisse), et que WAL autorise bien une
 * lecture pendant qu'un écrivain tient une transaction (multi-fenêtre).
 */

function one<T>(sql: string): T {
  return (db.pragma(sql) as T[])[0];
}

afterAll(() => {
  // `db` est partagé par les autres suites : ne pas le fermer ici.
});

describe('§7 — PRAGMA de connexion (aucune régression des réglages validés)', () => {
  it('journal_mode = wal', () => {
    expect(String(one<{ journal_mode: string }>('journal_mode').journal_mode).toLowerCase()).toBe('wal');
  });

  it('synchronous = NORMAL (1)', () => {
    expect(Number(one<{ synchronous: number }>('synchronous').synchronous)).toBe(1);
  });

  it('foreign_keys = ON', () => {
    expect(Number(one<{ foreign_keys: number }>('foreign_keys').foreign_keys)).toBe(1);
  });

  it('busy_timeout = 5000 ms (attente en cas de lock bref)', () => {
    expect(Number(one<{ timeout: number }>('busy_timeout').timeout)).toBe(5000);
  });

  it('temp_store = MEMORY (2) et cache_size = -64000', () => {
    expect(Number(one<{ temp_store: number }>('temp_store').temp_store)).toBe(2);
    expect(Number(one<{ cache_size: number }>('cache_size').cache_size)).toBe(-64000);
  });

  it('locking_mode = normal (pas d\'exclusivité globale acquise)', () => {
    expect(String(one<{ locking_mode: string }>('locking_mode').locking_mode).toLowerCase()).toBe('normal');
  });
});

describe('§7 — WAL : lecture concurrente pendant une écriture (multi-fenêtre)', () => {
  it('une seconde connexion peut LIRE pendant qu\'une transaction d\'écriture est ouverte', () => {
    const dbPath = db.name;
    const other = new Database(dbPath);
    try {
      other.pragma('busy_timeout = 5000');
      // Écrivain : transaction exclusive sur `other`.
      other.exec('BEGIN IMMEDIATE;');
      other.exec("INSERT INTO global_settings (key, value) VALUES ('audit_pragma_probe', '1') ON CONFLICT(key) DO UPDATE SET value='1';");

      // En WAL, la connexion `db` (lecteur) n'est PAS bloquée par cette écriture.
      const row = db.prepare("SELECT value FROM global_settings WHERE key = 'audit_pragma_probe'").get() as { value?: string } | undefined;
      // Le lecteur ne voit pas la transaction non committée (isolation) : absent ou valeur précédente.
      expect(row?.value === '1').not.toBe(true);

      other.exec('ROLLBACK;');
    } finally {
      try { other.close(); } catch { /* ignore */ }
    }
  });
});
