import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
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
