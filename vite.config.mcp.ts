import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';
import path from 'node:path';

/**
 * Build dédié du serveur MCP externe (Mode B).
 *
 * Compile src/ai/mcpServer.ts (et son graphe : McpTools, services, repositories,
 * connexion SQLite) en UN SEUL fichier CommonJS autonome `dist-electron/mcp-server.js`,
 * exécutable via `node dist-electron/mcp-server.js`.
 *
 * better-sqlite3 est un module natif C++ → external (résolu depuis node_modules
 * au runtime, comme dist-electron/main.js). Les builtins Node sont aussi
 * externalisés.
 */
export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(process.cwd(), 'src/ai/mcpServer.ts'),
      formats: ['cjs'],
      fileName: () => 'mcp-server.js',
    },
    rollupOptions: {
      external: [
        'better-sqlite3',
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
      ],
    },
    outDir: 'dist-electron',
    emptyOutDir: false,
  },
});
