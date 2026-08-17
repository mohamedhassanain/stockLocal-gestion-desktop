// Permet d'éviter les erreurs TypeScript pour les appels IPC d'Electron
declare global {
  interface Window {
    api: any;
  }
}

export {};
