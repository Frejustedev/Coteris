/**
 * Accès aux données métier.
 *
 * Règle sans exception : **toute fonction reçoit `organizationId` en premier
 * paramètre**, et cet identifiant vient de la session, jamais d'une URL. C'est la
 * première défense contre les fuites entre établissements ; sans elle, changer un
 * identifiant dans la barre d'adresse suffirait à lire les copies d'une autre
 * faculté.
 *
 * Les requêtes vivent ici et nulle part ailleurs : aucun composant n'écrit de
 * requête ad hoc.
 */

import 'server-only'
import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm'

import { db, schema } from './db'

// --- Épreuves ----------------------------------------------------------------

export interface AssessmentSummary {
  readonly id: string
  readonly title: string
  readonly subject: string | null
  readonly status: string
  readonly maxPoints: number
  readonly examDate: Date | null
  readonly submissionCount: number
}

export async function listAssessments(organizationId: string): Promise<AssessmentSummary[]> {
  const rows = await db
    .select({
      id: schema.assessments.id,
      title: schema.assessments.title,
      subject: schema.assessments.subject,
      status: schema.assessments.status,
      maxPoints: schema.assessments.maxPoints,
      examDate: schema.assessments.examDate,
      submissionCount: count(schema.submissions.id),
    })
    .from(schema.assessments)
    .leftJoin(
      schema.submissions,
      and(
        eq(schema.submissions.assessmentId, schema.assessments.id),
        isNull(schema.submissions.deletedAt),
      ),
    )
    .where(
      and(
        eq(schema.assessments.organizationId, organizationId),
        isNull(schema.assessments.deletedAt),
      ),
    )
    .groupBy(schema.assessments.id)
    .orderBy(desc(schema.assessments.createdAt))

  return rows.map((r) => ({ ...r, submissionCount: Number(r.submissionCount) }))
}

export async function getAssessment(organizationId: string, assessmentId: string) {
  const [row] = await db
    .select()
    .from(schema.assessments)
    .where(
      and(
        eq(schema.assessments.id, assessmentId),
        // Le filtre par organisation est dans le WHERE, pas vérifié après coup :
        // une épreuve d'un autre établissement est simplement introuvable.
        eq(schema.assessments.organizationId, organizationId),
        isNull(schema.assessments.deletedAt),
      ),
    )
    .limit(1)

  return row ?? null
}

export async function listQuestions(organizationId: string, assessmentId: string) {
  return db
    .select()
    .from(schema.questions)
    .where(
      and(
        eq(schema.questions.assessmentId, assessmentId),
        eq(schema.questions.organizationId, organizationId),
        isNull(schema.questions.deletedAt),
      ),
    )
    .orderBy(asc(schema.questions.sortOrder))
}

// --- Copies ------------------------------------------------------------------

export interface SubmissionRow {
  readonly id: string
  readonly anonymousCode: string
  readonly status: string
  readonly quality: string | null
  readonly pointsExact: number | null
  readonly pointsMax: number | null
  readonly redCount: number
  readonly orangeCount: number
  readonly greenCount: number
}

/**
 * Copies d'une épreuve, avec la répartition des niveaux de confiance.
 *
 * L'agrégation est faite en SQL : la calculer en JavaScript imposerait de charger
 * toutes les décisions de toutes les copies pour afficher une simple liste.
 */
export async function listSubmissions(
  organizationId: string,
  assessmentId: string,
): Promise<SubmissionRow[]> {
  const rows = (await db.execute(sql`
    SELECT
      s.id,
      s.anonymous_code                                        AS "anonymousCode",
      s.status,
      s.quality,
      g.points_exact                                          AS "pointsExact",
      g.points_max                                            AS "pointsMax",
      COALESCE(c.red, 0)                                      AS "redCount",
      COALESCE(c.orange, 0)                                   AS "orangeCount",
      COALESCE(c.green, 0)                                    AS "greenCount"
    FROM submissions s
    LEFT JOIN grades g
      ON g.submission_id = s.id AND g.question_id IS NULL
    LEFT JOIN (
      SELECT submission_id,
             count(*) FILTER (WHERE confidence_level = 'red')    AS red,
             count(*) FILTER (WHERE confidence_level = 'orange') AS orange,
             count(*) FILTER (WHERE confidence_level = 'green')  AS green
      FROM grading_runs
      GROUP BY submission_id
    ) c ON c.submission_id = s.id
    WHERE s.assessment_id = ${assessmentId}::uuid
      AND s.organization_id = ${organizationId}::uuid
      AND s.deleted_at IS NULL
    ORDER BY s.anonymous_code
  `)) as unknown as Record<string, unknown>[]

  return rows.map((r) => ({
    id: String(r['id']),
    anonymousCode: String(r['anonymousCode']),
    status: String(r['status']),
    quality: r['quality'] === null ? null : String(r['quality']),
    pointsExact: r['pointsExact'] === null ? null : Number(r['pointsExact']),
    pointsMax: r['pointsMax'] === null ? null : Number(r['pointsMax']),
    redCount: Number(r['redCount']),
    orangeCount: Number(r['orangeCount']),
    greenCount: Number(r['greenCount']),
  }))
}

