/**
 * Chargement des données de démonstration.
 *
 * Ce script ne se contente pas d'insérer des lignes : il fait **réellement
 * tourner le pipeline de correction** sur des copies simulées. Les propositions
 * de points, les preuves, les niveaux de confiance et les événements d'audit
 * qu'il produit sont donc de vraies sorties du moteur, pas des valeurs écrites à
 * la main.
 *
 * C'est délibéré. Un jeu de démonstration fabriqué à la main donnerait une image
 * flatteuse et fausse ; celui-ci échouerait si la chaîne était cassée.
 *
 * Aucune donnée personnelle réelle. Voir `fixtures.ts`.
 */

import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import {
  answerKeyElements,
  answerKeyVersions,
  answerKeys,
  answerRegions,
  assessmentVersions,
  assessments,
  gradingDecisions,
  gradingEvidence,
  gradingRuns,
  grades,
  humanReviews,
  members,
  organizations,
  ocrRuns,
  ocrSpans,
  questions,
  rubricCriteria,
  rubricVersions,
  rubrics,
  students,
  submissionIdentities,
  submissionPages,
  submissions,
  transcriptionVersions,
  users,
  AUDIT_ACTIONS,
} from '@coteris/database'
import { appendAuditEvent, type AuditTransaction } from '@coteris/audit'
import { createMockOcrProvider, createMockTextAnalysisProvider } from '@coteris/ai'
import { gradeAnswer } from '@coteris/pipeline'
import type { Millipoints } from '@coteris/shared'
import type { QuestionGradingRules, RubricCriterion } from '@coteris/grading'

import { ASSESSMENT, ORGANIZATION, QUESTIONS, STUDENTS, SUBMISSIONS, USERS } from './fixtures'

const AUDIT_SECRET =
  process.env['AUDIT_HASH_SECRET'] ?? 'secret-de-demonstration-au-moins-32-caracteres'

const hash = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex')

/** Horodatages fixes : le seed doit être reproductible. */
const T0 = new Date('2026-06-15T08:00:00.000Z')
const at = (minutes: number): Date => new Date(T0.getTime() + minutes * 60_000)

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL']
  if (!url) throw new Error('DATABASE_URL est requis.')
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('Le chargement des données de démonstration est refusé en production.')
  }

  const client = postgres(url, { max: 1, onnotice: () => {} })
  const db = drizzle(client)

  try {
    console.log('Chargement des données de démonstration…\n')

    const orgId = await seedOrganization(db)
    const userIds = await seedUsers(db, orgId)
    const studentIds = await seedStudents(db, orgId)
    const { assessmentId, questionIds } = await seedAssessment(db, orgId, userIds.coordinateur)
    const { answerKeyVersionId } = await seedAnswerKey(
      db,
      orgId,
      assessmentId,
      questionIds,
      userIds.coordinateur,
    )
    const { rubricVersionId, criteriaByKey } = await seedRubric(
      db,
      orgId,
      assessmentId,
      answerKeyVersionId,
      questionIds,
      userIds.coordinateur,
    )
    await seedSubmissions(db, {
      orgId,
      assessmentId,
      questionIds,
      studentIds,
      rubricVersionId,
      answerKeyVersionId,
      criteriaByKey,
      coordinatorId: userIds.coordinateur,
      graderId: userIds.correcteur1,
    })

    await report(db, orgId)
  } finally {
    await client.end()
  }
}

type Db = ReturnType<typeof drizzle>

async function audit(db: Db, input: Parameters<typeof appendAuditEvent>[1]): Promise<void> {
  await db.transaction(async (tx: unknown) => {
    await appendAuditEvent(tx as AuditTransaction, input, AUDIT_SECRET)
  })
}

// --- Organisation, comptes, étudiants ---------------------------------------

