import fs from 'fs';
import path from 'path';
import { app } from 'electron';

export const BackupService = {
  /**
   * Copie le fichier .db SQLite vers un dossier de destination.
   * SQLite en mode WAL permet de copier à chaud (pas besoin d'arrêter la DB).
   */
  async backup(destinationDir?: string): Promise<string> {
    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'stocklocal.db');

    // Dossier de destination (par défaut : sous-dossier 'backups' dans userData)
    const backupDir = destinationDir ?? path.join(userDataPath, 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupName = `stocklocal-backup-${timestamp}.db`;
    const backupPath = path.join(backupDir, backupName);

    fs.copyFileSync(dbPath, backupPath);

    // Conserver seulement les 10 dernières sauvegardes automatiques (éviter de remplir le disque)
    const backups = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('stocklocal-backup-') && f.endsWith('.db'))
      .sort()
      .reverse();

    if (backups.length > 10) {
      for (const old of backups.slice(10)) {
        fs.unlinkSync(path.join(backupDir, old));
      }
    }

    console.log(`[Backup] Sauvegarde créée : ${backupPath}`);
    return backupPath;
  },

  /**
   * Planifie une sauvegarde automatique quotidienne.
   * Doit être appelé une seule fois au démarrage.
   */
  scheduleAutoBackup(): void {
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

    // Première sauvegarde après 1 minute (pour laisser l'app démarrer)
    setTimeout(async () => {
      await this.backup();
      // Ensuite, toutes les 24h
      setInterval(() => this.backup(), TWENTY_FOUR_HOURS);
    }, 60 * 1000);

    console.log('[Backup] Sauvegarde automatique planifiée (toutes les 24h).');
  },

  /**
   * Retourne la liste des sauvegardes disponibles.
   */
  listBackups(): Array<{ name: string; path: string; date: string; sizeKB: number }> {
    const userDataPath = app.getPath('userData');
    const backupDir = path.join(userDataPath, 'backups');

    if (!fs.existsSync(backupDir)) return [];

    return fs.readdirSync(backupDir)
      .filter(f => f.startsWith('stocklocal-backup-') && f.endsWith('.db'))
      .map(f => {
        const fullPath = path.join(backupDir, f);
        const stats = fs.statSync(fullPath);
        return {
          name: f,
          path: fullPath,
          date: stats.mtime.toLocaleString('fr-MA'),
          sizeKB: Math.round(stats.size / 1024)
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }
};
