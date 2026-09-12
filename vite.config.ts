import path from 'node:path';
import fs from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';

/**
 * Construit le prédicat `ignored` du watcher Vite.
 *
 * Le point crucial est de NE PAS se limiter à un nom de dossier. On résout les
 * CHEMINS RÉELS de données runtime (même logique que DataStorageService) :
 *   1. STOCKLOCAL_USER_DATA_DIR (serveur MCP standalone / tests)
 *   2. STOCKLOCAL_TEST_DATA_PATH (Vitest)
 *   3. Fallback `.stocklocal-test-data` dans le projet
 *   4. Le `dataPath` réellement configuré dans storage-config.json
 * Puis on ignore tout chemin sous ces dossiers, plus tout fichier SQLite
 * (`.db`, `.db-wal`, `.db-shm`, `.db-journal`, `.sqlite`, `.sqlite3`, `.db3`).
 *
 * Pourquoi une fonction plutôt que des globs : les globs "data" et
 * "backups" sont trop larges (ils excluraient un futur dossier src/data), et
 * sur Windows les séparateurs "\" peuvent faire échouer le matching. Une
 * fonction reçoit le chemin ABSOLU, normalise les séparateurs, et cible
 * précisément les données runtime — c'est le correctif robuste demandé.
 */
export function buildWatchIgnored() {
  const runtimeDirs = new Set<string>();
  const cwd = process.cwd();

  const addDir = (dir: string | undefined) => {
    if (dir) runtimeDirs.add(path.resolve(dir));
  };

  // 1. Variable d'environnement prioritaire (serveur MCP standalone)
  addDir(process.env.STOCKLOCAL_USER_DATA_DIR);
  // 2. Dossier de test (Vitest)
  addDir(process.env.STOCKLOCAL_TEST_DATA_PATH);
  // 3. Fallback historique : .stocklocal-test-data dans le projet
  addDir(path.join(cwd, '.stocklocal-test-data'));

  // 4. Lire storage-config.json pour obtenir le dataPath réellement configuré
  const configCandidates = [
    path.join(cwd, '.stocklocal-test-data', 'storage-config.json'),
    ...(process.env.STOCKLOCAL_USER_DATA_DIR
      ? [path.join(process.env.STOCKLOCAL_USER_DATA_DIR, 'storage-config.json')]
      : []),
    ...(process.env.STOCKLOCAL_TEST_DATA_PATH
      ? [path.join(process.env.STOCKLOCAL_TEST_DATA_PATH, 'storage-config.json')]
      : []),
  ];
  for (const configPath of configCandidates) {
    try {
      if (fs.existsSync(configPath)) {
        const parsed = JSON.parse(
          fs.readFileSync(configPath, 'utf-8'),
        ) as { dataPath?: string };
        if (parsed.dataPath) addDir(parsed.dataPath);
      }
    } catch {
      // config illisible → on ignore ce candidat
    }
  }

  const dirList = [...runtimeDirs].map((d) =>
    path.resolve(d).replace(/\\/g, '/').toLowerCase(),
  );

  return (watchedPath: string): boolean => {
    const normalized = path.resolve(watchedPath).replace(/\\/g, '/').toLowerCase();

    // 1. Sous un dossier de données runtime ?
    for (const dir of dirList) {
      if (normalized === dir || normalized.startsWith(dir + '/')) {
        return true;
      }
    }

    // 2. Fichier SQLite (et fichiers satellites WAL/SHM/JOURNAL) n'importe où ?
    if (
      /\.db(-wal|-shm|-journal)?$/i.test(normalized) ||
      /\.(sqlite|sqlite3|db3)$/i.test(normalized)
    ) {
      return true;
    }

    // 3. Défensif : dossier nommé `data` ou `backups` à n'importe quel niveau.
    //    Le projet ne contient AUCUN dossier source nommé ainsi, donc c'est un
    //    filet de sécurité qui cible les données runtime (aucun risque de
    //    casser le HMR d'un futur `src/data/` de code source).
    if (/(^|\/)data(\/|$)/.test(normalized) || /(^|\/)backups(\/|$)/.test(normalized)) {
      return true;
    }

    return false;
  };
}

/**
 * Injecte la CSP stricte UNIQUEMENT dans le build de production.
 *
 * Pourquoi pas un <meta> statique dans index.html : le même fichier sert au
 * dev, où @vitejs/plugin-react injecte un préambule inline (react-refresh)
 * qu'une CSP `script-src 'self'` bloquerait → page blanche
 * ("can't detect preamble").
 *
 * Pourquoi pas via onHeadersReceived dans electron/main.ts : ce hook ne
 * s'exécute pas pour le protocole file:// des builds packagés. Un <meta> CSP
 * dans le HTML s'applique aussi bien sur file:// que sur http(s) — c'est la
 * seule approche qui protège réellement la production.
 */
function cspPlugin(): Plugin {
  return {
    name: 'inject-csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      const csp = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: file:",
        "font-src 'self' data:",
        "connect-src 'self'",
      ].join('; ');
      return {
        html,
        tags: [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: csp },
            injectTo: 'head-prepend',
          },
        ],
      };
    },
  };
}

/**
 * Filet de sécurité (point 3) : une erreur du watcher de fichiers — ex. EBUSY
 * sur un fichier .db activement écrit par SQLite, ou un antivirus Windows qui
 * verrouille temporairement un fichier — ne doit jamais faire planter tout le
 * processus de dev. On logue un avertissement au lieu de laisser remonter une
 * exception non gérée.
 */
function watcherErrorGuard(): Plugin {
  return {
    name: 'watcher-error-guard',
    configureServer(server) {
      server.watcher.on('error', (err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn('[vite] Erreur de watcher ignorée (non bloquant) :', message);
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    watch: {
      // Point 1 : on exclut les données runtime du watcher via une fonction
      // qui résout les CHEMINS RÉELS de données (buildWatchIgnored) : le
      // dossier de données d'Electron, le repli `.stocklocal-test-data`
      // (test / Node pur / serveur MCP), et le dataPath de storage-config.json.
      // SQLite écrit activement les .db (et ses wal/shm) : sur Windows, ouvrir
      // un watch handle sur un fichier verrouillé lève EBUSY et plantait
      // `npm run dev`. La fonction ignore ces fichiers et dossiers partout.
      ignored: buildWatchIgnored(),
    },
  },
  plugins: [
    react(),
    cspPlugin(),
    watcherErrorGuard(),
    electron([
      {
        // Main process entry file
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              // On empêche Vite de bundler 'better-sqlite3' (module natif C++)
              external: ['better-sqlite3']
            }
          }
        }
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          // Notify the Renderer process to reload the page when the Preload scripts build is complete
          options.reload();
        },
      },
    ]),
    renderer(),
  ],
});
