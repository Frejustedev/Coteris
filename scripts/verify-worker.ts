/**
 * Vérification de la boucle complète : mise en file → worker → proposition.
 *
 * C'est la propriété que la file dans PostgreSQL est censée garantir, et elle ne
 * se vérifie qu'en la faisant tourner :
 *
 *   1. une mise en file dans une transaction annulée ne laisse **aucun** job ;
 *   2. une mise en file validée produit un job **et** son événement d'audit ;
 *   3. le worker le traite et écrit une nouvelle proposition, sans jamais
 *      toucher aux points déjà attribués par un humain ;
 *   4. la chaîne d'audit reste intègre.
 *
 *   pnpm verify:worker
 *
 * Prérequis : `pnpm db:migrate && pnpm db:seed`, et le worker accessible via
 * `pnpm --filter @coteris/worker once`.
 */

import { execFileSync } from 'node:child_process'
import { sql } from 'drizzle-orm'

import { verifyChain } from '@coteris/audit'
import { TASKS, addJob, migrateQueue, type JobTransaction } from '@coteris/jobs'

import { db } from '../apps/web/src/lib/db'

const SECRET = process.env['AUDIT_HASH_SECRET'] ?? ''
const URL = process.env['DATABASE_URL'] ?? ''
let échecs = 0

function vérifier(condition: boolean, message: string, détail?: string): void {
  if (condition) {
    console.log(`  [32mOK[0m    ${message}`)
  } else {
    échecs += 1
    console.error(`  [31mÉCHEC[0m ${message}`)
    if (détail) console.error(`        ${détail}`)
  }
}

async function une<T>(requête: ReturnType<typeof sql>): Promise<T | undefined> {
  const lignes = (await db.execute(requête)) as unknown as T[]
  return lignes[0]
}

const compter = async (requête: ReturnType<typeof sql>): Promise<number> =>
  Number((await une<{ n: string }>(requête))?.n ?? 0)