async function seedOrganization(db: Db): Promise<string> {
  const [org] = await db
    .insert(organizations)
    .values({ name: ORGANIZATION.name, slug: ORGANIZATION.slug, isPersonal: false })
    .returning()

  const id = String(org?.id)
  console.log(`  Organisation « ${ORGANIZATION.name} »`)
  return id
}

/** Identifiants des comptes de démonstration, nommés plutôt qu'indexés. */
interface SeededUsers {
  readonly coordinateur: string
  readonly correcteur1: string
  readonly correcteur2: string
}

async function seedUsers(db: Db, orgId: string): Promise<SeededUsers> {
  const ids: Record<string, string> = {}

  for (const u of USERS) {
    const [user] = await db
      .insert(users)
      .values({ name: u.name, email: u.email, emailVerified: true })
      .returning()

    const userId = String(user?.id)
    ids[u.key] = userId

    await db.insert(members).values({ organizationId: orgId, userId, role: u.role })

    await audit(db, {
      organizationId: orgId,
      action: AUDIT_ACTIONS.PERMISSION_CHANGE,
      objectType: 'member',
      objectId: userId,
      actorRole: 'coordinator',
      newValue: { role: u.role },
      reason: 'Création du compte de démonstration',
      occurredAt: at(0),
    })
  }

  console.log(`  ${USERS.length} comptes (1 coordonnateur, 2 correcteurs)`)

  const requis = ['coordinateur', 'correcteur1', 'correcteur2'] as const
  for (const clé of requis) {
    if (!ids[clé]) throw new Error(`Le compte de démonstration « ${clé} » n'a pas été créé.`)
  }

  return {
    coordinateur: ids['coordinateur'] as string,
    correcteur1: ids['correcteur1'] as string,
    correcteur2: ids['correcteur2'] as string,
  }
}

async function seedStudents(db: Db, orgId: string): Promise<string[]> {
  const ids: string[] = []
  for (const s of STUDENTS) {
    const [row] = await db
      .insert(students)
      .values({ organizationId: orgId, ...s })
      .returning()
    ids.push(String(row?.id))
  }
  console.log(`  ${STUDENTS.length} étudiants fictifs`)
  return ids
}

// --- Épreuve ------------------------------------------------------------------

async function seedAssessment(
  db: Db,
  orgId: string,
  coordinatorId: string,
): Promise<{ assessmentId: string; questionIds: Record<string, string> }> {
  const [assessment] = await db
    .insert(assessments)
    .values({
      organizationId: orgId,
      ...ASSESSMENT,
      examDate: at(0),
      anonymizationEnabled: true,
      status: 'GRADING',
      createdBy: coordinatorId,
    })
    .returning()

  const assessmentId = String(assessment?.id)

  await audit(db, {
    organizationId: orgId,
    actorId: coordinatorId,
    actorRole: 'coordinator',
    action: AUDIT_ACTIONS.ASSESSMENT_CREATE,
    objectType: 'assessment',
    objectId: assessmentId,
    newValue: { title: ASSESSMENT.title },
    occurredAt: at(1),
  })

  const sujet = QUESTIONS.map((q) => `${q.number}. ${q.prompt}`).join('\n')
  const [version] = await db
    .insert(assessmentVersions)
    .values({
      organizationId: orgId,
      assessmentId,
      versionNumber: 1,
      extractedText: sujet,
      contentHash: hash(sujet),
      lockedAt: at(5),
      lockedBy: coordinatorId,
    })
    .returning()

  await audit(db, {
    organizationId: orgId,
    actorId: coordinatorId,
    actorRole: 'coordinator',
    action: AUDIT_ACTIONS.SUBJECT_IMPORT,
    objectType: 'assessment_version',
    objectId: String(version?.id),
    newValue: { versionNumber: 1, contentHash: hash(sujet) },
    occurredAt: at(5),
  })

  const questionIds: Record<string, string> = {}
  for (const [index, q] of QUESTIONS.entries()) {
    const [row] = await db
      .insert(questions)
      .values({
        organizationId: orgId,
        assessmentId,
        assessmentVersionId: String(version?.id),
        number: q.number,
        prompt: q.prompt,
        type: q.type,
        maxPoints: q.maxPoints,
        sortOrder: index + 1,
      })
      .returning()
    questionIds[q.number] = String(row?.id)
  }

  console.log(`  Épreuve « ${ASSESSMENT.title} », ${QUESTIONS.length} questions`)
  return { assessmentId, questionIds }
}

