/**
 * Vérification de la correction manuelle des zones, contre la base réelle.
 *
 *   pnpm verify:segmentation
 *
 * Prérequis : `pnpm db:migrate && pnpm db:seed`.
 */

import { sql } from 'drizzle-orm'

import { verifyChain } from '@coteris/audit'
import type { Principal } from '@coteris/auth'

import { db } from '../apps/web/src/lib/db'
import { corrigerZones } from '../apps/web/src/lib/services/segmentation'

const SECRET = process.env['AUDIT_HASH_SECRET'] ?? ''
let échecs = 0

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

async function compter(requête: ReturnType<typeof sql>): Promise<number> {
  return Number((await une<{ n: string }>(requête))?.n ?? 0)
}

async function main(): Promise<void> {
  if (SECRET.length < 32) throw new Error('AUDIT_HASH_SECRET est requis.')

  console.log('\nVérification de la correction des zones\n')

  const org = await une<{ id: string }>(
    sql`SELECT id FROM organization WHERE slug = 'faculte-demo'`,
  )
  const user = await une<{ id: string }>(
    sql`SELECT id FROM "user" WHERE email = 'correcteur1@demo.coteris.local'`,
  )
  if (!org || !user) throw new Error('Données de démonstration absentes.')

  const correcteur: Principal = { userId: user.id, organizationId: org.id, roles: ['grader'] }
  const adminTechnique: Principal = { ...correcteur, roles: ['tech_admin'] }
  const commun = { now: new Date(), auditSecret: SECRET }

  // Une copie non finalisée, avec ses zones.
  const copie = await une<{ id: string }>(sql`
    SELECT s.id FROM submissions s
    JOIN grades g ON g.submission_id = s.id AND g.question_id IS NULL
    WHERE g.finalized_at IS NULL
      AND EXISTS (SELECT 1 FROM answer_regions ar WHERE ar.submission_id = s.id)
    LIMIT 1
  `)
  if (!copie) throw new Error('Aucune copie non finalisée avec des zones.')

  const zones = (await db.execute(sql`
    SELECT id, x, y, width, height FROM answer_regions
    WHERE submission_id = ${copie.id}::uuid ORDER BY sort_order
  `)) as unknown as { id: string; x: number; y: number; width: number; height: number }[]

  vérifier(zones.length > 0, `la copie a ${zones.length} zone(s)`)
  const première = zones[0]!

  // --- Permissions ------------------------------------------------------------------
  console.log('Permissions')

  const refusAdmin = await corrigerZones(adminTechnique, user.id, {
    submissionId: copie.id,
    zones: [{ answerRegionId: première.id, x: 0.1, y: 0.1, width: 0.5, height: 0.2 }],
    ...commun,
  })
  vérifier(
    !refusAdmin.ok,
    'un administrateur technique ne corrige pas la segmentation',
    refusAdmin.message,
  )

  // --- Géométrie ----------------------------------------------------------------------
  console.log('\nGéométrie')

  const minuscule = await corrigerZones(correcteur, user.id, {
    submissionId: copie.id,
    zones: [{ answerRegionId: première.id, x: 0.1, y: 0.1, width: 0.001, height: 0.001 }],
    ...commun,
  })
  vérifier(
    !minuscule.ok,
    'une zone réduite à un trait est refusée : elle donnerait une transcription vide',
    minuscule.problèmes?.join(' · '),
  )

  const débordement = await corrigerZones(correcteur, user.id, {
    submissionId: copie.id,
    zones: [{ answerRegionId: première.id, x: 0.8, y: 0.8, width: 0.5, height: 0.5 }],
    ...commun,
  })
  vérifier(!débordement.ok, 'une zone qui déborde de la page est refusée', débordement.problèmes?.join(' · '))

  const autreCopie = await une<{ id: string }>(sql`
    SELECT id FROM answer_regions WHERE submission_id <> ${copie.id}::uuid LIMIT 1
  `)
  if (autreCopie) {
    const étrangère = await corrigerZones(correcteur, user.id, {
      submissionId: copie.id,
      zones: [{ answerRegionId: autreCopie.id, x: 0.1, y: 0.1, width: 0.5, height: 0.2 }],
      ...commun,
    })
    vérifier(
      !étrangère.ok,
      'une zone appartenant à une autre copie est introuvable',
      étrangère.message,
    )
  }

  // --- Confirmation sans déplacement ------------------------------------------------------
  console.log('\nConfirmation sans déplacement')

  const jobsAvantConfirmation = await compter(
    sql`SELECT count(*) AS n FROM graphile_worker._private_jobs`,
  )

  const confirmation = await corrigerZones(correcteur, user.id, {
    submissionId: copie.id,
    zones: zones.map((z) => ({
      answerRegionId: z.id,
      x: z.x,
      y: z.y,
      width: z.width,
      height: z.height,
    })),
    ...commun,
  })
  vérifier(confirmation.ok, 'confirmer les zones sans les bouger est accepté', confirmation.message)
  vérifier(
    confirmation.relancées === 0,
    'aucune analyse n’est relancée : relancer coûterait des appels d’IA pour rien',
  )

  const jobsAprèsConfirmation = await compter(
    sql`SELECT count(*) AS n FROM graphile_worker._private_jobs`,
  )
  vérifier(
    jobsAprèsConfirmation === jobsAvantConfirmation,
    'la file n’a effectivement pas bougé',
    `avant ${jobsAvantConfirmation}, après ${jobsAprèsConfirmation}`,
  )

  const aprèsConfirmation = await une<{ origin: string; confidence: number }>(
    sql`SELECT origin, confidence FROM answer_regions WHERE id = ${première.id}::uuid`,
  )
  vérifier(
    aprèsConfirmation?.origin === 'manual',
    'la zone n’est plus une hypothèse : son origine devient manuelle',
  )
  vérifier(Number(aprèsConfirmation?.confidence) === 1, 'sa confiance passe à 1')

  const qualité = await une<{ quality: string }>(
    sql`SELECT quality FROM submissions WHERE id = ${copie.id}::uuid`,
  )
  vérifier(
    qualité?.quality === 'acceptable',
    'la copie n’est plus classée « vérification recommandée »',
    qualité?.quality,
  )

  // --- Déplacement réel --------------------------------------------------------------------
  console.log('\nDéplacement réel')

  const auditAvant = await compter(
    sql`SELECT count(*) AS n FROM audit_events WHERE organization_id = ${org.id}::uuid`,
  )
  const jobsAvant = await compter(sql`SELECT count(*) AS n FROM graphile_worker._private_jobs`)

  const déplacement = await corrigerZones(correcteur, user.id, {
    submissionId: copie.id,
    zones: zones.map((z, i) => ({
      answerRegionId: z.id,
      // On ne déplace que la première : les autres doivent rester tranquilles.
      x: i === 0 ? 0.05 : z.x,
      y: i === 0 ? 0.05 : z.y,
      width: i === 0 ? 0.9 : z.width,
      height: i === 0 ? 0.1 : z.height,
    })),
    ...commun,
  })
  vérifier(déplacement.ok, 'le déplacement est enregistré', déplacement.message)
  vérifier(
    déplacement.relancées === 1,
    'seule la zone déplacée voit son analyse relancée',
    `relancées : ${déplacement.relancées}`,
  )

  const jobsAprès = await compter(sql`SELECT count(*) AS n FROM graphile_worker._private_jobs`)
  vérifier(
    jobsAprès === jobsAvant + 1,
    'exactement un job a été mis en file',
    `avant ${jobsAvant}, après ${jobsAprès}`,
  )

  const coordonnées = await une<{ x: number; width: number }>(
    sql`SELECT x, width FROM answer_regions WHERE id = ${première.id}::uuid`,
  )
  vérifier(
    Math.abs(Number(coordonnées?.x) - 0.05) < 0.001 &&
      Math.abs(Number(coordonnées?.width) - 0.9) < 0.001,
    'les nouvelles coordonnées sont enregistrées',
  )

  const auditAprès = await compter(
    sql`SELECT count(*) AS n FROM audit_events WHERE organization_id = ${org.id}::uuid`,
  )
  vérifier(
    auditAprès === auditAvant + 1,
    'la correction produit un événement d’audit',
    `avant ${auditAvant}, après ${auditAprès}`,
  )

  const événement = await une<{ previous_value: unknown; new_value: unknown }>(sql`
    SELECT previous_value, new_value FROM audit_events
    WHERE organization_id = ${org.id}::uuid ORDER BY sequence DESC LIMIT 1
  `)
  vérifier(
    JSON.stringify(événement?.previous_value ?? '').includes('"x"'),
    'l’événement conserve les coordonnées précédentes',
  )

  // --- Copie finalisée -----------------------------------------------------------------------
  console.log('\nCopie finalisée')

  const finalisée = await une<{ id: string }>(sql`
    SELECT s.id FROM submissions s
    JOIN grades g ON g.submission_id = s.id AND g.question_id IS NULL
    WHERE g.finalized_at IS NOT NULL
      AND EXISTS (SELECT 1 FROM answer_regions ar WHERE ar.submission_id = s.id)
    LIMIT 1
  `)

  if (finalisée) {
    const zoneFinalisée = await une<{ id: string }>(
      sql`SELECT id FROM answer_regions WHERE submission_id = ${finalisée.id}::uuid LIMIT 1`,
    )
    const refus = await corrigerZones(correcteur, user.id, {
      submissionId: finalisée.id,
      zones: [{ answerRegionId: String(zoneFinalisée?.id), x: 0.1, y: 0.1, width: 0.5, height: 0.2 }],
      ...commun,
    })
    vérifier(
      !refus.ok,
      'une copie finalisée ne se resegmente pas discrètement',
      refus.message,
    )
  } else {
    console.log('  (aucune copie finalisée dans le jeu — cas non exercé)')
  }

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