export async function getSubmission(organizationId: string, submissionId: string) {
  const [row] = await db
    .select()
    .from(schema.submissions)
    .where(
      and(
        eq(schema.submissions.id, submissionId),
        eq(schema.submissions.organizationId, organizationId),
        isNull(schema.submissions.deletedAt),
      ),
    )
    .limit(1)

  return row ?? null
}

// --- Correction ---------------------------------------------------------------

export interface CriterionDecision {
  readonly decisionId: string
  readonly criterionId: string
  readonly label: string
  readonly status: string
  readonly pointsPossible: number
  readonly pointsProposed: number
  readonly pointsAwarded: number | null
  readonly deniedForMissingEvidence: boolean
  readonly excluded: boolean
  readonly evidence: readonly string[]
  readonly appliedRules: readonly { rule: string; detail: string }[]
}

export interface QuestionReview {
  readonly questionId: string
  readonly number: string
  readonly prompt: string
  readonly maxPoints: number
  readonly answerKey: string | null
  readonly transcription: string
  readonly ocrConfidence: number | null
  readonly confidence: number | null
  readonly confidenceLevel: 'green' | 'orange' | 'red' | null
  readonly totalProposed: number | null
  readonly unexpectedElements: readonly { excerpt: string; explanation: string }[]
  readonly warnings: readonly string[]
  readonly decisions: readonly CriterionDecision[]
  readonly regionImageKey: string | null
}

/**
 * Tout ce qu'il faut pour afficher l'écran de correction d'une copie.
 *
 * Une seule requête par catégorie plutôt qu'une par question : l'écran de
 * correction est celui qu'un correcteur ouvre des centaines de fois par jour.
 */
export async function getSubmissionReview(
  organizationId: string,
  submissionId: string,
): Promise<QuestionReview[]> {
  const rows = (await db.execute(sql`
    SELECT
      q.id                    AS "questionId",
      q.number,
      q.prompt,
      q.max_points            AS "maxPoints",
      r.id                    AS "runId",
      r.confidence,
      r.confidence_level      AS "confidenceLevel",
      r.total_proposed        AS "totalProposed",
      r.unexpected_elements   AS "unexpectedElements",
      ar.cropped_image_key    AS "regionImageKey",
      tv.text                 AS transcription,
      orun.confidence         AS "ocrConfidence",
      ake.content             AS "answerKey"
    FROM questions q
    LEFT JOIN answer_regions ar
      ON ar.question_id = q.id AND ar.submission_id = ${submissionId}::uuid
    LEFT JOIN transcription_versions tv
      ON tv.answer_region_id = ar.id AND tv.is_current = true
    LEFT JOIN ocr_runs orun
      ON orun.id = tv.ocr_run_id
    LEFT JOIN grading_runs r
      ON r.question_id = q.id AND r.submission_id = ${submissionId}::uuid
    LEFT JOIN LATERAL (
      SELECT string_agg(content, ' · ' ORDER BY sort_order) AS content
      FROM answer_key_elements e
      WHERE e.question_id = q.id
    ) ake ON true
    WHERE q.organization_id = ${organizationId}::uuid
      AND q.assessment_id = (
        SELECT assessment_id FROM submissions
        WHERE id = ${submissionId}::uuid AND organization_id = ${organizationId}::uuid
      )
      AND q.deleted_at IS NULL
    ORDER BY q.sort_order
  `)) as unknown as Record<string, unknown>[]

  const decisions = (await db.execute(sql`
    SELECT
      d.id                          AS "decisionId",
      d.question_id                 AS "questionId",
      d.rubric_criterion_id         AS "criterionId",
      rc.label,
      d.status,
      d.points_possible             AS "pointsPossible",
      d.points_proposed             AS "pointsProposed",
      d.points_awarded              AS "pointsAwarded",
      d.denied_for_missing_evidence AS "denied",
      d.excluded,
      d.applied_rules               AS "appliedRules",
      d.warnings,
      COALESCE(
        (SELECT json_agg(e.excerpt ORDER BY e.sort_order)
         FROM grading_evidence e WHERE e.grading_decision_id = d.id),
        '[]'::json
      )                             AS evidence
    FROM grading_decisions d
    JOIN rubric_criteria rc ON rc.id = d.rubric_criterion_id
    WHERE d.submission_id = ${submissionId}::uuid
      AND d.organization_id = ${organizationId}::uuid
    ORDER BY rc.sort_order
  `)) as unknown as Record<string, unknown>[]

  const byQuestion = new Map<string, CriterionDecision[]>()
  const warningsByQuestion = new Map<string, string[]>()

  for (const d of decisions) {
    const questionId = String(d['questionId'])
    const liste = byQuestion.get(questionId) ?? []
    liste.push({
      decisionId: String(d['decisionId']),
      criterionId: String(d['criterionId']),
      label: String(d['label']),
      status: String(d['status']),
      pointsPossible: Number(d['pointsPossible']),
      pointsProposed: Number(d['pointsProposed']),
      pointsAwarded: d['pointsAwarded'] === null ? null : Number(d['pointsAwarded']),
      deniedForMissingEvidence: Boolean(d['denied']),
      excluded: Boolean(d['excluded']),
      evidence: (d['evidence'] as string[] | null) ?? [],
      appliedRules: (d['appliedRules'] as { rule: string; detail: string }[] | null) ?? [],
    })
    byQuestion.set(questionId, liste)

    const w = (d['warnings'] as string[] | null) ?? []
    if (w.length > 0) warningsByQuestion.set(questionId, w)
  }

  return rows.map((r) => {
    const questionId = String(r['questionId'])
    return {
      questionId,
      number: String(r['number']),
      prompt: String(r['prompt']),
      maxPoints: Number(r['maxPoints']),
      answerKey: r['answerKey'] === null ? null : String(r['answerKey']),
      transcription: r['transcription'] === null ? '' : String(r['transcription']),
      ocrConfidence: r['ocrConfidence'] === null ? null : Number(r['ocrConfidence']),
      confidence: r['confidence'] === null ? null : Number(r['confidence']),
      confidenceLevel: (r['confidenceLevel'] as QuestionReview['confidenceLevel']) ?? null,
      totalProposed: r['totalProposed'] === null ? null : Number(r['totalProposed']),
      unexpectedElements:
        (r['unexpectedElements'] as { excerpt: string; explanation: string }[] | null) ?? [],
      warnings: warningsByQuestion.get(questionId) ?? [],
      decisions: byQuestion.get(questionId) ?? [],
      regionImageKey: r['regionImageKey'] === null ? null : String(r['regionImageKey']),
    }
  })
}

