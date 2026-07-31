/**
 * Copies, pages et zones de réponse.
 *
 * L'anonymisation est structurelle, pas cosmétique : la copie ne porte qu'un
 * `anonymousCode`. Le lien vers l'identité de l'étudiant vit dans une table
 * séparée, `submission_identities`, dont l'accès est restreint et journalisé.
 * Masquer un nom dans l'interface tout en le laissant dans la même ligne ne
 * protège de rien.
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

import { assessments, questions } from './assessments'
import { users, organizations } from './auth'
import {
  primaryId,
  scanQualityEnum,
  softDelete,
  submissionStatusEnum,
  timestamps,
} from './_shared'

export const students = pgTable(
  'students',
  {
    id: primaryId(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    /** Identifiant de l'établissement : numéro d'étudiant, matricule. */
    externalRef: text('external_ref'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    email: text('email'),
    cohort: text('cohort'),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index('students_org_idx').on(table.organizationId),
    uniqueIndex('students_org_ref_unique').on(table.organizationId, table.externalRef),
  ],
)

export const submissions = pgTable(
  'submissions',
  {
    id: primaryId(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    /**
     * Code anonyme affiché aux correcteurs. Seule identification visible quand
     * l'anonymisation est active.
     */
    anonymousCode: text('anonymous_code').notNull(),
    status: submissionStatusEnum('status').notNull().default('uploaded'),
    quality: scanQualityEnum('quality'),
    /** Problèmes détectés : flou, page sombre, page blanche, doublon. */
    qualityIssues: jsonb('quality_issues').notNull().default([]),
    pageCount: integer('page_count').notNull().default(0),
    originalFileKey: text('original_file_key'),
    originalFileName: text('original_file_name'),
    /** Empreinte du fichier, pour détecter les doublons d'import. */
    fileHash: text('file_hash'),
    /**
     * Clé d'idempotence de l'import. Deux envois du même lot ne créent pas deux
     * copies : un enseignant qui reclique après un délai réseau ne doit pas se
     * retrouver avec des doublons à trier.
     */
    idempotencyKey: text('idempotency_key'),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    uniqueIndex('submissions_code_unique').on(table.assessmentId, table.anonymousCode),
    uniqueIndex('submissions_idempotency_unique').on(table.organizationId, table.idempotencyKey),
    index('submissions_assessment_status_idx').on(table.assessmentId, table.status),
    index('submissions_org_idx').on(table.organizationId),
    index('submissions_hash_idx').on(table.assessmentId, table.fileHash),
  ],
)

/**
 * Correspondance entre une copie et l'identité de l'étudiant.
 *
 * Table distincte et volontairement minimale. Toute lecture est un événement
 * d'audit (`identity.reveal`). Un correcteur n'y a jamais accès.
 */
export const submissionIdentities = pgTable(
  'submission_identities',
  {
    id: primaryId(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => submissions.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'restrict' }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('submission_identities_submission_unique').on(table.submissionId),
    index('submission_identities_org_idx').on(table.organizationId),
  ],
)

export const submissionPages = pgTable(
  'submission_pages',
  {
    id: primaryId(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => submissions.id, { onDelete: 'cascade' }),
    pageNumber: integer('page_number').notNull(),
    /** Image de la page. Le fichier original de la copie est conservé à part. */
    imageKey: text('image_key').notNull(),
    /** Image après redressement et amélioration de contraste, si produite. */
    enhancedImageKey: text('enhanced_image_key'),
    widthPx: integer('width_px'),
    heightPx: integer('height_px'),
    dpi: integer('dpi'),
    rotationDegrees: integer('rotation_degrees').notNull().default(0),
    quality: scanQualityEnum('quality'),
    qualityIssues: jsonb('quality_issues').notNull().default([]),
    isBlank: boolean('is_blank').notNull().default(false),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('submission_pages_unique').on(table.submissionId, table.pageNumber),
    index('submission_pages_org_idx').on(table.organizationId),
  ],
)

/**
 * Zone d'une page rattachée à une question.
 *
 * Les coordonnées sont relatives (0 à 1), pas en pixels : elles restent valides
 * si l'image est redimensionnée ou remplacée par sa version améliorée.
 *
 * Ne jamais envoyer une page entière au modèle quand une zone recadrée suffit —
 * c'est à la fois moins coûteux et moins intrusif.
 */
export const answerRegions = pgTable(
  'answer_regions',
  {
    id: primaryId(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => submissions.id, { onDelete: 'cascade' }),
    submissionPageId: uuid('submission_page_id')
      .notNull()
      .references(() => submissionPages.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    x: real('x').notNull(),
    y: real('y').notNull(),
    width: real('width').notNull(),
    height: real('height').notNull(),
    /** Image recadrée de la zone. C'est elle qu'on envoie au modèle. */
    croppedImageKey: text('cropped_image_key'),
    /** Vrai si la zone poursuit une réponse commencée sur une autre page. */
    isContinuation: boolean('is_continuation').notNull().default(false),
    /** `auto` si détectée par le système, `manual` si tracée par un correcteur. */
    origin: text('origin').notNull().default('auto'),
    confidence: real('confidence'),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (table) => [
    index('answer_regions_submission_question_idx').on(table.submissionId, table.questionId),
    index('answer_regions_page_idx').on(table.submissionPageId),
    index('answer_regions_org_idx').on(table.organizationId),
    check(
      'answer_regions_coordinates_relative',
      sql`${table.x} >= 0 AND ${table.y} >= 0
          AND ${table.width} > 0 AND ${table.height} > 0
          AND ${table.x} + ${table.width} <= 1.0001
          AND ${table.y} + ${table.height} <= 1.0001`,
    ),
  ],
)

/** Attribution d'une copie, ou d'une question d'une copie, à un correcteur. */
export const assignments = pgTable(
  'assignments',
  {
    id: primaryId(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    submissionId: uuid('submission_id').references(() => submissions.id, { onDelete: 'cascade' }),
    /** Si renseigné, l'attribution ne porte que sur cette question. */
    questionId: uuid('question_id').references(() => questions.id, { onDelete: 'cascade' }),
    graderId: uuid('grader_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    assignedBy: uuid('assigned_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('assignments_grader_idx').on(table.graderId, table.assessmentId),
    index('assignments_submission_idx').on(table.submissionId),
    index('assignments_org_idx').on(table.organizationId),
  ],
)

export const submissionsRelations = relations(submissions, ({ one, many }) => ({
  assessment: one(assessments, {
    fields: [submissions.assessmentId],
    references: [assessments.id],
  }),
  pages: many(submissionPages),
  regions: many(answerRegions),
}))

export const answerRegionsRelations = relations(answerRegions, ({ one }) => ({
  submission: one(submissions, {
    fields: [answerRegions.submissionId],
    references: [submissions.id],
  }),
  page: one(submissionPages, {
    fields: [answerRegions.submissionPageId],
    references: [submissionPages.id],
  }),
  question: one(questions, {
    fields: [answerRegions.questionId],
    references: [questions.id],
  }),
}))
