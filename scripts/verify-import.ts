/**
 * Vérification de l'import de copies, contre la base et le stockage réels.
 *
 *   pnpm verify:import
 *
 * Prérequis : `pnpm db:migrate && pnpm db:seed`.
 */

import { execFileSync } from 'node:child_process'
import { sql } from 'drizzle-orm'

import { verifyChain } from '@coteris/audit'
import type { Principal } from '@coteris/auth'

import { db } from '../apps/web/src/lib/db'
import { storage } from '../apps/web/src/lib/storage'
import { importerCopie } from '../apps/web/src/lib/services/import'

const SECRET = process.env['AUDIT_HASH_SECRET'] ?? ''
let échecs = 0

/** PNG valide de 1×1 pixel : le plus petit fichier que l'import doit accepter. */
const PNG_MINIMAL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

function vérifier(condition: boolean, message: string, détail?: string): void {
  if (condition) console.log(`  [32mOK[0m    ${message}`)
  else {
    échecs += 1
    console.error(`  [31mÉCHEC[0m ${message}`)
    if (détail) console.error(`        ${détail}`)
  }
}

async function une<T>(requête: ReturnType<typeof sql>): Promise<T | undefined> {
  return ((await db.execute(requête)) as unknown as T[])[0]
}

const compter = async (requête: ReturnType<typeof sql>): Promise<number> =>
  Number((await une<{ n: string }>(requête))?.n ?? 0)