// --- Corrigé ------------------------------------------------------------------

async function seedAnswerKey(
  db: Db,
  orgId: string,
  assessmentId: string,
  questionIds: Record<string, string>,
  coordinatorId: string,
): Promise<{ answerKeyVersionId: string }> {
  const [key] = await db
    .insert(answerKeys)
    .values({ organizationId: orgId, assessmentId })
    .returning()

  const texte = QUESTIONS.map((q) => `${q.number}. ${q.answerKey}`).join('\n')
  const [version] = await db
    .insert(answerKeyVersions)
    .values({
      organizationId: orgId,
      answerKeyId: String(key?.id),
      versionNumber: 1,
      rawText: texte,
      contentHash: hash(texte),
      lockedAt: at(10),
      lockedBy: coordinatorId,
    })
    .returning()

  const answerKeyVersionId = String(version?.id)

  for (const q of QUESTIONS) {
    for (const [index, critère] of q.criteria.entries()) {
      await db.insert(answerKeyElements).values({
        organizationId: orgId,
        answerKeyVersionId,
        questionId: questionIds[q.number] as string,
        kind: 'essential',
        content: critère.label,
        synonyms: critère.acceptableAnswers,
        sortOrder: index,
        // Validé par un humain : le pipeline ignore les brouillons.
        validationStatus: 'accepted',
        validatedBy: coordinatorId,
        validatedAt: at(10),
      })
    }
  }

  await audit(db, {
    organizationId: orgId,
    actorId: coordinatorId,
    actorRole: 'coordinator',
    action: AUDIT_ACTIONS.ANSWER_KEY_VALIDATE,
    objectType: 'answer_key_version',
    objectId: answerKeyVersionId,
    newValue: { versionNumber: 1, contentHash: hash(texte) },
    reason: 'Corrigé fourni par l’enseignant et validé',
    occurredAt: at(10),
  })

  console.log('  Corrigé saisi et validé')
  return { answerKeyVersionId }
}

// --- Barème -------------------------------------------------------------------

async function seedRubric(
  db: Db,
  orgId: string,
  assessmentId: string,
  answerKeyVersionId: string,
  questionIds: Record<string, string>,
  coordinatorId: string,
): Promise<{ rubricVersionId: string; criteriaByKey: Map<string, string> }> {
  const [rubric] = await db
    .insert(rubrics)
    .values({ organizationId: orgId, assessmentId })
    .returning()

  const empreinte = hash(JSON.stringify(QUESTIONS.map((q) => q.criteria)))
  const [version] = await db
    .insert(rubricVersions)
    .values({
      organizationId: orgId,
      rubricId: String(rubric?.id),
      answerKeyVersionId,
      versionNumber: 1,
      contentHash: empreinte,
      lockedAt: at(15),
      lockedBy: coordinatorId,
    })
    .returning()

  const rubricVersionId = String(version?.id)
  const criteriaByKey = new Map<string, string>()

  for (const q of QUESTIONS) {
    for (const [index, c] of q.criteria.entries()) {
      const [row] = await db
        .insert(rubricCriteria)
        .values({
          organizationId: orgId,
          rubricVersionId,
          questionId: questionIds[q.number] as string,
          label: c.label,
          attribution: c.attribution,
          maxPoints: c.maxPoints,
          sortOrder: index + 1,
          partialRatioPercent: c.partialRatioPercent ?? 50,
          expectedElementCount: c.expectedElementCount ?? 0,
          acceptableAnswers: c.acceptableAnswers,
          contradictionPolicy: { kind: 'ignore' },
          validationStatus: 'accepted',
          validatedBy: coordinatorId,
          validatedAt: at(15),
        })
        .returning()
      criteriaByKey.set(c.key, String(row?.id))
    }
  }

  await audit(db, {
    organizationId: orgId,
    actorId: coordinatorId,
    actorRole: 'coordinator',
    action: AUDIT_ACTIONS.RUBRIC_LOCK,
    objectType: 'rubric_version',
    objectId: rubricVersionId,
    newValue: { versionNumber: 1, contentHash: empreinte },
    reason: 'Barème validé et verrouillé avant import des copies',
    occurredAt: at(15),
  })

  const total = QUESTIONS.reduce((s, q) => s + q.maxPoints, 0)
  console.log(`  Barème verrouillé — ${criteriaByKey.size} critères, ${total / 1000} points`)
  return { rubricVersionId, criteriaByKey }
}

