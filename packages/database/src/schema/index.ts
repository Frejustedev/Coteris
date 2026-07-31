/**
 * Schéma complet de Coteris.
 *
 * Invariant vérifié par `schema.test.ts` : toute table métier porte une colonne
 * `organization_id` non nulle. C'est la base du cloisonnement entre
 * établissements — une table qui l'oublierait ne pourrait pas être protégée.
 */

export * from './_shared'
export * from './auth'
export * from './assessments'
export * from './rubrics'
export * from './submissions'
export * from './ocr'
export * from './grading'
export * from './audit'
export * from './ai'
export * from './deliverables'