async function main(): Promise<void> {
  if (SECRET.length < 32) throw new Error('AUDIT_HASH_SECRET est requis.')

  console.log("\nVérification de l'import de copies\n")

  const org = await une<{ id: string }>(
    sql`SELECT id FROM organization WHERE slug = 'faculte-demo'`,
  )
  const user = await une<{ id: string }>(
    sql`SELECT id FROM "user" WHERE email = 'coordinateur@demo.coteris.local'`,
  )
  const épreuve = await une<{ id: string }>(sql`SELECT id FROM assessments LIMIT 1`)
  if (!org || !user || !épreuve) throw new Error('Données de démonstration absentes.')

  const coordinateur: Principal = { userId: user.id, organizationId: org.id, roles: ['coordinator'] }
  const correcteur: Principal = { ...coordinateur, roles: ['grader'] }

  const base = {
    assessmentId: épreuve.id,
    now: new Date(),
    auditSecret: SECRET,
  }

  // --- Refus ---------------------------------------------------------------------
  console.log('Ce que l’import refuse')

  const refusRôle = await importerCopie(correcteur, user.id, {
    ...base,
    fileName: 'copie.png',
    bytes: new Uint8Array(PNG_MINIMAL),
  })
  vérifier(!refusRôle.ok, 'un correcteur n’importe pas de copies', refusRôle.message)

  const vide = await importerCopie(coordinateur, user.id, {
    ...base,
    fileName: 'vide.png',
    bytes: new Uint8Array(),
  })
  vérifier(!vide.ok, 'un fichier vide est refusé', vide.message)

  // Un fichier texte renommé en .png : le contrôle porte sur les octets.
  const déguisé = await importerCopie(coordinateur, user.id, {
    ...base,
    fileName: 'malveillant.png',
    bytes: new TextEncoder().encode('<?php system($_GET["c"]); ?>'),
  })
  vérifier(
    !déguisé.ok && (déguisé.message ?? '').includes('contenu du fichier'),
    'un fichier déguisé en image est refusé sur ses octets, pas sur son extension',
    déguisé.message,
  )

  const tropGros = await importerCopie(coordinateur, user.id, {
    ...base,
    fileName: 'enorme.png',
    bytes: (() => {
      const gros = new Uint8Array(30 * 1024 * 1024)
      gros.set(PNG_MINIMAL.subarray(0, 8), 0)
      return gros
    })(),
  })
  vérifier(!tropGros.ok, 'un fichier au-delà de la limite est refusé', tropGros.message)

  const pdf = await importerCopie(coordinateur, user.id, {
    ...base,
    fileName: 'copie.pdf',
    bytes: new TextEncoder().encode('%PDF-1.7\n'),
  })
  vérifier(
    !pdf.ok && (pdf.message ?? '').includes('PDF'),
    'un PDF est refusé explicitement plutôt que resté bloqué',
    pdf.message,
  )

  // --- Import réussi ----------------------------------------------------------------
  console.log('\nImport d’une copie')

  const copiesAvant = await compter(
    sql`SELECT count(*) AS n FROM submissions WHERE assessment_id = ${épreuve.id}::uuid`,
  )
  const jobsAvant = await compter(sql`SELECT count(*) AS n FROM graphile_worker._private_jobs`)
  const auditAvant = await compter(
    sql`SELECT count(*) AS n FROM audit_events WHERE organization_id = ${org.id}::uuid`,
  )

  // Un contenu unique, pour ne pas retomber sur la détection de doublon.
  const contenuUnique = new Uint8Array(PNG_MINIMAL.byteLength + 8)
  contenuUnique.set(PNG_MINIMAL, 0)
  contenuUnique.set(new TextEncoder().encode(String(Date.now()).slice(-8)), PNG_MINIMAL.byteLength)

  const importée = await importerCopie(coordinateur, user.id, {
    ...base,
    fileName: 'copie-de-test.png',
    bytes: contenuUnique,
  })
  vérifier(importée.ok, 'la copie est importée', importée.message)
  vérifier(Boolean(importée.anonymousCode), 'un code anonyme est attribué', importée.anonymousCode)

  const copie = await une<{ id: string; file_hash: string; original_file_key: string; quality: string }>(
    sql`SELECT id, file_hash, original_file_key, quality FROM submissions
        WHERE id = ${String(importée.submissionId)}::uuid`,
  )
  vérifier(
    copie?.quality === 'check_recommended',
    'la copie est classée « vérification recommandée » : la segmentation est une hypothèse, pas une détection',
  )

  const objet = copie ? await storage().get(copie.original_file_key) : null
  vérifier(objet !== null, 'le fichier original est écrit dans le stockage')
  vérifier(
    objet?.bytes.byteLength === contenuUnique.byteLength,
    'le fichier stocké a la bonne taille',
  )

  const zones = await compter(
    sql`SELECT count(*) AS n FROM answer_regions WHERE submission_id = ${String(importée.submissionId)}::uuid`,
  )
  const questions = await compter(
    sql`SELECT count(*) AS n FROM questions WHERE assessment_id = ${épreuve.id}::uuid AND deleted_at IS NULL`,
  )
  vérifier(zones === questions, 'une zone de réponse par question', `${zones} zones, ${questions} questions`)

  const horsPage = await compter(sql`
    SELECT count(*) AS n FROM answer_regions
    WHERE submission_id = ${String(importée.submissionId)}::uuid
      AND (x + width > 1.0001 OR y + height > 1.0001)
  `)
  vérifier(horsPage === 0, 'aucune zone ne déborde de la page')

  vérifier(
    (await compter(sql`SELECT count(*) AS n FROM graphile_worker._private_jobs`)) ===
      jobsAvant + questions,
    'une analyse est mise en file par question, dans la même transaction que la copie',
  )

  vérifier(
    (await compter(
      sql`SELECT count(*) AS n FROM audit_events WHERE organization_id = ${org.id}::uuid`,
    )) ===
      auditAvant + 1,
    'l’import produit un événement d’audit',
  )

  // --- Doublon -------------------------------------------------------------------------
  console.log('\nDétection de doublon')

  const doublon = await importerCopie(coordinateur, user.id, {
    ...base,
    fileName: 'copie-de-test-encore.png',
    bytes: contenuUnique,
  })
  vérifier(doublon.ok && doublon.doublon === true, 'un ré-import du même fichier est signalé comme doublon')
  vérifier(
    doublon.submissionId === importée.submissionId,
    'le doublon renvoie vers la copie existante, sans en créer une seconde',
  )
  vérifier(
    (await compter(
      sql`SELECT count(*) AS n FROM submissions WHERE assessment_id = ${épreuve.id}::uuid`,
    )) ===
      copiesAvant + 1,
    'une seule copie a été créée au total',
  )

  // --- Traitement ------------------------------------------------------------------------
  console.log('\nTraitement par le worker')

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

  const analyses = await compter(
    sql`SELECT count(*) AS n FROM grading_runs WHERE submission_id = ${String(importée.submissionId)}::uuid`,
  )
  vérifier(analyses === questions, 'chaque question a été analysée', `${analyses} analyses`)

  const attribués = await compter(sql`
    SELECT count(*) AS n FROM grading_decisions
    WHERE submission_id = ${String(importée.submissionId)}::uuid AND points_awarded IS NOT NULL
  `)
  vérifier(attribués === 0, 'aucun point n’est attribué sans validation humaine')

  const chaîne = await verifyChain(db, org.id, SECRET)
  vérifier(chaîne.valid, `la chaîne d’audit reste intègre (${chaîne.eventsChecked} événements)`)

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