// --- Copies et correction -----------------------------------------------------

interface SubmissionContext {
  orgId: string
  assessmentId: string
  questionIds: Record<string, string>
  studentIds: string[]
  rubricVersionId: string
  answerKeyVersionId: string
  criteriaByKey: Map<string, string>
  coordinatorId: string
  graderId: string
}

async function seedSubmissions(db: Db, ctx: SubmissionContext): Promise<void> {
  let minute = 20
  let vertes = 0
  let orange = 0
  let rouges = 0

  for (const copie of SUBMISSIONS) {
    minute += 5

    const [submission] = await db
      .insert(submissions)
      .values({
        organizationId: ctx.orgId,
        assessmentId: ctx.assessmentId,
        anonymousCode: copie.anonymousCode,
        status: 'graded',
        quality: (copie.ocrConfidence ?? 1) < 0.5 ? 'check_recommended' : 'acceptable',
        pageCount: 1,
        originalFileName: `${copie.anonymousCode}.pdf`,
        fileHash: hash(copie.anonymousCode),
        idempotencyKey: `seed-${copie.anonymousCode}`,
        uploadedBy: ctx.coordinatorId,
      })
      .returning()

    const submissionId = String(submission?.id)

    // L'identité vit dans une table séparée : le correcteur ne la voit jamais.
    await db.insert(submissionIdentities).values({
      organizationId: ctx.orgId,
      submissionId,
      studentId: ctx.studentIds[copie.studentIndex] as string,
    })

    await audit(db, {
      organizationId: ctx.orgId,
      actorId: ctx.coordinatorId,
      actorRole: 'coordinator',
      action: AUDIT_ACTIONS.SUBMISSION_IMPORT,
      objectType: 'submission',
      objectId: submissionId,
      newValue: { anonymousCode: copie.anonymousCode },
      occurredAt: at(minute),
    })

    const [page] = await db
      .insert(submissionPages)
      .values({
        organizationId: ctx.orgId,
        submissionId,
        pageNumber: 1,
        imageKey: `demo/${copie.anonymousCode}/page-1.png`,
        widthPx: 1240,
        heightPx: 1754,
        dpi: 150,
        quality: 'acceptable',
      })
      .returning()

    let totalCopie = 0
    let maxCopie = 0

    for (const [index, q] of QUESTIONS.entries()) {
      const réponse = copie.answers[q.number] ?? ''
      const questionId = ctx.questionIds[q.number] as string

      const [region] = await db
        .insert(answerRegions)
        .values({
          organizationId: ctx.orgId,
          submissionId,
          submissionPageId: String(page?.id),
          questionId,
          x: 0.08,
          y: 0.08 + index * 0.17,
          width: 0.84,
          height: 0.15,
          croppedImageKey: `demo/${copie.anonymousCode}/q${q.number}.png`,
          origin: 'auto',
          confidence: 0.95,
          sortOrder: index,
        })
        .returning()

      const regionId = String(region?.id)

      const résultat = await corrigerUneRéponse(db, {
        ctx,
        copie,
        question: q,
        questionId,
        submissionId,
        regionId,
        transcription: réponse,
        minute,
      })

      totalCopie += résultat.total
      maxCopie += q.maxPoints

      if (résultat.niveau === 'green') vertes += 1
      else if (résultat.niveau === 'orange') orange += 1
      else rouges += 1
    }

    // Note globale de la copie, finalisée par le coordonnateur.
    await db.insert(grades).values({
      organizationId: ctx.orgId,
      submissionId,
      questionId: null,
      versionNumber: 1,
      pointsExact: totalCopie,
      pointsRounded: totalCopie,
      pointsMax: maxCopie,
      finalizedBy: ctx.coordinatorId,
      finalizedAt: at(minute + 4),
    })

    await audit(db, {
      organizationId: ctx.orgId,
      actorId: ctx.coordinatorId,
      actorRole: 'coordinator',
      action: AUDIT_ACTIONS.GRADE_FINALIZE,
      objectType: 'submission',
      objectId: submissionId,
      newValue: { pointsExact: totalCopie, pointsMax: maxCopie },
      occurredAt: at(minute + 4),
    })

    console.log(
      `  ${copie.anonymousCode} — ${(totalCopie / 1000).toFixed(2)} / ${(maxCopie / 1000).toFixed(0)}` +
        (copie.note ? `  (${copie.note})` : ''),
    )
  }

  console.log(`\n  Décisions : ${vertes} vertes, ${orange} orange, ${rouges} rouges`)
}

