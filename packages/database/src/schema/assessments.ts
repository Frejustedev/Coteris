/**
 * Épreuves, versions et questions.
 *
 * Le versionnement est immuable : une `assessment_version` n'est jamais modifiée
 * après création. Toute évolution en crée une nouvelle. C'est ce qui permet de
 * répondre, six mois plus tard, à « sur quelle version du sujet cette copie
 * a-t-elle été corrigée ? ».
 */

import { relations } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { users, organizations } from './auth'
import {
  assessmentStatusEnum,
  millipointsColumn,
  primaryId,
  questionTypeEnum,
  softDelete,
  timestamps,
} from './_shared'

export const assessments = pgTable(
  'assessments',
  {
    id: primaryId(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    subject: text('subject'),
    level: text('level'),
    cohort: text('cohort'),
    institution: text('institution'),
    examDate: timestamp('exam_date', { withTimezone: true }),
    durationMinutes: integer('duration_minutes'),
    language: text('language').notNull().default('fr'),
    /** Note maximale de l'épreuve, en millièmes de point. */
    maxPoints: millipointsColumn('max_points').notNull(),
    description: text('description'),
    estimatedCandidates: integer('estimated_candidates'),
    /** Si vrai, les correcteurs ne voient jamais l'identité des étudiants. */
    anonymizationEnabled: boolean('anonymization_enabled').notNull().default(true),
    status: assessmentStatusEnum('status').notNull().default('DRAFT'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index('assessments_org_idx').on(table.organizationId),
    index('assessments_org_status_idx').on(table.organizationId, table.status),
    index('assessments_created_idx').on(table.createdAt),
  ],
)

/**
 * Version verrouillée du sujet.
 *
 * `contentHash` permet de prouver qu'un sujet n'a pas été modifié après
 * validation : on recalcule le hash et on le compare.
 */
export const assessmentVersions = pgTable(
  'assessment_versions',
  {
    id: primaryId(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    /** Chemin du fichier original dans le stockage. Jamais un chemin public. */
    sourceFileKey: text('source_file_key'),
    sourceFileName: text('source_file_name'),
    sourceMimeType: text('source_mime_type'),
    /** Texte extrait du sujet, quand l'extraction est possible. */
    extractedText: text('extracted_text'),
    contentHash: text('content_hash').notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: uuid('locked_by').references(() => users.id, { onDelete: 'restrict' }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('assessment_versions_unique').on(table.assessmentId, table.versionNumber),
    index('assessment_versions_org_idx').on(table.organizationId),
  ],
)

export const questions = pgTable(
  'questions',
  {
    id: primaryId(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    assessmentVersionId: uuid('assessment_version_id').references(() => assessmentVersions.id, {
      onDelete: 'set null',
    }),
    /** Numéro affiché : « 3 », « 3.a », « II.1 ». Texte, car non nécessairement numérique. */
    number: text('number').notNull(),
    title: text('title'),
    prompt: text('prompt').notNull(),
    type: questionTypeEnum('type').notNull(),
    maxPoints: millipointsColumn('max_points').notNull(),
    /** Question parente, pour les sous-questions. */
    parentQuestionId: uuid('parent_question_id'),
    sortOrder: integer('sort_order').notNull(),
    /** Page du sujet où figure la question, pour la segmentation. */
    sourcePage: integer('source_page'),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index('questions_assessment_idx').on(table.assessmentId, table.sortOrder),
    index('questions_org_idx').on(table.organizationId),
    uniqueIndex('questions_number_unique').on(table.assessmentId, table.number),
  ],
)

export const assessmentsRelations = relations(assessments, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [assessments.organizationId],
    references: [organizations.id],
  }),
  versions: many(assessmentVersions),
  questions: many(questions),
}))

export const questionsRelations = relations(questions, ({ one }) => ({
  assessment: one(assessments, {
    fields: [questions.assessmentId],
    references: [assessments.id],
  }),
}))

/** Réglages de correction d'une organisation, stockés dans `organization.settings`. */
export type AssessmentSettings = {
  readonly confidenceGreenMin: number
  readonly confidenceOrangeMin: number
  readonly secondPassGreenSampleRate: number
  readonly allowBulkValidationOfGreen: boolean
}
