import { ipcMain, dialog, shell, clipboard } from 'electron';
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
import { safeParse, DataPathSchema, FolderPathSchema, MigrateDataSchema, BackupPathSchema, BackupDestDirSchema, SourcePathSchema } from '../../src/validation/schemas';

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
    try {
      const safePath = safeParse(DataPathSchema, dataPath, 'Chemin de stockage');
      return DataStorageService.validatePath(safePath);
    } catch (error: unknown) {
      return { valid: false, error: toHumanError(error) };
    }
  });

  ipcMain.handle('storage:setDataPath', async (_, dataPath: unknown) => {
    try {
      const safePath = safeParse(DataPathSchema, dataPath, 'Chemin de stockage');
      DataStorageService.setDataPath(safePath);
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
      const safeFolder = safeParse(FolderPathSchema, folderPath, 'Chemin du dossier');
      const safePath = validatePathWithinDataDir(
        safeFolder,
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

  ipcMain.handle('storage:migrateData', async (_, payload: unknown) => {
    try {
      const { fromPath, toPath } = safeParse(MigrateDataSchema, payload, 'Migration de données');
      return DataStorageService.migrateData(fromPath, toPath);
    } catch (error: unknown) {
      return { success: false, error: toHumanError(error) };
    }
  });

  // ─── Database Integrity ────────────────────────────────────────────────────
  ipcMain.handle('db:integrityCheck', async () => checkIntegrity());

  // ─── Réinitialisation complète (Zone de danger) ───────────────────────────
  // Supprime toutes les données métier + toutes les sauvegardes, documents,
  // exports et images. Conserve les paramètres (entreprise, unités, alertes).
  //
  // P1-17 — PROTECTION FORTE. Le backend exige un jeton de confirmation fort
  // (`confirm` === 'WIPE_ALL') fourni par le renderer. Cette garde ne repose
  // PAS sur la seule UI : un appel direct à `data:wipeAll` sans jeton est
  // refusé. De plus, un backup de sécurité est effectué AVANT l'effacement,
  // sauf si l'utilisateur passe explicitement `skipBackup: true`.
  ipcMain.handle('data:wipeAll', async (_, payload: unknown) => {
    return run(async () => {
      // 1. Jeton fort obligatoire (anti-accident / anti-appel direct depuis devtools).
      const p = (payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}) as Record<string, unknown>;
      if (p['confirm'] !== 'WIPE_ALL') {
        throw new Error('Confirmation forte requise : la réinitialisation complète est refusée. Le jeton "WIPE_ALL" est manquant.');
      }
      const skipBackup = p['skipBackup'] === true;

      // 2. Backup de sécurité AVANT l'effacement (sauf refus explicite).
      let backupPath: string | undefined;
      if (!skipBackup) {
        backupPath = await BackupService.backup();
      }

      const { db } = await import('../../src/database/config/connection');

      // Tables de données métier (ordre enfants → parents).
      const tables = [
        'inventory_item_versions',
        'inventory_versions',
        'inventory_items',
        'inventory_sessions',
        'purchase_order_items',
        'purchase_orders',
        'price_history',
        'unit_conversions',
        'product_batches',
        'credit_note_refs',
        'document_items',
        'payments',
        'documents',
        'client_credits',
        'supplier_credits',
        'stock_movements',
        'inventory_balances',
        'volume_discounts',
        'subcategories',
        'categories',
        'products',
        'customers',
        'suppliers',
      ];

      db.pragma('foreign_keys = OFF');
      const wipe = db.transaction(() => {
        for (const t of tables) {
          try { db.prepare(`DELETE FROM ${t}`).run(); } catch { /* table absente */ }
        }
        try { db.prepare('DELETE FROM document_sequences').run(); } catch { /* ignore */ }
        try { db.prepare('DELETE FROM audit_logs').run(); } catch { /* ignore */ }
      });
      wipe();
      db.pragma('foreign_keys = ON');

      // Supprimer et recréer les dossiers de données (backups, documents, exports, images)
      const dirs = [
        DataStorageService.getBackupsPath(),
        DataStorageService.getDocumentsPath(),
        DataStorageService.getExportsPath(),
        DataStorageService.getAttachmentsPath(),
      ];
      for (const dir of dirs) {
        if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir, { recursive: true });
      }

      AuditService.log('DATA_WIPE', 'system', 'all', `Toutes les données ont été supprimées.${backupPath ? ` Backup de sécurité : ${backupPath}` : ''}`);

      return { success: true, backupPath };
    });
  });

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
      const safeDest = safeParse(BackupDestDirSchema, destinationDir, 'Dossier de sauvegarde');
      if (safeDest !== undefined) {
        const safeDir = validatePathWithinSubDir(safeDest, dataPath, DataStorageService.BACKUPS_DIR, 'dossier de sauvegarde');
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
      const safeBackupPath = safeParse(BackupPathSchema, backupPath, 'Chemin du backup');
      const safePath = validatePathWithinSubDir(safeBackupPath, DataStorageService.getConfig().dataPath, DataStorageService.BACKUPS_DIR, 'chemin backup');
      const result = BackupService.restoreBackup(safePath);
      if (typeof result === 'object' && result && (result as { success?: boolean }).success) {
        AuditService.log('BACKUP_RESTORE', 'system', 'backup', `Restauration depuis : ${safePath}`);
      }
      return result;
    });
  });

  ipcMain.handle('backup:delete', async (_, backupPath: unknown) => {
    return run(() => {
      const safeBackupPath = safeParse(BackupPathSchema, backupPath, 'Chemin du backup');
      const safePath = validatePathWithinSubDir(safeBackupPath, DataStorageService.getConfig().dataPath, DataStorageService.BACKUPS_DIR, 'chemin backup');
      return BackupService.deleteBackup(safePath);
    });
  });

  ipcMain.handle('backup:validate', async (_, backupPath: unknown) => {
    try {
      const safeBackupPath = safeParse(BackupPathSchema, backupPath, 'Chemin du backup');
      const safePath = validatePathWithinSubDir(safeBackupPath, DataStorageService.getConfig().dataPath, DataStorageService.BACKUPS_DIR, 'chemin backup');
      return await BackupService.validateBackup(safePath);
    } catch (error: unknown) {
      return { valid: false, error: toHumanError(error) };
    }
  });

  // ─── Migration (§35) ──────────────────────────────────────────────────────
  ipcMain.handle('migration:scanOldDatabases', async () => MigrationService.scanForOldDatabases());
  ipcMain.handle('migration:autoMigrate', async () => MigrationService.autoMigrate());

  ipcMain.handle('migration:migrateFrom', async (_, sourcePath: unknown) => {
    try {
      const safeSourcePath = safeParse(SourcePathSchema, sourcePath, 'Chemin source');
      return await MigrationService.migrateFromOldDatabase(safeSourcePath);
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

  // ─── Presse-papier (electron.clipboard) ───────────────────────────────────
  // `navigator.clipboard` échoue silencieusement sous sandbox:true sans
  // permission 'clipboard-write'. On passe par l'API native Electron via IPC.
  ipcMain.handle('system:writeClipboard', async (_, text: unknown) => {
    if (typeof text !== 'string') return { success: false, error: 'Texte invalide.' };
    try {
      clipboard.writeText(text);
      return { success: true };
    } catch (error: unknown) {
      return { success: false, error: toHumanError(error) };
    }
  });
}
