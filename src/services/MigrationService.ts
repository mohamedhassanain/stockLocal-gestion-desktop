import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { DataStorageService } from './DataStorageService';

/**
 * Migration service (§35): auto-detects old database locations,
 * backs them up, and migrates to the current data path.
 */

const DB_FILENAME = 'stocklocal.db';

/** Common locations where old databases might be found */
function getSearchPaths(): string[] {
  const paths: string[][] = [
    // Current user data
    [app.getPath('userData'), 'data'],
    [app.getPath('userData')],
    // App root / working directory
    [process.cwd(), 'data'],
    [process.cwd()],
    // User home common locations
    [app.getPath('home'), 'StockLocal'],
    [app.getPath('home'), 'stocklocal'],
    [app.getPath('home'), '.stocklocal'],
    // Desktop
    [app.getPath('desktop'), 'StockLocal'],
  ];
  
  const result: string[] = [];
  for (const parts of paths) {
    const resolved = path.join(...parts);
    if (!result.includes(resolved)) {
      result.push(resolved);
    }
  }
  return result;
}

function isSQLiteDatabase(filePath: string): boolean {
  try {
    const buffer = Buffer.alloc(16);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, 16, 0);
    fs.closeSync(fd);
    return buffer.toString('ascii', 0, 16).startsWith('SQLite format 3');
  } catch {
    return false;
  }
}

function validateDbIntegrity(dbPath: string): { valid: boolean; error?: string } {
  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true });
    const result = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
    if (result[0]?.integrity_check === 'ok') {
      return { valid: true };
    }
    return { valid: false, error: `Intégrité compromise : ${result[0]?.integrity_check}` };
  } catch (e: any) {
    return { valid: false, error: e.message };
  } finally {
    if (db) try { db.close(); } catch { /* ignore */ }
  }
}

export interface MigrationResult {
  migrated: boolean;
  sourcePath?: string;
  message: string;
  backupPath?: string;
}

export const MigrationService = {
  /**
   * Scan common locations for old StockLocal databases.
   * Returns all found database paths with their validation status.
   */
  scanForOldDatabases(): Array<{ path: string; valid: boolean; size: number }> {
    const results: Array<{ path: string; valid: boolean; size: number }> = [];
    const currentDbPath = DataStorageService.getDatabasePath();
    
    for (const searchDir of getSearchPaths()) {
      const dbPath = path.join(searchDir, DB_FILENAME);
      
      // Skip if this is the current database location
      if (path.resolve(dbPath) === path.resolve(currentDbPath)) continue;
      
      if (fs.existsSync(dbPath)) {
        try {
          const stats = fs.statSync(dbPath);
          const isValid = isSQLiteDatabase(dbPath) && stats.size > 0;
          results.push({
            path: dbPath,
            valid: isValid,
            size: stats.size,
          });
        } catch {
          results.push({
            path: dbPath,
            valid: false,
            size: 0,
          });
        }
      }
    }
    
    return results;
  },

  /**
   * Migrate data from an old database to the current location.
   * 1. Validate the source database
   * 2. Create a backup of the source
   * 3. Copy the database to the current location
   * 4. Validate the destination
   */
  async migrateFromOldDatabase(sourcePath: string): Promise<MigrationResult> {
    const currentDbPath = DataStorageService.getDatabasePath();
    const currentDataDir = path.dirname(currentDbPath);
    
    // 1. Validate source
    if (!fs.existsSync(sourcePath)) {
      return { migrated: false, message: 'Le fichier source est introuvable.' };
    }
    
    if (!isSQLiteDatabase(sourcePath)) {
      return { migrated: false, message: 'Le fichier source n\'est pas une base SQLite valide.' };
    }
    
    const integrity = validateDbIntegrity(sourcePath);
    if (!integrity.valid) {
      return { migrated: false, message: `La base source est corrompue : ${integrity.error}` };
    }
    
    // 2. Ensure current data directory exists
    DataStorageService.createDirectories(currentDataDir);
    
    // 3. Create a backup of current DB if it exists
    let backupPath: string | undefined;
    if (fs.existsSync(currentDbPath)) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      backupPath = path.join(DataStorageService.getBackupsPath(), `pre-migration-${timestamp}.db`);
      try {
        fs.copyFileSync(currentDbPath, backupPath);
      } catch {
        // Non-fatal: backup is optional
      }
    }
    
    // 4. Copy old database to current location
    try {
      fs.copyFileSync(sourcePath, currentDbPath);
    } catch (e: any) {
      return { migrated: false, message: `Erreur lors de la copie : ${e.message}`, backupPath };
    }
    
    // Copy WAL/SHM if they exist
    for (const ext of ['-wal', '-shm']) {
      const src = sourcePath + ext;
      if (fs.existsSync(src)) {
        try { fs.copyFileSync(src, currentDbPath + ext); } catch { /* ignore */ }
      }
    }
    
    // 5. Validate destination
    const destIntegrity = validateDbIntegrity(currentDbPath);
    if (!destIntegrity.valid) {
      return { migrated: false, message: `La copie est corrompue : ${destIntegrity.error}`, backupPath };
    }
    
    return {
      migrated: true,
      sourcePath,
      backupPath,
      message: `Migration réussie depuis ${sourcePath}. L'ancienne base a été préservée.`,
    };
  },

  /**
   * Auto-detect and migrate if an old database is found.
   * Returns the first valid old database found and migrates it.
   */
  async autoMigrate(): Promise<MigrationResult> {
    const currentDbPath = DataStorageService.getDatabasePath();
    
    // If current database already has data, skip migration
    if (fs.existsSync(currentDbPath)) {
      try {
        const db = new Database(currentDbPath, { readonly: true });
        const result = db.prepare('SELECT COUNT(*) as cnt FROM products').get() as { cnt: number } | undefined;
        db.close();
        if (result && result.cnt > 0) {
          return { migrated: false, message: 'La base actuelle contient déjà des données. Migration non nécessaire.' };
        }
      } catch {
        // DB might be empty or broken, continue with migration scan
      }
    }
    
    const oldDbs = this.scanForOldDatabases();
    if (oldDbs.length === 0) {
      return { migrated: false, message: 'Aucune ancienne base de données trouvée.' };
    }
    
    // Migrate the first valid database found
    const validDb = oldDbs.find(db => db.valid);
    if (!validDb) {
      return { migrated: false, message: `${oldDbs.length} ancienne(s) base(s) trouvée(s) mais aucune n'est valide.` };
    }
    
    return this.migrateFromOldDatabase(validDb.path);
  },
};