interface GradeOneInput {
  ctx: SubmissionContext
  copie: (typeof SUBMISSIONS)[number]
  question: (typeof QUESTIONS)[number]
  questionId: string
  submissionId: string
  regionId: string
  transcription: string
  minute: number
}

/** Exécute réellement OCR puis pipeline, et enregistre tout ce qui en sort. */
async function corrigerUneRéponse(
  db: Db,
  input: GradeOneInput,
): Promise<{ total: number; niveau: string }> {
  const { ctx, copie, question, questionId, submissionId, regionId, transcription, minute } = input

  const ocrProvider = createMockOcrProvider({
    fixtures: { [`demo/${copie.anonymousCode}/q${question.number}.png`]: transcription },
    ...(copie.ocrConfidence === undefined ? {} : { confidence: copie.ocrConfidence }),
    ...(copie.uncertainWords === undefined ? {} : { uncertainWords: copie.uncertainWords }),
  })

  const { result: ocr } = await ocrProvider.transcribe({
    key: `demo/${copie.anonymousCode}/q${question.number}.png`,
    bytes: new Uint8Array([0]),
    mimeType: 'image/png',
    widthPx: 1000,
    heightPx: 200,
  })

  const [ocrRun] = await db
    .insert(ocrRuns)
    .values({
      organizationId: ctx.orgId,
      answerRegionId: regionId,
      provider: 'mock',
      model: 'mock-ocr',
      engineVersion: ocr.engineVersion,
      fullText: ocr.fullText,
      confidence: ocr.confidence,
      durationMs: 12,
    })
    .returning()

  const ocrRunId = String(ocrRun?.id)

  for (const mot of ocr.words) {
    await db.insert(ocrSpans).values({
      organizationId: ctx.orgId,
      ocrRunId,
      level: 'word',
      text: mot.text,
      startOffset: mot.startOffset,
      endOffset: mot.endOffset,
      confidence: mot.confidence,
      alternatives: mot.alternatives,
    })
  }

  const [transcriptionVersion] = await db
    .insert(transcriptionVersions)
    .values({
      organizationId: ctx.orgId,
      answerRegionId: regionId,
      versionNumber: 1,
      text: ocr.fullText,
      source: 'ocr',
      ocrRunId,
      isCurrent: true,
    })
    .returning()

  // --- Barème de la question, tel qu'attendu par le moteur -------------------
  const critères: RubricCriterion[] = question.criteria.map((c, index) => ({
    id: ctx.criteriaByKey.get(c.key) as RubricCriterion['id'],
    questionId: questionId as RubricCriterion['questionId'],
    label: c.label,
    attribution: c.attribution,
    pointsMax: c.maxPoints as Millipoints,
    order: index + 1,
    required: false,
    partialRatioPercent: c.partialRatioPercent ?? 50,
    expectedElementCount: c.expectedElementCount ?? 0,
    pointsPerElement: null,
    cap: null,
    contradictionPolicy: { kind: 'ignore' },
    factualErrorPenalty: null,
    excludedBy: [],
  }))

  const règles: QuestionGradingRules = {
    questionId: questionId as QuestionGradingRules['questionId'],
    pointsMax: question.maxPoints as Millipoints,
    allowNegative: false,
    roundingStep: null,
    missingRequiredPolicy: { kind: 'none' },
    allowBonusOverflow: false,
  }

  const formulations: Record<string, readonly string[]> = {}
  for (const c of question.criteria) {
    formulations[ctx.criteriaByKey.get(c.key) as string] = c.acceptableAnswers
  }

  const analyzer = createMockTextAnalysisProvider(
    copie.unexpectedExcerpts && question.number === '4'
      ? { unexpectedExcerpts: copie.unexpectedExcerpts }
      : {},
  )

  const résultat = await gradeAnswer(
    {
      questionPrompt: question.prompt,
      answerKeyText: question.answerKey,
      language: 'fr',
      rubricLocked: true,
      criteria: critères,
      acceptableAnswersByCriterion: formulations,
      questionRules: règles,
      ocr,
    },
    analyzer,
  )

  // --- Enregistrement de la proposition -------------------------------------
  const [run] = await db
    .insert(gradingRuns)
    .values({
      organizationId: ctx.orgId,
      submissionId,
      answerRegionId: regionId,
      questionId,
      rubricVersionId: ctx.rubricVersionId,
      answerKeyVersionId: ctx.answerKeyVersionId,
      transcriptionVersionId: String(transcriptionVersion?.id),
      promptVersion: 1,
      pass: 'first_pass',
      unexpectedElements: résultat.analysis.unexpectedElements,
      uncertainSpans: résultat.analysis.uncertainSpans,
      needsHumanReview: true,
      confidence: résultat.confidence,
      confidenceLevel: résultat.confidenceLevel,
      totalProposed: résultat.outcome.total,
      durationMs: 20,
    })
    .returning()

  const runId = String(run?.id)

  for (const critère of résultat.outcome.criteria) {
    const detection = [
      ...résultat.analysis.presentCriteria,
      ...résultat.analysis.partialCriteria,
    ].find((d) => d.criterionId === (critère.criterionId as string))

    // Les cas verts sont validés tels quels par le correcteur ; les autres
    // restent en attente, sans points attribués.
    const validé = résultat.confidenceLevel === 'green'

    const [decision] = await db
      .insert(gradingDecisions)
      .values({
        organizationId: ctx.orgId,
        gradingRunId: runId,
        submissionId,
        questionId,
        rubricCriterionId: critère.criterionId as string,
        status: critère.status,
        contradicted: critère.contradicted,
        factuallyWrong: critère.factuallyWrong,
        matchedElementCount: detection?.matchedElementCount ?? 0,
        pointsPossible: critère.pointsPossible,
        pointsProposed: critère.pointsComputed,
        pointsAwarded: validé ? critère.pointsComputed : null,
        confidence: résultat.confidence,
        confidenceLevel: résultat.confidenceLevel,
        structuredJustification: {
          matched_elements: detection?.excerpts ?? [],
          decision:
            critère.pointsComputed === critère.pointsPossible
              ? 'full_credit'
              : critère.pointsComputed > 0
                ? 'partial_credit'
                : 'no_credit',
          needs_human_review: !validé,
        },
        appliedRules: critère.appliedRules,
        warnings: résultat.warnings,
        excluded: critère.excluded,
        deniedForMissingEvidence: critère.deniedForMissingEvidence,
        reviewedBy: validé ? ctx.graderId : null,
        reviewedAt: validé ? at(minute + 2) : null,
      })
      .returning()

    for (const [i, extrait] of (detection?.excerpts ?? []).entries()) {
      await db.insert(gradingEvidence).values({
        organizationId: ctx.orgId,
        gradingDecisionId: String(decision?.id),
        excerpt: extrait,
        sortOrder: i,
      })
    }

    if (validé) {
      await db.insert(humanReviews).values({
        organizationId: ctx.orgId,
        gradingDecisionId: String(decision?.id),
        reviewerId: ctx.graderId,
        decision: 'accepted',
        pointsBefore: critère.pointsComputed,
        pointsAfter: critère.pointsComputed,
        rubricVersionId: ctx.rubricVersionId,
        answerKeyVersionId: ctx.answerKeyVersionId,
        viaBulkValidation: false,
      })
    }
  }

  await audit(db, {
    organizationId: ctx.orgId,
    actorRole: 'coordinator',
    action: AUDIT_ACTIONS.GRADE_PROPOSE,
    objectType: 'grading_run',
    objectId: runId,
    newValue: {
      questionNumber: question.number,
      totalProposed: résultat.outcome.total,
      confidenceLevel: résultat.confidenceLevel,
    },
    occurredAt: at(minute + 1),
  })

  await db.insert(grades).values({
    organizationId: ctx.orgId,
    submissionId,
    questionId,
    versionNumber: 1,
    pointsExact: résultat.outcome.total,
    pointsRounded: résultat.outcome.total,
    pointsMax: question.maxPoints,
    finalizedBy: résultat.confidenceLevel === 'green' ? ctx.coordinatorId : null,
    finalizedAt: résultat.confidenceLevel === 'green' ? at(minute + 3) : null,
  })

  return { total: résultat.outcome.total, niveau: résultat.confidenceLevel }
}

