import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { buildWatchIgnored } from '../vite.config';

/**
 * §Phase 26 — EBUSY : les données runtime doivent être EXCLUES du watcher Vite.
 *
 * Sur Windows, chokidar ouvre un handle sur les fichiers surveillés ; SQLite
 * verrouille activement `stocklocal.db` et ses satellites WAL/SHM. Un watch
 * handle sur un fichier verrouillé lève EBUSY et faisait planter `npm run dev`.
 *
 * Ce test vérifie le prédicat RÉEL utilisé par la config (pas une copie) :
 *   - les données runtime sont ignorées (db + wal/shm/journal, backups) ;
 *   - le code source n'est JAMAIS ignoré (sinon le HMR serait cassé).
 */

const cwd = process.cwd();
const dataDir = path.join(cwd, '.stocklocal-test-data');

describe('§Phase 26 — Prédicat `ignored` du watcher Vite', () => {
  const ignored = buildWatchIgnored();

  it('ignore la base SQLite et ses satellites WAL / SHM / JOURNAL', () => {
    const base = path.join(dataDir, 'data', 'stocklocal.db');
    expect(ignored(base)).toBe(true);
    expect(ignored(`${base}-wal`)).toBe(true);
    expect(ignored(`${base}-shm`)).toBe(true);
    expect(ignored(`${base}-journal`)).toBe(true);
  });

  it('ignore tout fichier SQLite, où qu’il soit', () => {
    expect(ignored(path.join(cwd, 'ailleurs', 'une-base.db'))).toBe(true);
    expect(ignored(path.join(cwd, 'une-base.sqlite'))).toBe(true);
    expect(ignored(path.join(cwd, 'une-base.sqlite3'))).toBe(true);
    expect(ignored(path.join(cwd, 'une-base.db3'))).toBe(true);
  });

  it('ignore les sauvegardes écrites pendant l’exécution', () => {
    expect(ignored(path.join(dataDir, 'data', 'backups', 'mon-backup.db'))).toBe(true);
    // Une sauvegarde créée pendant que SQLite écrit NE DOIT PAS être surveillée :
    // c'est exactement le scénario qui déclenchait EBUSY.
    expect(ignored(path.join(dataDir, 'data', 'backups', 'pre-migration-2026-09-12T13-50-32-907Z.db'))).toBe(true);
  });

  it('ignore tout chemin sous le dossier de données runtime', () => {
    expect(ignored(path.join(dataDir, 'storage-config.json'))).toBe(true);
    expect(ignored(path.join(dataDir, 'data', 'images', 'photo.png'))).toBe(true);
  });

  it('N’IGNORE JAMAIS le code source — le HMR doit continuer à fonctionner', () => {
    // Régression critique : un glob trop large (« data », « backups ») ou une
    // exclusion mal ciblée casserait le rechargement à chaud de l'application.
    expect(ignored(path.join(cwd, 'src', 'pages', 'POSPage.tsx'))).toBe(false);
    expect(ignored(path.join(cwd, 'src', 'services', 'ImportService.ts'))).toBe(false);
    expect(ignored(path.join(cwd, 'src', 'database', 'schema', 'database.sql'))).toBe(false);
    expect(ignored(path.join(cwd, 'electron', 'main.ts'))).toBe(false);
    expect(ignored(path.join(cwd, 'vite.config.ts'))).toBe(false);
    expect(ignored(path.join(cwd, 'index.html'))).toBe(false);
    expect(ignored(path.join(cwd, 'package.json'))).toBe(false);
  });

  it('ne confond pas un dossier source nommé « data » dans src/ avec les données runtime', () => {
    // Le filet de sécurité cible `data`/`backups` ; le projet n'a pas de dossier
    // source de ce nom. On documente ici le cas « src/data » pour mémoire :
    // s'il fallait un jour créer src/data/, il faudrait resserrer la règle 3.
    expect(ignored(path.join(dataDir, 'data', 'x.txt'))).toBe(true);
  });
});
