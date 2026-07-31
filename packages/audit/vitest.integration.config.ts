import { defineConfig } from 'vitest/config'

/**
 * Tests d'intégration : nécessitent une base PostgreSQL accessible via
 * DATABASE_URL. Séparés des tests unitaires pour que `pnpm test` reste
 * exécutable sans infrastructure.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    // Ces tests partagent une base : les exécuter en parallèle produirait des
    // interférences sur la chaîne d'audit, qui est séquentielle par nature.
    fileParallelism: false,
    testTimeout: 30_000,
  },
})
