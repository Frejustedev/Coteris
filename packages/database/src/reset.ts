/**
 * Réinitialisation complète de la base.
 *
 * Réservé au développement et aux tests. Refuse de s'exécuter en production :
 * cette commande détruit des copies d'examen et des notes, une erreur de terminal
 * ne doit pas suffire à les perdre.
 */

import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL']
  if (!url) throw new Error('DATABASE_URL est requis.')

  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      'Réinitialisation refusée : NODE_ENV vaut production. ' +
        'Cette commande détruirait des copies et des notes.',
    )
  }

  const client = postgres(url, { max: 1 })
  const db = drizzle(client)

  try {
    // Le schéma est recréé de zéro : c'est le seul moyen de supprimer aussi
    // `audit_events`, que ses déclencheurs protègent de toute suppression.
    await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE;`)
    await db.execute(sql`CREATE SCHEMA public;`)

    // Le journal des migrations vit dans un schéma distinct. L'oublier laissait
    // Drizzle convaincu que la migration était déjà appliquée, alors que les
    // tables venaient d'être supprimées : la base restait vide et la migration
    // suivante échouait sans raison apparente.
    await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE;`)
    console.log('Base réinitialisée. Exécutez « pnpm db:migrate » pour recréer le schéma.')
  } finally {
    await client.end()
  }
}

main().catch((error: unknown) => {
  console.error('Échec de la réinitialisation :', error)
  process.exitCode = 1
})
