import { defineConfig } from 'drizzle-kit'

/**
 * Configuration des migrations.
 *
 * Les migrations sont générées ici puis relues et commitées. La CI vérifie que le
 * schéma TypeScript et les migrations commitées ne divergent jamais : sur un
 * produit dont l'argument est la traçabilité, une migration appliquée en
 * production sans être dans le dépôt n'est pas acceptable.
 */
export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  casing: 'snake_case',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgresql://coteris:coteris@localhost:5432/coteris',
  },
  verbose: true,
  strict: true,
})
