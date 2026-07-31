import { defineConfig } from 'vitest/config'

/**
 * Tests unitaires : aucune infrastructure requise.
 *
 * Les tests d'intégration sont explicitement exclus. Sans cette exclusion,
 * `pnpm test` exigerait une base PostgreSQL, et le job « qualité » de la CI —
 * qui n'en démarre pas — échouerait.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts', '**/node_modules/**', '**/dist/**'],
  },
})
