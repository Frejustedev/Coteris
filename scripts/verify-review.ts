/**
 * Vérification de la validation humaine, contre la base réelle.
 *
 * Ce que le test de fumée HTTP ne peut pas atteindre : les actions serveur ne
 * s'appellent qu'à travers le protocole de Next.js. On teste donc le service
 * directement — c'est lui qui décide si une note peut changer et qui écrit
 * l'audit.
 *
 *   pnpm verify:review
 *
 * Prérequis : `pnpm db:migrate && pnpm db:seed`.
 */

import { sql } from 'drizzle-orm'

import { verifyChain } from '@coteris/audit'
import type { Principal } from '@coteris/auth'

import { db } from '../apps/web/src/lib/db'
import { appliquerDécision, validerQuestionEnLot } from '../apps/web/src/lib/services/review'

const SECRET = process.env['AUDIT_HASH_SECRET'] ?? ''
let échecs = 0

function vérifier(condition: boolean, message: string, détail?: string): void {
  if (condition) {
    console.log(`  [32mOK[0m    ${message}`)
  } else {
    échecs += 1
    console.error(`  [31mÉCHEC[0m ${message}`)
    if (détail) console.error(`        ${détail}`)
  }
}

async function une<T>(requête: ReturnType<typeof sql>): Promise<T | undefined> {
  const lignes = (await db.execute(requête)) as unknown as T[]
  return lignes[0]
}