// --- Statistiques -------------------------------------------------------------

export interface AssessmentStats {
  readonly submissions: number
  readonly graded: number
  readonly green: number
  readonly orange: number
  readonly red: number
  readonly averageExact: number | null
  readonly maxPoints: number
}

export async function getAssessmentStats(
  organizationId: string,
  assessmentId: string,
): Promise<AssessmentStats> {
  const [row] = (await db.execute(sql`
    SELECT
      (SELECT count(*) FROM submissions
        WHERE assessment_id = ${assessmentId}::uuid
          AND organization_id = ${organizationId}::uuid
          AND deleted_at IS NULL)                                  AS submissions,
      (SELECT count(*) FROM grades g
        JOIN submissions s ON s.id = g.submission_id
        WHERE s.assessment_id = ${assessmentId}::uuid
          AND g.question_id IS NULL
          AND g.finalized_at IS NOT NULL)                          AS graded,
      (SELECT count(*) FROM grading_runs r
        JOIN submissions s ON s.id = r.submission_id
        WHERE s.assessment_id = ${assessmentId}::uuid
          AND r.confidence_level = 'green')                        AS green,
      (SELECT count(*) FROM grading_runs r
        JOIN submissions s ON s.id = r.submission_id
        WHERE s.assessment_id = ${assessmentId}::uuid
          AND r.confidence_level = 'orange')                       AS orange,
      (SELECT count(*) FROM grading_runs r
        JOIN submissions s ON s.id = r.submission_id
        WHERE s.assessment_id = ${assessmentId}::uuid
          AND r.confidence_level = 'red')                          AS red,
      (SELECT avg(g.points_exact) FROM grades g
        JOIN submissions s ON s.id = g.submission_id
        WHERE s.assessment_id = ${assessmentId}::uuid
          AND g.question_id IS NULL)                               AS "averageExact",
      (SELECT max_points FROM assessments WHERE id = ${assessmentId}::uuid) AS "maxPoints"
  `)) as unknown as Record<string, unknown>[]

  return {
    submissions: Number(row?.['submissions'] ?? 0),
    graded: Number(row?.['graded'] ?? 0),
    green: Number(row?.['green'] ?? 0),
    orange: Number(row?.['orange'] ?? 0),
    red: Number(row?.['red'] ?? 0),
    averageExact:
      row?.['averageExact'] === null || row?.['averageExact'] === undefined
        ? null
        : Number(row['averageExact']),
    maxPoints: Number(row?.['maxPoints'] ?? 0),
  }
}

// --- Audit --------------------------------------------------------------------

export async function listAuditEvents(organizationId: string, limit = 50) {
  return db
    .select({
      id: schema.auditEvents.id,
      sequence: schema.auditEvents.sequence,
      action: schema.auditEvents.action,
      objectType: schema.auditEvents.objectType,
      reason: schema.auditEvents.reason,
      occurredAt: schema.auditEvents.occurredAt,
      hash: schema.auditEvents.hash,
    })
    .from(schema.auditEvents)
    .where(eq(schema.auditEvents.organizationId, organizationId))
    .orderBy(desc(schema.auditEvents.sequence))
    .limit(limit)
}
