/**
 * Propositions de correction, preuves, décisions humaines et notes.
 *
 * C'est ici que se matérialise la chaîne de preuve exigée par le produit :
 *
 *   copie → question → zone → transcription → critère → extrait
 *        → points proposés → confiance → décision humaine → note finale
 *
 * Chaque `grading_decision` porte les versions du corrigé et du barème utilisées.
 * Sans elles, une note ne serait pas reproductible, et donc pas défendable.
 */

import { relations } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { questions } from './assessments'
import { users, organizations } from './auth'
import { answerKeyVersions, rubricCriteria, rubricVersions } from './rubrics'
import { answerRegions, submissions } from './submissions'
import { ocrSpans, transcriptionVersions } from './ocr'
import {
  confidenceLevelEnum,
  criterionStatusEnum,
  millipointsColumn,
  primaryId,
  reviewDecisionEnum,
  timestamps,
} from './_shared'

/** Une exécution du pipeline de correction sur une zone de réponse. */
export const gradingRuns = pgTable(
  'grading_runs',
  {
    id: primaryId(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => submissions.id, { onDelete: 'cascade' }),
    answerRegionId: uuid('answer_region_id')
      .notNull()
      .references(() => answerRegions.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    /**
     * Barème utilisé. La contrainte applicative exige qu'il soit verrouillé :
     * aucune correction sans barème validé.
     */
    rubricVersionId: uuid('rubric_version_id')
      .notNull()
      .references(() => rubricVersions.id, { onDelete: 'restrict' }),
    answerKeyVersionId: uuid('answer_key_version_id')
      .notNull()
      .references(() => answerKeyVersions.id, { onDelete: 'restrict' }),
    transcriptionVersionId: uuid('transcription_version_id').references(
      () => transcriptionVersions.id,
      { onDelete: 'set null' },
    ),
    /** Version du jeu de prompts. Sans elle, la proposition n'est pas reproductible. */
    promptVersion: integer('prompt_version').notNull(),
    /** `first_pass` ou `second_pass`. La seconde passe est sélective, jamais systématique. */
    pass: text('pass').notNull().default('first_pass'),
    /** Éléments corrects repérés mais absents du corrigé. Déclenche une alerte. */
    unexpectedElements: jsonb('unexpected_elements').notNull().default([]),
    /** Passages que le modèle déclare incertains. */
    uncertainSpans: jsonb('uncertain_spans').notNull().default([]),
    needsHumanReview: boolean('needs_human_review').notNull().default(true),
    confidence: real('confidence'),
    confidenceLevel: confidenceLevelEnum('confidence_level'),
    totalProposed: millipointsColumn('total_proposed'),
    durationMs: integer('duration_ms'),
    error: text('error'),
    ...timestamps,
  },
  (table) => [
    index('grading_runs_submission_idx').on(table.submissionId, table.questionId),
    index('grading_runs_region_idx').on(table.answerRegionId, table.createdAt),
    index('grading_runs_org_idx').on(table.organizationId),
    index('grading_runs_review_idx').on(table.organizationId, table.needsHumanReview),
  ],
)

/**
 * Proposition de points pour un critère.
 *
 * `pointsProposed` vient du moteur déterministe, jamais du modèle.
 * `pointsAwarded` reste nul tant qu'aucun humain n'a tranché : c'est la
 * traduction en base de « la note ne devient définitive qu'après validation
 * humaine ».
 */
export const gradingDecisions = pgTable(
  'grading_decisions',
  {
    id: primaryId(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    gradingRunId: uuid('grading_run_id')
      .notNull()
      .references(() => gradingRuns.id, { onDelete: 'cascade' }),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => submissions.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    rubricCriterionId: uuid('rubric_criterion_id')
      .notNull()
      .references(() => rubricCriteria.id, { onDelete: 'restrict' }),
    status: criterionStatusEnum('status').notNull(),
    contradicted: boolean('contradicted').notNull().default(false),
    factuallyWrong: boolean('factually_wrong').notNull().default(false),
    matchedElementCount: integer('matched_element_count').notNull().default(0),
    pointsPossible: millipointsColumn('points_possible').notNull(),
    /** Calculé par le moteur déterministe. */
    pointsProposed: millipointsColumn('points_proposed').notNull(),
    /** Rempli uniquement après validation humaine. */
    pointsAwarded: millipointsColumn('points_awarded'),
    confidence: real('confidence'),
    confidenceLevel: confidenceLevelEnum('confidence_level'),
    /** Justification structurée et courte. Jamais une chaîne de pensée privée. */
    structuredJustification: jsonb('structured_justification').notNull().default({}),
    /** Trace des règles de barème appliquées, produite par le moteur. */
    appliedRules: jsonb('applied_rules').notNull().default([]),
    warnings: jsonb('warnings').notNull().default([]),
    excluded: boolean('excluded').notNull().default(false),
    deniedForMissingEvidence: boolean('denied_for_missing_evidence').notNull().default(false),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'restrict' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('grading_decisions_unique').on(table.gradingRunId, table.rubricCriterionId),
    index('grading_decisions_submission_idx').on(table.submissionId, table.questionId),
    index('grading_decisions_criterion_idx').on(table.rubricCriterionId),
    index('grading_decisions_org_idx').on(table.organizationId),
    // Une décision validée porte toujours son validateur et sa date.
    check(
      'grading_decisions_review_complete',
      sql`(${table.pointsAwarded} IS NULL)
          OR (${table.reviewedBy} IS NOT NULL AND ${table.reviewedAt} IS NOT NULL)`,
    ),
  ],
)

/**
 * Extrait exact de la réponse justifiant une décision.
 *
 * Relié aux `ocr_spans` quand la position est connue : c'est ce qui permet de
 * surligner le passage sur l'image de la copie.
 */
export const gradingEvidence = pgTable(
  'grading_evidence',
  {
    id: primaryId(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    gradingDecisionId: uuid('grading_decision_id')
      .notNull()
      .references(() => gradingDecisions.id, { onDelete: 'cascade' }),
    /** Extrait tel qu'il figure dans la transcription. */
    excerpt: text('excerpt').notNull(),
    startOffset: integer('start_offset'),
    endOffset: integer('end_offset'),
    ocrSpanId: uuid('ocr_span_id').references(() => ocrSpans.id, { onDelete: 'set null' }),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (table) => [
    index('grading_evidence_decision_idx').on(table.gradingDecisionId, table.sortOrder),
    index('grading_evidence_org_idx').on(table.organizationId),
  ],
)

/** Décision d'un correcteur sur une proposition. Jamais écrasée. */
export const humanReviews = pgTable(
  'human_reviews',
  {
    id: primaryId(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    gradingDecisionId: uuid('grading_decision_id')
      .notNull()
      .references(() => gradingDecisions.id, { onDelete: 'cascade' }),
    reviewerId: uuid('reviewer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    decision: reviewDecisionEnum('decision').notNull(),
    pointsBefore: millipointsColumn('points_before').notNull(),
    pointsAfter: millipointsColumn('points_after').notNull(),
    reason: text('reason'),
    comment: text('comment'),
    /** Versions en vigueur au moment de la décision. */
    rubricVersionId: uuid('rubric_version_id')
      .notNull()
      .references(() => rubricVersions.id, { onDelete: 'restrict' }),
    answerKeyVersionId: uuid('answer_key_version_id')
      .notNull()
      .references(() => answerKeyVersions.id, { onDelete: 'restrict' }),
    /** Vrai si la décision provient d'une validation groupée de cas verts. */
    viaBulkValidation: boolean('via_bulk_validation').notNull().default(false),
    ...timestamps,
  },
  (table) => [
    index('human_reviews_decision_idx').on(table.gradingDecisionId, table.createdAt),
    index('human_reviews_reviewer_idx').on(table.reviewerId),
    index('human_reviews_org_idx').on(table.organizationId),
  ],
)

/** Note d'une copie pour une question, puis note globale. */
export const grades = pgTable(
  'grades',
  {
    id: primaryId(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => submissions.id, { onDelete: 'cascade' }),
    /** Nul pour la note globale de la copie. */
    questionId: uuid('question_id').references(() => questions.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull().default(1),
    /** Valeur exacte, avant arrondi d'affichage. */
    pointsExact: millipointsColumn('points_exact').notNull(),
    /** Valeur arrondie selon le barème. C'est celle qui figure sur le relevé. */
    pointsRounded: millipointsColumn('points_rounded').notNull(),
    pointsMax: millipointsColumn('points_max').notNull(),
    finalizedBy: uuid('finalized_by').references(() => users.id, { onDelete: 'restrict' }),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    changeReason: text('change_reason'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('grades_unique').on(table.submissionId, table.questionId, table.versionNumber),
    index('grades_submission_idx').on(table.submissionId),
    index('grades_org_idx').on(table.organizationId),
    // Une note publiée a nécessairement été finalisée par un humain.
    check(
      'grades_published_requires_finalized',
      sql`${table.publishedAt} IS NULL
          OR (${table.finalizedAt} IS NOT NULL AND ${table.finalizedBy} IS NOT NULL)`,
    ),
  ],
)

/** Commentaire destiné à l'étudiant. Nécessite une validation avant publication. */
export const comments = pgTable(
  'comments',
  {
    id: primaryId(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => submissions.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id').references(() => questions.id, { onDelete: 'cascade' }),
    /** Proposition initiale, conservée même après modification. */
    proposedText: text('proposed_text'),
    text: text('text').notNull(),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'restrict' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('comments_submission_idx').on(table.submissionId, table.questionId),
    index('comments_org_idx').on(table.organizationId),
  ],
)

export const gradingRunsRelations = relations(gradingRuns, ({ one, many }) => ({
  submission: one(submissions, {
    fields: [gradingRuns.submissionId],
    references: [submissions.id],
  }),
  question: one(questions, { fields: [gradingRuns.questionId], references: [questions.id] }),
  decisions: many(gradingDecisions),
}))

export const gradingDecisionsRelations = relations(gradingDecisions, ({ one, many }) => ({
  run: one(gradingRuns, {
    fields: [gradingDecisions.gradingRunId],
    references: [gradingRuns.id],
  }),
  criterion: one(rubricCriteria, {
    fields: [gradingDecisions.rubricCriterionId],
    references: [rubricCriteria.id],
  }),
  evidence: many(gradingEvidence),
  reviews: many(humanReviews),
}))

export const gradesRelations = relations(grades, ({ one }) => ({
  submission: one(submissions, { fields: [grades.submissionId], references: [submissions.id] }),
  question: one(questions, { fields: [grades.questionId], references: [questions.id] }),
}))
