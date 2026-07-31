/**
 * Installation du schéma de la file de travaux.
 *
 * Graphile Worker crée son propre schéma `graphile_worker`. Il est distinct de
 * `public`, où vit le schéma métier : nos migrations Drizzle et celles de la file
 * n'interfèrent donc jamais.
 *
 * Appelé au démarrage du worker et par `pnpm jobs:migrate`. Idempotent.
 */

import { runMigrations } from 'graphile-worker'

export async function migrateQueue(connectionString: string): Promise<void> {
  await runMigrations({ connectionString })
}
