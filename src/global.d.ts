// Les appels IPC Electron sont typés via le bridge preload.ts.
declare global {
  interface Window {
    api: typeof import('../electron/preload').api;
  }
}

// Import CSS (design system)
declare module '*.css';

export {};
