import { ipcMain, dialog, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { IpcContext } from './ipcContext';
import { validatePathWithinDataDir, validatePathWithinSubDir, toHumanError, FILE_LIMITS } from '../ipcValidation';
import { DataStorageService } from '../../src/services/DataStorageService';
import { BackupService } from '../../src/services/BackupService';
import { AuditService } from '../../src/services/AuditService';
import { ErrorLogService } from '../../src/services/ErrorLogService';
import { MigrationService } from '../../src/services/MigrationService';
import { checkIntegrity } from '../../src/database/config/connection';
import { checkForUpdatesManually, installUpdate } from '../autoUpdater';

async function run(action: () => unknown): Promise<unknown> {
  try {
    return await action();
  } catch (error: unknown) {
    return { success: false, error: toHumanError(error) };
  }
}

export function registerSystemHandlers(context: IpcContext): void {
  // ─── Data Storage / Onboarding ─────────────────────────────────────────────
  ipcMain.handle('storage:getConfig', async () => DataStorageService.getConfig());
  ipcMain.handle('storage:isFirstRun', async () => DataStorageService.isFirstRun());
  ipcMain.handle('storage:getRecommendedPath', async () => DataStorageService.getRecommendedPath());
  ipcMain.handle('storage:validatePath', async (_, dataPath: unknown) => {
    return DataStorageService.validatePath(typeof dataPath === 'string' ? dataPath : '');
  });

  ipcMain.handle('storage:setDataPath', async (_, dataPath: unknown) => {
    if (typeof dataPath !== 'string') return { success: false, error: 'Chemin invalide.' };
    try {
      DataStorageService.setDataPath(dataPath);
      return { success: true };
    } catch (error: unknown) {
      return { success: false, error: toHumanError(error) };
    }
  });

  ipcMain.handle('storage:completeFirstRun', async () => {
    DataStorageService.completeFirstRun();
    return { success: true };
  });

  ipcMain.handle('storage:checkHealth', async () => DataStorageService.checkDiskHealth());
  ipcMain.handle('storage:getDataPath', async () => DataStorageService.getConfig().dataPath);
  ipcMain.handle('storage:getBackupsPath', async () => DataStorageService.getBackupsPath());

  ipcMain.handle('storage:openFolder', async (_, folderPath: unknown) => {
    return run(() => {
      // §10 : n'ouvrir que des dossiers situés dans le dossier de données.
      const safePath = validatePathWithinDataDir(
        typeof folderPath === 'string' ? folderPath : '',
        DataStorageService.getConfig().dataPath,
        'chemin dossier'
      );
      return shell.openPath(safePath);
    });
  });

  ipcMain.handle('storage:pickFolder', async () => {
    const win = context.getMainWindow();
    if (!win) return { canceled: true };
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choisir l\'emplacement des données',
      buttonLabel: 'Utiliser ce dossier',
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }
    return { canceled: false, path: result.filePaths[0] };
  });

  ipcMain.handle('storage:migrateData', async (_, { fromPath, toPath }: { fromPath: unknown; toPath: unknown }) => {
    if (typeof fromPath !== 'string' || typeof toPath !== 'string') {
      return { success: false, error: 'Chemins invalides.' };
    }
    return DataStorageService.migrateData(fromPath, toPath);
  });

  // ─── Database Integrity ────────────────────────────────────────────────────
  ipcMain.handle('db:integrityCheck', async () => checkIntegrity());

  // ─── Sélection de fichiers (dialogue natif) ────────────────────────────────
  ipcMain.handle('products:pickCsv', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    return { canceled: false, path: result.filePaths[0] };
  });

  // §2.2/§11 : l'image choisie est copiée dans le dossier attachments/ avec
  // une limite de 5 Mo (anti DoS mémoire via base64 IPC). Le renderer ne
  // fournit aucun chemin : l'origine vient exclusivement du dialogue natif.
  ipcMain.handle('products:pickImage', async () => {
    const win = context.getMainWindow();
    if (!win) return { success: false, canceled: true };
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return { success: false, canceled: true };
    const srcPath = result.filePaths[0];
    try {
      const stats = fs.statSync(srcPath);
      if (stats.size > FILE_LIMITS.IMAGE_MAX_BYTES) {
        return { success: false, error: 'Image trop volumineuse : maximum 5 Mo autorisés.' };
      }
      const ext = path.extname(srcPath).toLowerCase();
      const destDir = DataStorageService.getAttachmentsPath();
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      const filename = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext;
      const destPath = path.join(destDir, filename);
      fs.copyFileSync(srcPath, destPath);
      return { success: true, path: destPath };
    } catch (error: unknown) {
      return { success: false, error: toHumanError(error) };
    }
  });

  // ─── Backup ────────────────────────────────────────────────────────────────
  // §10 : tous les chemins de backup venant du renderer sont confinés au
  // dossier dataDir/backups/ — plus aucune écriture/suppression/lecture
  // arbitraire sur le filesystem via les handlers backup:*.
  ipcMain.handle('backup:now', async (_, destinationDir?: unknown) => {
    return run(() => {
      const dataPath = DataStorageService.getConfig().dataPath;
      if (destinationDir !== undefined && destinationDir !== null) {
        if (typeof destinationDir !== 'string') throw new Error('Chemin de sauvegarde invalide.');
        const safeDir = validatePathWithinSubDir(destinationDir, dataPath, DataStorageService.BACKUPS_DIR, 'dossier de sauvegarde');
        return BackupService.backup(safeDir);
      }
      return BackupService.backup(DataStorageService.getBackupsPath());
    }).then((result: unknown) => {
      // Le backup interne renvoie le chemin (string) ; uniformiser la réponse.
      if (typeof result === 'string') {
        AuditService.log('BACKUP_CREATE', 'system', 'backup', `Backup créé : ${result}`);
        return { success: true, path: result };
      }
      return result;
    });
  });

  ipcMain.handle('backup:list', async () => BackupService.listBackups());

  ipcMain.handle('backup:restore', async (_, backupPath: unknown) => {
    return run(() => {
      if (typeof backupPath !== 'string') throw new Error('Chemin invalide.');
      const safePath = validatePathWithinSubDir(backupPath, DataStorageService.getConfig().dataPath, DataStorageService.BACKUPS_DIR, 'chemin backup');
      const result = BackupService.restoreBackup(safePath);
      if (typeof result === 'object' && result && (result as { success?: boolean }).success) {
        AuditService.log('BACKUP_RESTORE', 'system', 'backup', `Restauration depuis : ${safePath}`);
      }
      return result;
    });
  });

  ipcMain.handle('backup:delete', async (_, backupPath: unknown) => {
    return run(() => {
      if (typeof backupPath !== 'string') throw new Error('Chemin invalide.');
      const safePath = validatePathWithinSubDir(backupPath, DataStorageService.getConfig().dataPath, DataStorageService.BACKUPS_DIR, 'chemin backup');
      return BackupService.deleteBackup(safePath);
    });
  });

  ipcMain.handle('backup:validate', async (_, backupPath: unknown) => {
    if (typeof backupPath !== 'string') return { valid: false, error: 'Chemin invalide.' };
    try {
      const safePath = validatePathWithinSubDir(backupPath, DataStorageService.getConfig().dataPath, DataStorageService.BACKUPS_DIR, 'chemin backup');
      return await BackupService.validateBackup(safePath);
    } catch (error: unknown) {
      return { valid: false, error: toHumanError(error) };
    }
  });

  // ─── Migration (§35) ──────────────────────────────────────────────────────
  ipcMain.handle('migration:scanOldDatabases', async () => MigrationService.scanForOldDatabases());
  ipcMain.handle('migration:autoMigrate', async () => MigrationService.autoMigrate());

  ipcMain.handle('migration:migrateFrom', async (_, sourcePath: unknown) => {
    if (typeof sourcePath !== 'string') return { migrated: false, message: 'Chemin source invalide.' };
    try {
      return await MigrationService.migrateFromOldDatabase(sourcePath);
    } catch (error: unknown) {
      return { migrated: false, message: toHumanError(error) };
    }
  });

  // ─── Journal d'erreurs local (§2.5) ───────────────────────────────────────
  ipcMain.handle('logs:exportErrorLog', async () => {
    return run(() => {
      const logPath = ErrorLogService.getLogFilePath();
      if (!logPath) {
        throw new Error('Aucune erreur journalisée pour le moment.');
      }
      const exportsDir = DataStorageService.getExportsPath();
      if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });
      const destName = `journal-erreurs-${new Date().toISOString().split('T')[0]}.log`;
      const destPath = path.join(exportsDir, destName);
      fs.copyFileSync(logPath, destPath);
      shell.openPath(destPath);
      return { success: true, filePath: destPath };
    });
  });

  // ─── Mises à jour (§2.3) ───────────────────────────────────────────────────
  ipcMain.handle('app:checkForUpdates', async () => checkForUpdatesManually());

  ipcMain.handle('app:installUpdate', async () => {
    installUpdate();
    return { success: true };
  });
}
