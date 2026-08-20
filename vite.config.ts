import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';

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

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    cspPlugin(),
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
