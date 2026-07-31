/**
 * Worker Coteris.
 *
 * Processus distinct de l'application web, consommant la file de travaux qui vit
 * dans PostgreSQL (voir docs/adr/0003-file-attente-postgres.md).
 *
 *   pnpm --filter @coteris/worker start     traite en continu
 *   pnpm --filter @coteris/worker once      vide la file puis s'arrête
 *
 * Le mode `once` sert aux tests et à l'hébergement mutualisé, où maintenir un
 * processus permanent relève de la béquille : une tâche cron l'appelle
 * régulièrement (voir docs/deployment.md).
 */

import { run, runOnce, type Task } from 'graphile-worker'

import { TASKS, migrateQueue } from '@coteris/jobs'

import { createContext } from './context'
import { analyserReponse } from './tasks/analyser-reponse'

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL']
  if (!url) throw new Error('DATABASE_URL est requis.')

  const uneSeulePasse = process.argv.includes('--once')
  const ctx = createContext()

  // Idempotent : le schéma de la file est créé au premier démarrage.
  await migrateQueue(url)

  const taskList: Record<string, Task> = {
    [TASKS.ANALYZE_REGION]: async (payload) => {
      await analyserReponse(payload, ctx)
    },
    [TASKS.SECOND_PASS]: async (payload) => {
      await analyserReponse({ ...(payload as object), forceSecondPass: true }, ctx)
    },
  }

  const concurrency = Number(process.env['WORKER_CONCURRENCY'] ?? 4)

  try {
    if (uneSeulePasse) {
      console.log('Traitement de la file, puis arrêt.')
      await runOnce({ connectionString: url, taskList, concurrency })
      console.log('File vidée.')
      return
    }

    console.log(`Worker démarré — ${concurrency} tâches simultanées.`)
    const runner = await run({
      connectionString: url,
      taskList,
      concurrency,
      // Le worker écoute les notifications Postgres : pas d'interrogation
      // active, donc pas de charge inutile entre deux travaux.
      pollInterval: 2000,
    })

    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.on(signal, () => {
        console.log(`\n${signal} reçu — arrêt après les tâches en cours.`)
        void runner.stop().then(() => ctx.close())
      })
    }

    await runner.promise
  } finally {
    if (uneSeulePasse) await ctx.close()
  }
}

main().catch((error: unknown) => {
  console.error('Le worker a échoué :', error)
  process.exitCode = 1
})
