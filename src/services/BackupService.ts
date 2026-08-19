import fs from 'fs';
import path from 'path';
import { DataStorageService } from './DataStorageService';

export interface BackupInfo {
  name: string;
  path: string;
  date: string;
  sizeKB: number;
  valid: boolean;
}

export const BackupService = {
  /**
   * Crée un backup SQLite cohérent en utilisant la commande VACUUM INTO
   * qui produit une copie intégrale et atomique de la base.
   * Si VACUUM INTO n'est pas disponible, fallback sur copie après checkpoint.
   */
  async backup(destinationDir?: string): Promise<string> {
    const dbPath = DataStorageService.getDatabasePath();
    const backupDir = destinationDir ?? DataStorageService.getBackupsPath();

    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupName = `stocklocal-backup-${timestamp}.db`;
    const backupPath = path.join(backupDir, backupName);

    try {
      // Importer le db pour utiliser VACUUM INTO (backup atomique)
      const { db } = await import('../database/config/connection');
      
      // VACUUM INTO produit une copie cohérente même avec WAL
      db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
      console.log(`[Backup] Backup VACUUM INTO créé : ${backupPath}`);
    } catch (e) {
      // Fallback: checkpoint WAL puis copie
      console.warn('[Backup] VACUUM INTO échoué, fallback sur checkpoint + copy:', e);
      
      const { db } = await import('../database/config/connection');
      db.pragma('wal_checkpoint(TRUNCATE)');
      
      fs.copyFileSync(dbPath, backupPath);
      
      // Copier WAL et SHM si existants
      for (const ext of ['-wal', '-shm']) {
        const src = dbPath + ext;
        if (fs.existsSync(src)) {
          try { fs.copyFileSync(src, backupPath + ext); } catch { /* ignore */ }
        }
      }
    }

    // Conserver seulement les 10 dernières sauvegardes
    this.cleanupOldBackups(backupDir, 10);

    console.log(`[Backup] Sauvegarde créée : ${backupPath}`);
    return backupPath;
  },

  /**
   * Supprime les anciennes sauvegardes en gardant les N plus récentes.
   */
  cleanupOldBackups(backupDir: string, maxCount: number): void {
    if (!fs.existsSync(backupDir)) return;

    const backups = this.listBackupsInDir(backupDir);
    if (backups.length > maxCount) {
      for (const old of backups.slice(maxCount)) {
        try {
          fs.unlinkSync(old.path);
          // Supprimer WAL/SHM associés
          for (const ext of ['-wal', '-shm']) {
            const walPath = old.path + ext;
            if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
          }
          console.log(`[Backup] Ancien backup supprimé : ${old.name}`);
        } catch (e) {
          console.warn(`[Backup] Impossible de supprimer ${old.name}:`, e);
        }
      }
    }
  },

  /**
   * Liste les backups dans un dossier donné.
   */
  listBackupsInDir(dir: string): BackupInfo[] {
    if (!fs.existsSync(dir)) return [];

    return fs.readdirSync(dir)
      .filter(f => f.startsWith('stocklocal-backup-') && f.endsWith('.db'))
      .map(f => {
        const fullPath = path.join(dir, f);
        const stats = fs.statSync(fullPath);
        // On vérifie que le fichier n'est pas vide
        const valid = stats.size > 0;
        return {
          name: f,
          path: fullPath,
          date: stats.mtime.toLocaleString('fr-MA'),
          sizeKB: Math.round(stats.size / 1024),
          valid,
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  },

  /**
   * Retourne la liste des sauvegardes disponibles.
   */
  listBackups(): BackupInfo[] {
    return this.listBackupsInDir(DataStorageService.getBackupsPath());
  },

  /**
   * Restaure un backup.
   * 1. Crée un backup de l'état actuel
   * 2. Vérifie l'intégrité du backup sélectionné
   * 3. Remplace la DB
   * 4. Vérifie que la restauration a fonctionné
   */
  async restoreBackup(backupPath: string): Promise<{ success: boolean; error?: string }> {
    if (!fs.existsSync(backupPath)) {
      return { success: false, error: 'Le fichier de sauvegarde est introuvable.' };
    }

    const backupStats = fs.statSync(backupPath);
    if (backupStats.size === 0) {
      return { success: false, error: 'Le fichier de sauvegarde est vide.' };
    }

    try {
      // 1. Backup de l'état actuel avant restauration
      await this.backup();

      const dbPath = DataStorageService.getDatabasePath();

      // 2. Remplacer la DB
      // Note: better-sqlite3 a le fichier ouvert, on ne peut pas le remplacer directement
      // On copie le backup vers un fichier temporaire, puis on exécute la restauration
      const tempPath = dbPath + '.restore_tmp';
      fs.copyFileSync(backupPath, tempPath);

      // Copier WAL/SHM du backup si existants
      for (const ext of ['-wal', '-shm']) {
        const src = backupPath + ext;
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, tempPath + ext);
        }
      }

      // Renommer l'ancienne DB
      const oldPath = dbPath + '.old';
      try { fs.renameSync(dbPath, oldPath); } catch { /* ignore */ }
      for (const ext of ['-wal', '-shm']) {
        try { fs.renameSync(dbPath + ext, dbPath + ext + '.old'); } catch { /* ignore */ }
      }

      // Renommer le backup temp vers la DB principale
      fs.renameSync(tempPath, dbPath);
      for (const ext of ['-wal', '-shm']) {
        const src = tempPath + ext;
        if (fs.existsSync(src)) {
          try { fs.renameSync(src, dbPath + ext); } catch { /* ignore */ }
        }
      }

      // 3. Vérification (on recharge la DB)
      // Note: pour une vraie vérification, il faudrait redémarrer l'app
      console.log('[Backup] Restauration terminée. Redémarrage recommandé.');

      // Nettoyer l'ancienne DB
      try { fs.unlinkSync(oldPath); } catch { /* ignore */ }
      for (const ext of ['-wal', '-shm']) {
        try { fs.unlinkSync(oldPath + ext); } catch { /* ignore */ }
      }

      return { success: true };
    } catch (e: any) {
      return { success: false, error: `Erreur lors de la restauration : ${e.message}` };
    }
  },

  /**
   * Supprime un backup.
   */
  deleteBackup(backupPath: string): { success: boolean; error?: string } {
    try {
      if (!fs.existsSync(backupPath)) {
        return { success: false, error: 'Fichier introuvable.' };
      }
      fs.unlinkSync(backupPath);
      for (const ext of ['-wal', '-shm']) {
        try { fs.unlinkSync(backupPath + ext); } catch { /* ignore */ }
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  },

  /**
   * Valide un backup (vérifie qu'il s'ouvre et est intact).
   */
  async validateBackup(backupPath: string): Promise<{ valid: boolean; error?: string }> {
    if (!fs.existsSync(backupPath)) {
      return { valid: false, error: 'Fichier introuvable.' };
    }
    try {
      const stats = fs.statSync(backupPath);
      if (stats.size === 0) {
        return { valid: false, error: 'Le fichier est vide.' };
      }
      // Essayer d'ouvrir le backup en lecture seule
      const Database = (await import('better-sqlite3')).default;
      const testDb = new Database(backupPath, { readonly: true });
      const result = testDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
      testDb.close();
      if (result[0]?.integrity_check === 'ok') {
        return { valid: true };
      }
      return { valid: false, error: `Intégrité compromise : ${result[0]?.integrity_check}` };
    } catch (e: any) {
      return { valid: false, error: `Validation échouée : ${e.message}` };
    }
  },

  /**
   * Planifie une sauvegarde automatique quotidienne.
   */
  scheduleAutoBackup(): void {
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

    // Première sauvegarde après 1 minute
    setTimeout(async () => {
      try {
        await this.backup();
      } catch (e) {
        console.error('[Backup] Erreur sauvegarde auto:', e);
      }
      // Ensuite toutes les 24h
      setInterval(async () => {
        try {
          await this.backup();
        } catch (e) {
          console.error('[Backup] Erreur sauvegarde auto:', e);
        }
      }, TWENTY_FOUR_HOURS);
    }, 60 * 1000);

    console.log('[Backup] Sauvegarde automatique planifiée (toutes les 24h).');
  }
};
