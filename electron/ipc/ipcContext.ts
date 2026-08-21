import { ipcMain } from 'electron';

/**
 * Contexte partagé des modules IPC.
 *
 * La fenêtre principale n'existe qu'après `app.whenReady()`. Les modules IPC
 * reçoivent un getter pour y accéder paresseusement (ex. `storage:pickFolder`).
 */
export interface IpcContext {
  getMainWindow(): Electron.BrowserWindow | null;
}

let context: IpcContext;

export function setIpcContext(ctx: IpcContext): void {
  context = ctx;
}

export function getIpcContext(): IpcContext {
  if (!context) {
    throw new Error('IpcContext non initialisé — appeler setIpcContext avant registerIpcHandlers().');
  }
  return context;
}

export { ipcMain };
