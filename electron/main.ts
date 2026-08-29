import { app, BrowserWindow, shell, session } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setIpcContext } from './ipc/ipcContext';
import { registerReferenceDataHandlers } from './ipc/referenceData.ipc';
import { registerBusinessDataHandlers } from './ipc/businessData.ipc';
import { registerOperationsHandlers } from './ipc/operations.ipc';
import { registerSystemHandlers } from './ipc/system.ipc';
import { initAutoUpdater } from './autoUpdater';
import { ErrorLogService } from '../src/services/ErrorLogService';
import { DemoDataService } from '../src/services/DemoDataService';
import { AuditService } from '../src/services/AuditService';
import { BackupService } from '../src/services/BackupService';
import { GlobalSettingsService } from '../src/services/GlobalSettingsService';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.APP_ROOT = path.join(__dirname, '..');
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron');
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST;

let win: BrowserWindow | null = null;
let isBackingUpOnClose = false;

/** CSP alignée sur vite.config.ts (build prod) — images produits en data:, styles inline React. */
const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: file:",
  "font-src 'self' data:",
  "connect-src 'self'",
].join('; ');

function installContentSecurityPolicy(): void {
  // En dev, Vite injecte un préambule inline (react-refresh) : une CSP stricte casse le HMR.
  if (VITE_DEV_SERVER_URL) return;

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [PRODUCTION_CSP],
      },
    });
  });
}

/**
 * Sécurité Chromium/Electron :
 *  - sandbox: true  → le renderer n'a AUCUN accès Node (même limité)
 *  - contextIsolation: true → l'API exposée via preload est isolée du contexte page
 *  - nodeIntegration: false → pas d'accès direct à Node depuis le DOM
 *  - webSecurity reste activé par défaut
 */
function createWindow(): void {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(process.env.VITE_PUBLIC ?? '', 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  // Bloquer toute navigation hors de l'application (anti-hijack, anti-phishing)
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = VITE_DEV_SERVER_URL
      ? url.startsWith(VITE_DEV_SERVER_URL)
      : url.startsWith('file://');
    if (!allowed) {
      event.preventDefault();
      // Ouvrir les liens externes dans le navigateur système si c'est un http(s) sûr
      if (/^https?:\/\//.test(url)) {
        shell.openExternal(url).catch(() => {});
      }
    }
  });

  // window.open / popups → jamais de nouvelle fenêtre Electron
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'));
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
    win = null;
  }
});

// Sauvegarde automatique « À chaque fermeture » : uniquement si l'utilisateur
// a activé la sauvegarde automatique ET choisi la fréquence "on_close".
app.on('before-quit', (event) => {
  if (isBackingUpOnClose) return;
  try {
    const settings = GlobalSettingsService.getAll();
    if (settings.auto_backup_enabled && settings.auto_backup_frequency === 'on_close') {
      event.preventDefault();
      isBackingUpOnClose = true;
      BackupService.backup().finally(() => {
        app.quit();
      });
    }
  } catch (e) {
    console.error('[Backup] Erreur sauvegarde à la fermeture:', e);
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.whenReady().then(() => {
  installContentSecurityPolicy();

  // ─── Composition root ──────────────────────────────────────────────────────
  // La fenêtre n'existe pas encore : les modules IPC accèdent à la fenêtre via
  // un getter paresseux (ipcContext).
  setIpcContext({
    getMainWindow: () => win,
  });

  registerSystemHandlers({
    getMainWindow: () => win,
  });
  registerReferenceDataHandlers();
  registerBusinessDataHandlers();
  registerOperationsHandlers();

  // ─── Démarrage ────────────────────────────────────────────────────────────
  ErrorLogService.installGlobalHandlers();
  initAutoUpdater();
  try {
    DemoDataService.seedIfEmpty();
  } catch (error) {
    console.error('[Seed] Échec du jeu de données de démonstration :', error);
  }
  AuditService.log('APP_START', 'system', 'stocklocal', 'Application démarrée');
  BackupService.scheduleAutoBackup();
  createWindow();
});
