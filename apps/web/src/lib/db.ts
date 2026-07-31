/**
 * Connexion à la base pour l'application web.
 *
 * Une seule instance par processus. En développement, Next.js recharge les
 * modules à chaud : sans le cache sur `globalThis`, chaque modification de
 * fichier ouvrirait un nouveau pool et épuiserait les connexions Postgres en
 * quelques minutes.
 */

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '@coteris/database'

const globalForDb = globalThis as unknown as {
  __coterisSql?: ReturnType<typeof postgres>
}

function client(): ReturnType<typeof postgres> {
  const url = process.env['DATABASE_URL']
  if (!url) {
    throw new Error(
      'DATABASE_URL est absent. Copiez .env.example vers .env et renseignez la base.',
    )
  }

  globalForDb.__coterisSql ??= postgres(url, {
    max: Number(process.env['DATABASE_POOL_SIZE'] ?? 10),
    // Ni identifiants ni extraits de copies dans les journaux.
    debug: false,
    onnotice: () => {},
  })

  return globalForDb.__coterisSql
}

export const db = drizzle(client(), { schema, casing: 'snake_case' })
export { schema }
