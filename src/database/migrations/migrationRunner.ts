/**
 * Runner de migrations versionnées.
 *
 * Remplaçant les migrations ad-hoc dispersées dans `connection.ts`, ce runner :
 *   - crée la table `schema_migrations` (version, applied_at) si absente ;
 *   - lit les fichiers `migrations/*.sql` triés par préfixe numérique ;
 *   - n'exécute chaque migration qu'une seule fois (idempotent) ;
 *   - exécute chaque migration dans une transaction (rollback propre en cas d'erreur) ;
 *   - journalise la version appliquée dans `schema_migrations`.
 *
 * Les fichiers existants restent intégrés : les migrations ad-hoc de
 * `connection.ts` sont conservées pour la rétro-compatibilité avec les bases
 * déjà migrées, mais les nouvelles migrations passent par ce système.
 */
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';

export interface AppliedMigration {
  version: number;
  applied_at: string;
}

/**
 * Applique les migrations non encore exécutées.
 *
 * @param db Connexion SQLite (déjà initialisée avec le schéma de base).
 * @param migrationsDir Dossier contenant les fichiers `NNN_*.sql`.
 */
export function runMigrations(db: Database.Database, migrationsDir: string): void {
  // 1. S'assurer que la table de suivi existe
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 2. Lire les fichiers de migration triés
  if (!fs.existsSync(migrationsDir)) {
    console.warn('[Migrations] Dossier de migrations introuvable :', migrationsDir);
    return;
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => /^\d+_.*\.sql$/.test(f))
    .map(f => ({ file: f, version: parseInt(f.split('_')[0], 10) }))
    .sort((a, b) => a.version - b.version);

  // 3. Récupérer les versions déjà appliquées
  const appliedRows = db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[];
  const appliedVersions = new Set(appliedRows.map(r => r.version));

  // 4. Appliquer chaque migration non exécutée, dans une transaction
  const insertMigration = db.prepare('INSERT INTO schema_migrations (version) VALUES (?)');

  for (const { file, version } of files) {
    if (appliedVersions.has(version)) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    console.log(`[Migrations] Application de ${file}...`);

    try {
      db.transaction(() => {
        db.exec(sql);
        insertMigration.run(version);
      })();
      console.log(`[Migrations] ${file} appliquée.`);
    } catch (e) {
      console.error(`[Migrations] Échec de ${file} :`, e);
      throw new Error(
        `Échec de la migration ${file}. La transaction a été annulée. ` +
        `Une copie de sécurité pré-migration a peut-être été créée.`
      );
    }
  }
}

/**
 * Retourne les migrations appliquées (les plus récentes en premier).
 */
export function getAppliedMigrations(db: Database.Database): AppliedMigration[] {
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get()) {
    return [];
  }
  return db.prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version DESC').all() as AppliedMigration[];
}