// --- Bilan --------------------------------------------------------------------

async function report(db: Db, orgId: string): Promise<void> {
  const [row] = (await db.execute(sql`
    SELECT
      (SELECT count(*) FROM submissions       WHERE organization_id = ${orgId}::uuid) AS copies,
      (SELECT count(*) FROM grading_runs      WHERE organization_id = ${orgId}::uuid) AS analyses,
      (SELECT count(*) FROM grading_decisions WHERE organization_id = ${orgId}::uuid) AS decisions,
      (SELECT count(*) FROM grading_evidence  WHERE organization_id = ${orgId}::uuid) AS preuves,
      (SELECT count(*) FROM human_reviews     WHERE organization_id = ${orgId}::uuid) AS validations,
      (SELECT count(*) FROM audit_events      WHERE organization_id = ${orgId}::uuid) AS audit
  `)) as unknown as Record<string, string>[]

  console.log('\nDonnées de démonstration chargées.\n')
  console.log(`  copies       ${row?.['copies']}`)
  console.log(`  analyses     ${row?.['analyses']}`)
  console.log(`  décisions    ${row?.['decisions']}`)
  console.log(`  preuves      ${row?.['preuves']}`)
  console.log(`  validations  ${row?.['validations']}`)
  console.log(`  audit        ${row?.['audit']} événements`)
  console.log('\nComptes de démonstration (mots de passe à créer via l’application) :')
  for (const u of USERS) console.log(`  ${u.email}  —  ${u.role}`)
}

main().catch((error: unknown) => {
  console.error('\nÉchec du chargement :', error)
  process.exitCode = 1
})
