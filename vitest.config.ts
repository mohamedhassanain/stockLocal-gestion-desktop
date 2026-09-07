import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // timeout porté à 30s : le test de volumétrie (`50k mouvements`) insère
    // 50 000 lignes en boucle et dépasse 10s sous vitest 4 (contre <10s sous
    // vitest 2). Réglage d'exécution uniquement — la logique des tests est
    // inchangée.
    testTimeout: 30000,
    // Les tests s'exécutent sur Node système (N-API d'better-sqlite3, stable
    // entre Node et Electron). Pool forks = isolation fiable et simple.
    pool: 'forks',
  },
});
