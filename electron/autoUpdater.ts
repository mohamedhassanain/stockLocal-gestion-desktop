import { autoUpdater } from 'electron-updater';
import { BrowserWindow } from 'electron';

/**
 * Infrastructure d'auto-update (2.3) — mécanique configurée, aucun déploiement.
 *
 * - Vérification au démarrage : silencieuse et non bloquante (aucun popup
 *   intrusif), une notification discrète est envoyée au renderer seulement si
 *   une mise à jour est réellement disponible.
 * - Vérification manuelle : exposée via `app:checkForUpdates` (bouton
 *   "Vérifier les mises à jour" dans les Paramètres).
 * - Provider de publication : `generic` (URL dans package.json → `build.publish`).
 *   L'hébergement réel est à configurer par l'éditeur (cf. README).
 *
 * La signature de code (SmartScreen) est documentée dans le README ; le
 * champ `win.signtoolOptions` / variables CSC_LINK/CSC_KEY_PASSWORD de
 * electron-builder seront remplis quand le certificat sera fourni (2.4).
 */
let isChecking = false;

function sendToRenderer(channel: string, payload?: unknown): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

export function initAutoUpdater(): void {
  // En dev, electron-updater tenterait de contacter l'URL de publish :
  // on désactive explicitement (le paquet n'est pas signé ni versionné
  // comme release en mode `vite`).
  if (!process.env.VITE_DEV_SERVER_URL && !process.env.ELECTRON_RUN_AS_NODE) {
    // Téléchargement automatique en arrière-plan ; l'installation se fait à la
    // fermeture (comportement discret demandé — aucune interruption).
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', (info) => {
      console.log('[Updater] Mise à jour disponible :', info.version);
      sendToRenderer('update:available', { version: info.version });
    });

    autoUpdater.on('update-not-available', () => {
      sendToRenderer('update:not-available');
    });

    autoUpdater.on('error', (err) => {
      // Silencieux au démarrage ; en check manuel le renderer voit l'erreur.
      console.warn('[Updater] Erreur :', err?.message ?? err);
      sendToRenderer('update:error', { message: 'Impossible de vérifier les mises à jour (hors ligne ou serveur indisponible).' });
    });

    autoUpdater.on('update-downloaded', (info) => {
      sendToRenderer('update:downloaded', { version: info.version });
    });

    // Vérification silencieuse au démarrage (non bloquante).
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(() => {
        // Aucune action : vérification silencieuse, l'erreur est déjà loggée.
      });
    }, 10_000);
  }
}

/** Vérification manuelle déclenchée depuis Paramètres. */
export async function checkForUpdatesManually(): Promise<{ success: boolean; message: string }> {
  if (isChecking) {
    return { success: false, message: 'Une vérification est déjà en cours.' };
  }
  if (process.env.VITE_DEV_SERVER_URL || process.env.ELECTRON_RUN_AS_NODE) {
    return { success: false, message: 'La vérification des mises à jour est désactivée en mode développement.' };
  }
  isChecking = true;
  try {
    const result = await autoUpdater.checkForUpdates();
    return { success: true, message: result ? 'Vérification terminée.' : 'Aucune mise à jour disponible.' };
  } catch (e: any) {
    return { success: false, message: 'Impossible de vérifier les mises à jour. Vérifiez votre connexion internet.' };
  } finally {
    isChecking = false;
  }
}

/** Télécharge puis installe une mise à jour déjà téléchargée (appelé par le renderer). */
export function installUpdate(): void {
  autoUpdater.quitAndInstall(false, true);
}

export default autoUpdater;