async function main(): Promise<void> {
  if (SECRET.length < 32) {
    throw new Error('AUDIT_HASH_SECRET est requis pour vérifier la chaîne d’audit.')
  }

  console.log('\nVérification de la validation humaine\n')

  const org = await une<{ id: string }>(
    sql`SELECT id FROM organization WHERE slug = 'faculte-demo'`,
  )
  const coordinateur = await une<{ id: string }>(
    sql`SELECT id FROM "user" WHERE email = 'coordinateur@demo.coteris.local'`,
  )
  if (!org || !coordinateur) {
    throw new Error('Données de démonstration absentes. Exécutez « pnpm db:seed ».')
  }

  const principal: Principal = {
    userId: coordinateur.id,
    organizationId: org.id,
    roles: ['coordinator'],
  }
  const correcteurSeul: Principal = { ...principal, roles: ['grader'] }
  const adminTechnique: Principal = { ...principal, roles: ['tech_admin'] }

  // --- Une décision en attente, sur une copie non finalisée -------------------
  const cible = await une<{
    id: string
    submission_id: string
    question_id: string
    points_possible: number
    points_proposed: number
  }>(sql`
    SELECT d.id, d.submission_id, d.question_id, d.points_possible, d.points_proposed
    FROM grading_decisions d
    JOIN grades g ON g.submission_id = d.submission_id AND g.question_id IS NULL
    WHERE d.points_awarded IS NULL
      AND g.finalized_at IS NULL
      AND d.points_possible > 0
    ORDER BY d.id
    LIMIT 1
  `)

  if (!cible) throw new Error('Aucune décision en attente sur une copie non finalisée.')

  const auditAvant = await une<{ n: string }>(
    sql`SELECT count(*) AS n FROM audit_events WHERE organization_id = ${org.id}::uuid`,
  )

  // --- Permissions -----------------------------------------------------------
  console.log('Permissions')

  const refusAdmin = await appliquerDécision(adminTechnique, coordinateur.id, {
    decisionId: cible.id,
    points: cible.points_proposed,
    now: new Date(),
    auditSecret: SECRET,
  })
  vérifier(
    !refusAdmin.ok,
    'un administrateur technique ne peut pas valider une correction',
    refusAdmin.message,
  )

  // --- Motif obligatoire ------------------------------------------------------
  console.log('\nMotif obligatoire')

  const autresPoints = cible.points_proposed === 0 ? cible.points_possible : 0
  const sansMotif = await appliquerDécision(principal, coordinateur.id, {
    decisionId: cible.id,
    points: autresPoints,
    now: new Date(),
    auditSecret: SECRET,
  })
  vérifier(
    !sansMotif.ok && (sansMotif.message ?? '').includes('motif'),
    's’écarter de la proposition sans motif est refusé',
    sansMotif.message,
  )

  const horsBarème = await appliquerDécision(principal, coordinateur.id, {
    decisionId: cible.id,
    points: cible.points_possible + 1000,
    reason: 'tentative de dépassement',
    now: new Date(),
    auditSecret: SECRET,
  })
  vérifier(!horsBarème.ok, 'un critère ne peut pas dépasser sa valeur', horsBarème.message)

  // --- Modification acceptée ---------------------------------------------------
  console.log('\nModification par un correcteur habilité')

  const modification = await appliquerDécision(correcteurSeul, coordinateur.id, {
    decisionId: cible.id,
    points: autresPoints,
    reason: 'Formulation équivalente acceptée après relecture',
    now: new Date(),
    auditSecret: SECRET,
  })
  vérifier(modification.ok, 'la modification est enregistrée', modification.message)

  const après = await une<{ points_awarded: number; reviewed_by: string | null }>(
    sql`SELECT points_awarded, reviewed_by FROM grading_decisions WHERE id = ${cible.id}::uuid`,
  )
  vérifier(
    Number(après?.points_awarded) === autresPoints,
    'les points attribués sont enregistrés',
    `attendu ${autresPoints}, obtenu ${après?.points_awarded}`,
  )
  vérifier(après?.reviewed_by !== null, 'le validateur est enregistré')

  const revue = await une<{ decision: string; points_before: number; reason: string | null }>(
    sql`SELECT decision, points_before, reason FROM human_reviews
        WHERE grading_decision_id = ${cible.id}::uuid ORDER BY created_at DESC LIMIT 1`,
  )
  vérifier(revue?.decision === 'modified', 'la revue est tracée comme une modification')
  vérifier(
    Number(revue?.points_before) === cible.points_proposed,
    'la valeur précédente est conservée',
    `attendu ${cible.points_proposed}, obtenu ${revue?.points_before}`,
  )
  vérifier(Boolean(revue?.reason), 'le motif est conservé')

  // --- Audit --------------------------------------------------------------------
  console.log('\nAudit')

  const auditAprès = await une<{ n: string }>(
    sql`SELECT count(*) AS n FROM audit_events WHERE organization_id = ${org.id}::uuid`,
  )
  vérifier(
    Number(auditAprès?.n) === Number(auditAvant?.n) + 1,
    'exactement un événement d’audit a été ajouté',
    `avant ${auditAvant?.n}, après ${auditAprès?.n}`,
  )

  const dernier = await une<{ action: string; previous_value: unknown; new_value: unknown }>(
    sql`SELECT action, previous_value, new_value FROM audit_events
        WHERE organization_id = ${org.id}::uuid ORDER BY sequence DESC LIMIT 1`,
  )
  vérifier(dernier?.action === 'grade.modify', 'l’événement est une modification de note')
  vérifier(
    JSON.stringify(dernier?.new_value ?? {}).includes(String(autresPoints)),
    'l’événement porte la nouvelle valeur',
  )

  const chaîne = await verifyChain(db, org.id, SECRET)
  vérifier(
    chaîne.valid,
    `la chaîne d’audit reste intègre après écriture (${chaîne.eventsChecked} événements)`,
    chaîne.breaks.map((b) => b.detail).join(' · '),
  )

  // --- Recalcul de la note --------------------------------------------------------
  console.log('\nRecalcul de la note')

  const note = await une<{ points_exact: number }>(
    sql`SELECT points_exact FROM grades
        WHERE submission_id = ${cible.submission_id}::uuid AND question_id IS NULL`,
  )
  const somme = await une<{ total: string }>(sql`
    SELECT SUM(COALESCE(points_awarded, points_proposed)) AS total
    FROM grading_decisions WHERE submission_id = ${cible.submission_id}::uuid
  `)
  vérifier(
    Number(note?.points_exact) === Number(somme?.total),
    'la note de la copie reflète les points attribués',
    `note ${note?.points_exact}, somme ${somme?.total}`,
  )

  // --- Validation groupée ----------------------------------------------------------
  console.log('\nValidation groupée')

  const nonVert = await une<{ submission_id: string; question_id: string }>(sql`
    SELECT r.submission_id, r.question_id FROM grading_runs r
    WHERE r.confidence_level <> 'green' LIMIT 1
  `)
  if (nonVert) {
    const refus = await validerQuestionEnLot(principal, coordinateur.id, {
      submissionId: nonVert.submission_id,
      questionId: nonVert.question_id,
      now: new Date(),
      auditSecret: SECRET,
    })
    vérifier(
      !refus.ok,
      'la validation groupée est refusée hors des cas à confiance élevée',
      refus.message,
    )
  }

  console.log('')
  if (échecs === 0) {
    console.log('[32mToutes les vérifications passent.[0m\n')
  } else {
    console.error(`[31m${échecs} vérification(s) en échec.[0m\n`)
    process.exitCode = 1
  }
}

main()
  .catch((error: unknown) => {
    console.error('\nÉchec de la vérification :', error)
    process.exitCode = 1
  })
  .finally(() => {
    process.exit(process.exitCode ?? 0)
  })
