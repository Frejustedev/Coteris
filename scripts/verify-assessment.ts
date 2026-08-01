/**
 * Vérification de la préparation d'épreuve, contre la base réelle.
 *
 *   pnpm verify:assessment
 *
 * Le scénario suit le chemin d'un enseignant : créer, ajouter des questions,
 * échouer à verrouiller un barème incohérent, corriger, verrouiller, puis se voir
 * refuser toute modification.
 *
 * Prérequis : `pnpm db:migrate && pnpm db:seed`.
 */

import { sql } from 'drizzle-orm'

import { verifyChain } from '@coteris/audit'
import type { Principal } from '@coteris/auth'

import { db } from '../apps/web/src/lib/db'
import {
  ajouterQuestion,
  créerÉpreuve,
  verrouillerBarème,
} from '../apps/web/src/lib/services/assessment'

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

async function main(): Promise<void> {
  if (SECRET.length < 32) throw new Error('AUDIT_HASH_SECRET est requis.')

  console.log("\nVérification de la préparation d'épreuve\n")

  const user = await une<{ id: string }>(
    sql`SELECT id FROM "user" WHERE email = 'coordinateur@demo.coteris.local'`,
  )
  if (!user) throw new Error('Données de démonstration absentes. Exécutez « pnpm db:seed ».')

  /*
   * Organisation dédiée à cette vérification.
   *
   * Écrire dans l'organisation de démonstration la polluerait : les épreuves
   * créées ici n'ont pas de copies, et le test de fumée finirait par tomber sur
   * l'une d'elles. Une vérification ne doit pas dégrader le jeu qu'elle partage.
   */
  const org = await une<{ id: string }>(sql`
    INSERT INTO organization (name, slug)
    VALUES ('Vérification — préparation', ${'verif-prep-' + Date.now().toString(36)})
    RETURNING id
  `)
  if (!org) throw new Error('Impossible de créer l’organisation de vérification.')

  await db.execute(sql`
    INSERT INTO member (organization_id, user_id, role)
    VALUES (${org.id}::uuid, ${user.id}::uuid, 'coordinator')
  `)

  const coordinateur: Principal = { userId: user.id, organizationId: org.id, roles: ['coordinator'] }
  const correcteur: Principal = { ...coordinateur, roles: ['grader'] }

  const commun = { now: new Date(), auditSecret: SECRET }

  // --- Permissions -----------------------------------------------------------------
  console.log('Permissions')

  const refus = await créerÉpreuve(correcteur, user.id, {
    title: 'Tentative',
    subject: null,
    level: null,
    cohort: null,
    language: 'fr',
    maxPoints: 1000,
    durationMinutes: null,
    anonymizationEnabled: true,
    description: null,
    ...commun,
  })
  vérifier(!refus.ok, 'un correcteur ne crée pas d’épreuve', refus.message)

  // --- Création --------------------------------------------------------------------
  console.log('\nCréation')

  const titreCourt = await créerÉpreuve(coordinateur, user.id, {
    title: 'ab',
    subject: null,
    level: null,
    cohort: null,
    language: 'fr',
    maxPoints: 1000,
    durationMinutes: null,
    anonymizationEnabled: true,
    description: null,
    ...commun,
  })
  vérifier(!titreCourt.ok, 'un titre trop court est refusé', titreCourt.message)

  const créée = await créerÉpreuve(coordinateur, user.id, {
    title: `Épreuve de vérification ${Date.now()}`,
    subject: 'Médecine nucléaire',
    level: 'Troisième cycle',
    cohort: 'DES',
    language: 'fr',
    maxPoints: 2000,
    durationMinutes: 30,
    anonymizationEnabled: true,
    description: null,
    ...commun,
  })
  vérifier(créée.ok, 'l’épreuve est créée', créée.message)
  const id = String(créée.id)

  const [état] = (await db.execute(
    sql`SELECT status FROM assessments WHERE id = ${id}::uuid`,
  )) as unknown as { status: string }[]
  vérifier(état?.status === 'DRAFT', 'elle commence à l’état brouillon')

  const clés = Number(
    (
      await une<{ n: string }>(
        sql`SELECT count(*) AS n FROM answer_keys WHERE assessment_id = ${id}::uuid`,
      )
    )?.n ?? 0,
  )
  const barèmes = Number(
    (
      await une<{ n: string }>(
        sql`SELECT count(*) AS n FROM rubrics WHERE assessment_id = ${id}::uuid`,
      )
    )?.n ?? 0,
  )
  vérifier(clés === 1 && barèmes === 1, 'le corrigé et le barème existent dès la création')

  // --- Questions --------------------------------------------------------------------
  console.log('\nQuestions et critères')

  const sansCritère = await ajouterQuestion(coordinateur, user.id, {
    assessmentId: id,
    number: '1',
    prompt: 'Une question sans critère',
    type: 'short_answer',
    maxPoints: 1000,
    answerKey: 'Un corrigé',
    critères: [],
    ...commun,
  })
  vérifier(
    !sansCritère.ok,
    'une question sans critère est refusée : elle ne serait jamais corrigeable',
    sansCritère.message,
  )

  const incohérente = await ajouterQuestion(coordinateur, user.id, {
    assessmentId: id,
    number: '1',
    prompt: 'Une question incohérente',
    type: 'short_answer',
    maxPoints: 1000,
    answerKey: 'Un corrigé',
    critères: [{ label: 'Critère', maxPoints: 500, acceptableAnswers: [] }],
    ...commun,
  })
  vérifier(
    !incohérente.ok,
    'des critères qui ne font pas le barème de la question sont refusés',
    incohérente.message,
  )

  const q1 = await ajouterQuestion(coordinateur, user.id, {
    assessmentId: id,
    number: '1',
    prompt: 'Pourquoi administre-t-on de l’iode stable avant une MIBG ?',
    type: 'short_answer',
    maxPoints: 1000,
    answerKey: 'Pour bloquer la thyroïde et réduire la captation.',
    critères: [
      { label: 'Blocage de la thyroïde', maxPoints: 500, acceptableAnswers: ['bloquer la thyroïde'] },
      { label: 'Réduction de la captation', maxPoints: 500, acceptableAnswers: ['réduire la captation'] },
    ],
    ...commun,
  })
  vérifier(q1.ok, 'une question cohérente est acceptée', q1.message)

  // --- Verrouillage refusé -------------------------------------------------------------
  console.log('\nVerrouillage refusé tant que le barème est incohérent')

  const partiel = await verrouillerBarème(coordinateur, user.id, { assessmentId: id, ...commun })
  vérifier(
    !partiel.ok,
    'le verrouillage est refusé quand le total des questions ne fait pas la note maximale',
    partiel.problèmes?.join(' · '),
  )
  vérifier(
    (partiel.problèmes ?? []).length > 0,
    'les problèmes sont énumérés, pas résumés en une phrase',
  )

  const refusCorrecteur = await verrouillerBarème(correcteur, user.id, {
    assessmentId: id,
    ...commun,
  })
  vérifier(!refusCorrecteur.ok, 'un correcteur ne verrouille pas un barème', refusCorrecteur.message)

  // --- Verrouillage réussi ---------------------------------------------------------------
  console.log('\nVerrouillage')

  const q2 = await ajouterQuestion(coordinateur, user.id, {
    assessmentId: id,
    number: '2',
    prompt: 'Citez deux indications de la scintigraphie osseuse.',
    type: 'short_answer',
    maxPoints: 1000,
    answerKey: 'Métastases osseuses, fracture de fatigue.',
    critères: [
      { label: 'Première indication', maxPoints: 500, acceptableAnswers: ['métastases osseuses'] },
      { label: 'Seconde indication', maxPoints: 500, acceptableAnswers: ['fracture de fatigue'] },
    ],
    ...commun,
  })
  vérifier(q2.ok, 'la seconde question est ajoutée', q2.message)

  const auditAvant = Number(
    (
      await une<{ n: string }>(
        sql`SELECT count(*) AS n FROM audit_events WHERE organization_id = ${org.id}::uuid`,
      )
    )?.n ?? 0,
  )

  const verrouillé = await verrouillerBarème(coordinateur, user.id, { assessmentId: id, ...commun })
  vérifier(verrouillé.ok, 'le barème cohérent est verrouillé', verrouillé.message)

  const version = await une<{ locked_at: string | null; locked_by: string | null; content_hash: string }>(sql`
    SELECT rv.locked_at, rv.locked_by, rv.content_hash
    FROM rubrics r JOIN rubric_versions rv ON rv.rubric_id = r.id
    WHERE r.assessment_id = ${id}::uuid
  `)
  vérifier(version?.locked_at !== null, 'la version du barème porte sa date de verrouillage')
  vérifier(version?.locked_by !== null, 'elle porte son signataire')
  vérifier(
    (version?.content_hash ?? '').length === 64,
    'elle porte une empreinte de contenu',
    version?.content_hash,
  )

  const sujet = await une<{ locked_at: string | null; content_hash: string }>(
    sql`SELECT locked_at, content_hash FROM assessment_versions WHERE assessment_id = ${id}::uuid`,
  )
  vérifier(sujet?.locked_at !== null, 'la version du sujet est figée')

  const rattachées = Number(
    (
      await une<{ n: string }>(sql`
        SELECT count(*) AS n FROM questions
        WHERE assessment_id = ${id}::uuid AND assessment_version_id IS NOT NULL
      `)
    )?.n ?? 0,
  )
  vérifier(rattachées === 2, 'les questions sont rattachées à la version figée du sujet')

  const nouvelÉtat = await une<{ status: string }>(
    sql`SELECT status FROM assessments WHERE id = ${id}::uuid`,
  )
  vérifier(
    nouvelÉtat?.status === 'READY_FOR_SUBMISSIONS',
    'l’épreuve accepte désormais les copies',
    nouvelÉtat?.status,
  )

  const auditAprès = Number(
    (
      await une<{ n: string }>(
        sql`SELECT count(*) AS n FROM audit_events WHERE organization_id = ${org.id}::uuid`,
      )
    )?.n ?? 0,
  )
  vérifier(
    auditAprès === auditAvant + 2,
    'la validation du corrigé et le verrouillage du barème sont journalisés',
    `avant ${auditAvant}, après ${auditAprès}`,
  )

  // --- Après verrouillage ----------------------------------------------------------------
  console.log('\nAprès verrouillage')

  const aprèsVerrou = await ajouterQuestion(coordinateur, user.id, {
    assessmentId: id,
    number: '3',
    prompt: 'Une question ajoutée après coup',
    type: 'short_answer',
    maxPoints: 1000,
    answerKey: 'x',
    critères: [{ label: 'c', maxPoints: 1000, acceptableAnswers: [] }],
    ...commun,
  })
  vérifier(
    !aprèsVerrou.ok,
    'aucune modification directe n’est possible après verrouillage',
    aprèsVerrou.message,
  )

  const doubleVerrou = await verrouillerBarème(coordinateur, user.id, { assessmentId: id, ...commun })
  vérifier(!doubleVerrou.ok, 'un second verrouillage est refusé', doubleVerrou.message)

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
