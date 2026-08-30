import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { DataStorageService } from './DataStorageService';
import { GlobalSettingsService } from './GlobalSettingsService';

let autoBackupTimer: NodeJS.Timeout | null = null;

export interface BackupInfo {
  name: string;
  path: string;
  date: string;
  sizeKB: number;
  valid: boolean;
  mtimeMs: number; // valeur numérique pour un tri fiable (jamais la chaîne formatée)
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

    // Millisecondes incluses : deux sauvegardes dans la même seconde génèrent
    // des noms uniques (VACUUM INTO refuse d'écraser un fichier existant).
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
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

    // Checksum SHA-256 : empreinte de référence pour la validation (P1)
    this.writeChecksum(backupPath);

    // P0-2 : marquer comme SUCCÈS seulement si intégrité + checksum OK (métadonnées écrites).
    await this.markBackupSuccessful(backupPath);

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
          mtimeMs: stats.mtimeMs,
        };
      })
      // P1 : tri par mtimeMs (nombre), jamais par la chaîne formatée `date`.
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  },

  /**
   * Retourne la liste des sauvegardes disponibles.
   */
  listBackups(): BackupInfo[] {
    return this.listBackupsInDir(DataStorageService.getBackupsPath());
  },

  /**
   * Restaure un backup (sûr sur Windows).
   *
   * Sur Windows, un fichier SQLite ouvert ne peut pas être remplacé.
   * La restauration est donc déposée comme marqueur `.restore_pending.db`,
   * puis appliquée au prochain démarrage par connection.ts (applyPendingRestore) :
   *   backup de sécurité → copie → integrity_check → rollback si invalide.
   *
   * Avant de déposer le marqueur, le backup est validé (intégrité SQLite).
   */
  async restoreBackup(backupPath: string): Promise<{ success: boolean; error?: string; needsRestart?: boolean }> {
    if (!fs.existsSync(backupPath)) {
      return { success: false, error: 'Le fichier de sauvegarde est introuvable.' };
    }

    const backupStats = fs.statSync(backupPath);
    if (backupStats.size === 0) {
      return { success: false, error: 'Le fichier de sauvegarde est vide.' };
    }

    // 1. Valider l'intégrité du backup AVANT tout
    const validation = await this.validateBackup(backupPath);
    if (!validation.valid) {
      return { success: false, error: validation.error ?? 'Sauvegarde invalide.' };
    }

    // 2. Backup de sécurité de l'état actuel
    await this.backup();

    try {
      // 3. Sur Windows, la base est ouverte et ne peut pas être remplacée :
      //    on dépose le backup comme marqueur, appliqué au prochain démarrage.
      const dataPath = DataStorageService.getConfig().dataPath;
      const markerPath = path.join(dataPath, '.restore_pending.db');
      fs.copyFileSync(backupPath, markerPath);

      console.log('[Backup] Restauration planifiée. Elle sera appliquée au prochain démarrage.');
      return { success: true, needsRestart: true };
    } catch (e: any) {
      return { success: false, error: `Erreur lors de la préparation de la restauration : ${e.message}` };
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
      // 1. Intégrité SQLite
      const Database = (await import('better-sqlite3')).default;
      const testDb = new Database(backupPath, { readonly: true });
      const result = testDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
      testDb.close();
      if (result[0]?.integrity_check !== 'ok') {
        return { valid: false, error: `Intégrité compromise : ${result[0]?.integrity_check}` };
      }
      // 2. Checksum SHA-256 (si un fichier .sha256 a été écrit à la création)
      const checksumPath = backupPath + '.sha256';
      if (fs.existsSync(checksumPath)) {
        const expected = fs.readFileSync(checksumPath, 'utf8').trim();
        const actual = this.computeChecksum(backupPath);
        if (actual !== expected) {
          return { valid: false, error: 'Checksum invalide : le fichier a été altéré.' };
        }
      }
      return { valid: true };
    } catch (e: any) {
      return { valid: false, error: `Validation échouée : ${e.message}` };
    }
  },

  /**
   * Planifie une sauvegarde automatique quotidienne.
   */
  scheduleAutoBackup(): void {
    // Annule toute planification précédente (re-planification après réglages)
    if (autoBackupTimer) {
      clearInterval(autoBackupTimer);
      autoBackupTimer = null;
    }

    const settings = GlobalSettingsService.getAll();

    // Si la sauvegarde automatique est désactivée : AUCUNE planification
    // (les sauvegardes ne doivent JAMAIS se créer sans l'accord de l'utilisateur).
    if (!settings.auto_backup_enabled) {
      console.log('[Backup] Sauvegarde automatique désactivée — aucune planification.');
      return;
    }

    const DAY = 24 * 60 * 60 * 1000;
    const intervals: Record<string, number> = {
      daily: DAY,
      weekly: 7 * DAY,
      monthly: 30 * DAY,
    };

    const interval = intervals[settings.auto_backup_frequency];

    if (interval) {
      // Fréquence périodique (jour / semaine / mois) — pas de backup immédiat.
      autoBackupTimer = setInterval(async () => {
        try {
          // On revérifie à chaque tick : si l'utilisateur a désactivé l'option, on saute.
          const current = GlobalSettingsService.getAll();
          if (!current.auto_backup_enabled) return;
          await this.backup();
        } catch (e) {
          console.error('[Backup] Erreur sauvegarde auto:', e);
        }
      }, interval);
      console.log(`[Backup] Sauvegarde automatique planifiée (${settings.auto_backup_frequency}).`);
    } else {
      // 'on_close' : la sauvegarde est déclenchée à la fermeture de l'app (main.ts).
      console.log('[Backup] Sauvegarde automatique à la fermeture activée.');
    }
  },

  /** P1 — Checksum SHA-256 d'un fichier (empreinte de référence). */
  computeChecksum(filePath: string): string {
    const data = fs.readFileSync(filePath);
    return createHash('sha256').update(data).digest('hex');
  },

  /** P1 — Écrit le checksum à côté du backup (fichier .sha256). */
  writeChecksum(backupPath: string): void {
    try {
      const checksum = this.computeChecksum(backupPath);
      fs.writeFileSync(backupPath + '.sha256', checksum + '\n', 'utf8');
    } catch (e) {
      console.warn('[Backup] Impossible d\'écrire le checksum:', e);
    }
  },

  /**
   * P0-2 — Marque un backup comme RÉUSSI seulement après validation
   * (integritiy_check + checksum), puis écrit les métadonnées :
   *   <backup>.meta.json  +  last-successful-backup.json (pour le check au démarrage).
   */
  async markBackupSuccessful(backupPath: string): Promise<void> {
    const validation = await this.validateBackup(backupPath);
    if (!validation.valid) {
      console.warn('[Backup] Backup non marqué comme réussi :', validation.error);
      return;
    }
    const stats = fs.statSync(backupPath);
    const meta = {
      path: backupPath,
      created_at: new Date().toISOString(),
      sizeKB: Math.round(stats.size / 1024),
      checksum: this.computeChecksum(backupPath),
    };
    try {
      fs.writeFileSync(backupPath + '.meta.json', JSON.stringify(meta, null, 2), 'utf8');
      const lastPath = path.join(DataStorageService.getBackupsPath(), 'last-successful-backup.json');
      fs.writeFileSync(lastPath, JSON.stringify({ path: backupPath, created_at: meta.created_at, sizeKB: meta.sizeKB }, null, 2), 'utf8');
      console.log('[Backup] Sauvegarde marquée comme réussie (intégrité + checksum OK).');
    } catch (e) {
      console.warn('[Backup] Impossible d\'écrire les métadonnées :', e);
    }
  },

  /**
   * P1 — Vérifie au démarrage si un backup automatique est dû.
   * "Application startup → check last successful backup → if backup expired → create backup."
   * Ne bloque pas le démarrage (fire-and-forget). Respecte l'option auto_backup_enabled.
   */
  checkAndBackupIfDue(): void {
    const settings = GlobalSettingsService.getAll();
    if (!settings.auto_backup_enabled) return;

    const DAY = 24 * 60 * 60 * 1000;
    const intervals: Record<string, number> = {
      daily: DAY,
      weekly: 7 * DAY,
      monthly: 30 * DAY,
    };
    const interval = intervals[settings.auto_backup_frequency];
    if (!interval) return; // on_close : géré à la fermeture

    // P0-2 : lire le DERNIER backup RÉUSSI depuis les métadonnées (pas le simple mtime fichier).
    let lastMtime = 0;
    try {
      const lastPath = path.join(DataStorageService.getBackupsPath(), 'last-successful-backup.json');
      if (fs.existsSync(lastPath)) {
        const meta = JSON.parse(fs.readFileSync(lastPath, 'utf8')) as { created_at: string };
        const t = new Date(meta.created_at).getTime();
        if (Number.isFinite(t)) lastMtime = t;
      }
    } catch { /* métadonnées absentes → backup immédiat */ }

    if (lastMtime === 0 || Date.now() - lastMtime >= interval) {
      this.backup().catch(e => console.error('[Backup] Backup démarrage (expiré/absent) échoué:', e));
    }
  }
};
