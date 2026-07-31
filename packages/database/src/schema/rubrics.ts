/**
 * Corrigés et barèmes.
 *
 * Règle centrale du produit : **aucune correction sans barème validé**. Une
 * `rubric_version` porte `lockedAt` et `lockedBy` ; tant qu'ils sont nuls, aucune
 * copie ne peut être analysée. Une contrainte SQL le garantit, elle n'est pas
 * seulement vérifiée par l'application.
 *
 * Rien de ce que l'IA propose n'arrive ici sans être passé par
 * `validation_status = 'accepted'` ou `'modified'`.
 */

import { relations } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

import { assessments, questions } from './assessments'
import { users, organizations } from './auth'
import {
  attributionTypeEnum,
  millipointsColumn,
  primaryId,
  softDelete,
  timestamps,
  validationStatusEnum,
} from './_shared'

// --- Corrigé -----------------------------------------------------------------

export const answerKeys = pgTable(
  'answer_keys',
  {
    id: primaryId(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('answer_keys_assessment_unique').on(table.assessmentId),
    index('answer_keys_org_idx').on(table.organizationId),
  ],
)

export const answerKeyVersions = pgTable(
  'answer_key_versions',
  {
    id: primaryId(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    answerKeyId: uuid('answer_key_id')
      .notNull()
      .references(() => answerKeys.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    sourceFileKey: text('source_file_key'),
    /** Corrigé fourni par le professeur. Jamais généré par l'IA. */
    rawText: text('raw_text'),
    contentHash: text('content_hash').notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: uuid('locked_by').references(() => users.id, { onDelete: 'restrict' }),
    /** Motif de création de cette version, quand elle succède à une autre. */
    changeReason: text('change_reason'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('answer_key_versions_unique').on(table.answerKeyId, table.versionNumber),
    index('answer_key_versions_org_idx').on(table.organizationId),
  ],
)

/**
 * Éléments du corrigé pour une question : idées principales, éléments
 * indispensables ou secondaires, synonymes, formulations équivalentes, erreurs
 * fréquentes.
 */
export const answerKeyElements = pgTable(
  'answer_key_elements',
  {
    id: primaryId(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    answerKeyVersionId: uuid('answer_key_version_id')
      .notNull()
      .references(() => answerKeyVersions.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    content: text('content').notNull(),
    /** Formulations équivalentes acceptées. */
    synonyms: jsonb('synonyms').notNull().default([]),
    sortOrder: integer('sort_order').notNull().default(0),
    /**
     * Un élément proposé par l'IA reste `draft` tant qu'un humain ne l'a pas
     * accepté. Le pipeline de correction ignore les brouillons.
     */
    validationStatus: validationStatusEnum('validation_status').notNull().default('draft'),
    validatedBy: uuid('validated_by').references(() => users.id, { onDelete: 'set null' }),
    validatedAt: timestamp('validated_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('answer_key_elements_version_idx').on(table.answerKeyVersionId, table.questionId),
    index('answer_key_elements_org_idx').on(table.organizationId),
  ],
)

// --- Barème ------------------------------------------------------------------

export const rubrics = pgTable(
  'rubrics',
  {
    id: primaryId(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('rubrics_assessment_unique').on(table.assessmentId),
    index('rubrics_org_idx').on(table.organizationId),
  ],
)

export const rubricVersions = pgTable(
  'rubric_versions',
  {
    id: primaryId(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    rubricId: uuid('rubric_id')
      .notNull()
      .references(() => rubrics.id, { onDelete: 'cascade' }),
    /** Version du corrigé sur laquelle ce barème s'appuie. */
    answerKeyVersionId: uuid('answer_key_version_id')
      .notNull()
      .references(() => answerKeyVersions.id, { onDelete: 'restrict' }),
    versionNumber: integer('version_number').notNull(),
    contentHash: text('content_hash').notNull(),
    /**
     * Tant que `lockedAt` est nul, aucune correction n'est possible.
     * La contrainte ci-dessous garantit qu'un verrouillage porte toujours un
     * signataire et une date : un barème ne se verrouille pas tout seul.
     */
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: uuid('locked_by').references(() => users.id, { onDelete: 'restrict' }),
    changeReason: text('change_reason'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('rubric_versions_unique').on(table.rubricId, table.versionNumber),
    index('rubric_versions_org_idx').on(table.organizationId),
    check(
      'rubric_versions_lock_complete',
      sql`(${table.lockedAt} IS NULL AND ${table.lockedBy} IS NULL)
          OR (${table.lockedAt} IS NOT NULL AND ${table.lockedBy} IS NOT NULL)`,
    ),
  ],
)

/**
 * Un critère du barème.
 *
 * Les colonnes correspondent une à une au type `RubricCriterion` de
 * `@coteris/grading`. Le moteur reçoit exactement ce qui est stocké ici, sans
 * transformation susceptible d'introduire une divergence.
 */
export const rubricCriteria = pgTable(
  'rubric_criteria',
  {
    id: primaryId(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    rubricVersionId: uuid('rubric_version_id')
      .notNull()
      .references(() => rubricVersions.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    description: text('description'),
    attribution: attributionTypeEnum('attribution').notNull(),
    maxPoints: millipointsColumn('max_points').notNull(),
    sortOrder: integer('sort_order').notNull(),
    required: boolean('required').notNull().default(false),
    partialRatioPercent: integer('partial_ratio_percent').notNull().default(50),
    expectedElementCount: integer('expected_element_count').notNull().default(0),
    pointsPerElement: millipointsColumn('points_per_element'),
    cap: millipointsColumn('cap'),
    /** Politique de contradiction, sérialisée : { kind, percent? , amount? }. */
    contradictionPolicy: jsonb('contradiction_policy').notNull().default({ kind: 'ignore' }),
    factualErrorPenalty: millipointsColumn('factual_error_penalty'),
    /** Identifiants des critères dont l'attribution rend celui-ci inapplicable. */
    excludedBy: jsonb('excluded_by').notNull().default([]),
    /** Réponses acceptables et partielles, alimentées par le corrigé validé. */
    acceptableAnswers: jsonb('acceptable_answers').notNull().default([]),
    partialAnswers: jsonb('partial_answers').notNull().default([]),
    commonErrors: jsonb('common_errors').notNull().default([]),
    /** Consigne sur l'orthographe : ignorer les fautes, ou en tenir compte. */
    ignoreSpelling: boolean('ignore_spelling').notNull().default(true),
    validationStatus: validationStatusEnum('validation_status').notNull().default('draft'),
    validatedBy: uuid('validated_by').references(() => users.id, { onDelete: 'set null' }),
    validatedAt: timestamp('validated_at', { withTimezone: true }),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index('rubric_criteria_version_idx').on(table.rubricVersionId, table.questionId),
    index('rubric_criteria_org_idx').on(table.organizationId),
    // Les points sont en millièmes et ne peuvent pas être négatifs : une pénalité
    // se déclare avec l'attribution `penalty`, pas avec un nombre négatif.
    check('rubric_criteria_max_points_positive', sql`${table.maxPoints} >= 0`),
    check(
      'rubric_criteria_partial_ratio_range',
      sql`${table.partialRatioPercent} BETWEEN 0 AND 100`,
    ),
    check(
      'rubric_criteria_per_element_consistent',
      sql`${table.attribution} <> 'per_element' OR ${table.expectedElementCount} > 0`,
    ),
  ],
)

export const rubricVersionsRelations = relations(rubricVersions, ({ one, many }) => ({
  rubric: one(rubrics, { fields: [rubricVersions.rubricId], references: [rubrics.id] }),
  answerKeyVersion: one(answerKeyVersions, {
    fields: [rubricVersions.answerKeyVersionId],
    references: [answerKeyVersions.id],
  }),
  criteria: many(rubricCriteria),
}))

export const rubricCriteriaRelations = relations(rubricCriteria, ({ one }) => ({
  rubricVersion: one(rubricVersions, {
    fields: [rubricCriteria.rubricVersionId],
    references: [rubricVersions.id],
  }),
  question: one(questions, {
    fields: [rubricCriteria.questionId],
    references: [questions.id],
  }),
}))
