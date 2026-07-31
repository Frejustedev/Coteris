/**
 * @coteris/shared — socle commun.
 *
 * Ce paquet est la feuille du graphe de dépendances : il n'importe aucun autre
 * paquet de Coteris (voir docs/adr/0001-monolithe-modulaire.md).
 */

export * from './millipoints'
export * from './confidence'
export * from './ids'
export type { Env } from './env'
export { env, parseEnv, resetEnvCache, envSchema } from './env'
