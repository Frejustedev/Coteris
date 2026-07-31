/**
 * Connexion à PostgreSQL.
 *
 * Le pilote `postgres` est du JavaScript pur, sans binaire natif : c'est une
 * exigence de l'hébergement mutualisé visé (voir ADR 0005).
 */

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import * as schema from './schema/index'

export type Database = ReturnType<typeof createDatabase>

export interface DatabaseOptions {
  readonly url: string
  readonly poolSize?: number
  /** Vrai pour le worker : pool distinct, afin qu'un pic de jobs n'affame pas le web. */
  readonly isWorker?: boolean
}

export function createDatabase(options: DatabaseOptions) {
  const client = postgres(options.url, {
    max: options.poolSize ?? 10,
    // Les identifiants et les extraits de copies ne doivent jamais apparaître
    // dans les journaux. On désactive la trace des requêtes.
    debug: false,
    onnotice: () => {},
    types: {
      // Les bigint reviennent en `number` : nos coûts en millionièmes d'euro
      // restent très en deçà de Number.MAX_SAFE_INTEGER.
      bigint: postgres.BigInt,
    },
  })

  return drizzle(client, { schema, casing: 'snake_case' })
}

let instance: Database | undefined

/** Instance partagée. Créée à la première demande. */
export function db(url: string, poolSize?: number): Database {
  instance ??= createDatabase({ url, ...(poolSize === undefined ? {} : { poolSize }) })
  return instance
}

export { schema }