async function main(): Promise<void> {
  if (SECRET.length < 32) throw new Error('AUDIT_HASH_SECRET est requis.')
  if (!URL) throw new Error('DATABASE_URL est requis.')

  console.log('\nVérification de la file de travaux et du worker\n')

  await migrateQueue(URL)

  const org = await une<{ id: string }>(
    sql`SELECT id FROM organization WHERE slug = 'faculte-demo'`,
  )
  const cible = await une<{ region_id: string; submission_id: string; question_id: string }>(sql`
    SELECT ar.id AS region_id, ar.submission_id, ar.question_id
    FROM answer_regions ar
    JOIN transcription_versions tv ON tv.answer_region_id = ar.id AND tv.is_current = true
    WHERE length(tv.text) > 20
    ORDER BY ar.id
    LIMIT 1
  `)
  if (!org || !cible) throw new Error('Données de démonstration absentes. Exécutez « pnpm db:seed ».')

  const charge = {
    organizationId: org.id,
    submissionId: cible.submission_id,
    answerRegionId: cible.region_id,
    questionId: cible.question_id,
    forceSecondPass: false,
    requestedBy: null,
  }

  // --- Mise en file transactionnelle ------------------------------------------
  console.log('Mise en file transactionnelle')

  const jobsAvant = await compter(sql`SELECT count(*) AS n FROM graphile_worker._private_jobs`)

  await db
    .transaction(async (tx) => {
      await addJob(tx as unknown as JobTransaction, TASKS.ANALYZE_REGION, charge)
      // On annule volontairement : le job ne doit pas survivre.
      throw new Error('annulation volontaire')
    })
    .catch(() => undefined)

  const aprèsAnnulation = await compter(
    sql`SELECT count(*) AS n FROM graphile_worker._private_jobs`,
  )
  vérifier(
    aprèsAnnulation === jobsAvant,
    'une transaction annulée ne laisse aucun job — c’est toute la raison d’être de la file dans Postgres',
    `avant ${jobsAvant}, après ${aprèsAnnulation}`,
  )

  // --- Mise en file validée -----------------------------------------------------
  const runsAvant = await compter(
    sql`SELECT count(*) AS n FROM grading_runs WHERE answer_region_id = ${cible.region_id}::uuid`,
  )
  const auditAvant = await compter(
    sql`SELECT count(*) AS n FROM audit_events WHERE organization_id = ${org.id}::uuid`,
  )

  await db.transaction(async (tx) => {
    await addJob(tx as unknown as JobTransaction, TASKS.ANALYZE_REGION, charge, {
      jobKey: `verif:${cible.region_id}`,
    })
  })

  vérifier(
    (await compter(sql`SELECT count(*) AS n FROM graphile_worker._private_jobs`)) === jobsAvant + 1,
    'une transaction validée met exactement un job en file',
  )

  // La clé d'unicité doit empêcher le doublon : un correcteur qui clique deux
  // fois ne doit pas déclencher deux appels d'IA facturés.
  await db.transaction(async (tx) => {
    await addJob(tx as unknown as JobTransaction, TASKS.ANALYZE_REGION, charge, {
      jobKey: `verif:${cible.region_id}`,
    })
  })
  vérifier(
    (await compter(sql`SELECT count(*) AS n FROM graphile_worker._private_jobs`)) === jobsAvant + 1,
    'une seconde mise en file avec la même clé ne crée pas de doublon',
  )

  // --- Exécution par le worker ----------------------------------------------------
  console.log('\nExécution par le worker')

  try {
    execFileSync('pnpm', ['--filter', '@coteris/worker', 'once'], {
      stdio: 'pipe',
      env: process.env,
      shell: process.platform === 'win32',
    })
    console.log('  [32mOK[0m    le worker a vidé la file')
  } catch (error) {
    échecs += 1
    console.error('  [31mÉCHEC[0m le worker a échoué')
    console.error(String((error as { stdout?: Buffer }).stdout ?? error))
  }

  vérifier(
    (await compter(sql`SELECT count(*) AS n FROM graphile_worker._private_jobs`)) === jobsAvant,
    'la file est vide après traitement',
  )

  const runsAprès = await compter(
    sql`SELECT count(*) AS n FROM grading_runs WHERE answer_region_id = ${cible.region_id}::uuid`,
  )
  vérifier(
    runsAprès === runsAvant + 1,
    'le worker a produit une nouvelle analyse',
    `avant ${runsAvant}, après ${runsAprès}`,
  )

  const dernier = await une<{
    id: string
    prompt_version: number
    confidence_level: string
    total_proposed: number
  }>(sql`
    SELECT id, prompt_version, confidence_level, total_proposed
    FROM grading_runs WHERE answer_region_id = ${cible.region_id}::uuid
    ORDER BY created_at DESC LIMIT 1
  `)
  vérifier(Boolean(dernier?.prompt_version), 'la version du prompt est enregistrée')
  vérifier(Boolean(dernier?.confidence_level), 'le niveau de confiance est enregistré')

  const sansAttribution = await compter(sql`
    SELECT count(*) AS n FROM grading_decisions
    WHERE grading_run_id = ${String(dernier?.id)}::uuid AND points_awarded IS NOT NULL
  `)
  vérifier(
    sansAttribution === 0,
    'le worker n’attribue aucun point : seul un humain le fait',
    `${sansAttribution} décision(s) déjà attribuée(s)`,
  )

  const preuves = await compter(sql`
    SELECT count(*) AS n FROM grading_evidence e
    JOIN grading_decisions d ON d.id = e.grading_decision_id
    WHERE d.grading_run_id = ${String(dernier?.id)}::uuid
  `)
  vérifier(preuves > 0, 'des extraits justificatifs ont été enregistrés', `${preuves} preuve(s)`)

  // --- Audit ------------------------------------------------------------------------
  console.log('\nAudit')

  const auditAprès = await compter(
    sql`SELECT count(*) AS n FROM audit_events WHERE organization_id = ${org.id}::uuid`,
  )
  vérifier(
    auditAprès > auditAvant,
    'le traitement a produit un événement d’audit',
    `avant ${auditAvant}, après ${auditAprès}`,
  )

  const chaîne = await verifyChain(db, org.id, SECRET)
  vérifier(
    chaîne.valid,
    `la chaîne d’audit reste intègre (${chaîne.eventsChecked} événements)`,
    chaîne.breaks.map((b) => b.detail).join(' · '),
  )

  console.log('')
  if (échecs === 0) console.log('[32mToutes les vérifications passent.[0m\n')
  else {
    console.error(`[31m${échecs} vérification(s) en échec.[0m\n`)
    process.exitCode = 1
  }
}

main()
  .catch((error: unknown) => {
    console.error('\nÉchec de la vérification :', error)
    process.exitCode = 1
  })
  .finally(() => process.exit(process.exitCode ?? 0))
