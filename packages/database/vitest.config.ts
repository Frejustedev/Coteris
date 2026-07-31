import { defineConfig } from 'vitest/config'

/** Tests unitaires : inspection du schéma, sans base de données. */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts', '**/node_modules/**', '**/dist/**'],
  },
})
