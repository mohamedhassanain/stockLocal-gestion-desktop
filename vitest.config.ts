import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 10000,
    // Les tests s'exécutent sur Node système (N-API d'better-sqlite3, stable
    // entre Node et Electron). Pool forks = isolation fiable et simple.
    pool: 'forks',
  },
});
