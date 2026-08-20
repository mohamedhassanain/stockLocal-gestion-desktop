/**
 * Lance Vitest avec le Node d'Electron (ELECTRON_RUN_AS_NODE=1).
 *
 * Pourquoi : better-sqlite3 est un module natif compilé pour l'ABI d'Electron
 * (via `electron-builder install-app-deps`). Pour que les tests valident
 * exactement le même binaire que celui chargé par l'application, on exécute
 * Vitest avec le Node embarqué d'Electron.
 *
 * Usage :
 *   npm test            → vitest run (via Electron)
 *   npm run test:watch  → vitest (mode watch, via Electron)
 */
const { spawnSync } = require('child_process');
const path = require('path');

let electronPath;
try {
  // En Node pur, `require('electron')` renvoie le chemin de l'exécutable.
  electronPath = require('electron');
} catch {
  console.error('[tests] Electron introuvable. Lancez `npm install` d\'abord.');
  process.exit(1);
}

if (typeof electronPath !== 'string') {
  console.error('[tests] Impossible de résoudre le binaire Electron.');
  process.exit(1);
}

const vitestEntry = path.join(__dirname, '..', 'node_modules', 'vitest', 'vitest.mjs');
const args = process.argv.slice(2);
const isRun = args[0] === 'run';
const passthrough = isRun ? args : ['--run'];

const result = spawnSync(electronPath, [vitestEntry, ...passthrough], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: 'inherit',
  shell: false,
});

process.exit(result.status ?? 1);
