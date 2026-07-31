/**
 * Journal d'audit en ajout seul, protégé par une chaîne de hash.
 *
 * Ce n'est pas une blockchain, et le produit ne prétendra jamais le contraire.
 * C'est une chaîne de HMAC : chaque événement inclut le hash du précédent. Modifier
 * ou supprimer une ligne rompt la chaîne, et le vérificateur indique exactement où.
 *
 * Deux choix méritent explication :
 *
 * 1. **Chaîne par organisation, pas globale.** Une chaîne unique sérialiserait
 *    toutes les écritures de la plateforme derrière un seul verrou. Par
 *    organisation, deux établissements écrivent en parallèle sans se gêner.
 *
 * 2. **Ajout seul appliqué au niveau SQL** (`REVOKE UPDATE, DELETE` dans la
 *    migration). Une chaîne de hash qu'un simple UPDATE peut réécrire ne protège
 *    de rien : l'attaquant recalculerait la chaîne. Le verrou doit être en base.
 */

import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, bigint } from 'drizzle-orm/pg-core'

import { organizations, users } from './auth'
import { memberRoleEnum, primaryId } from './_shared'

export const auditEvents = pgTable(
  'audit_events',
  {
    id: primaryId(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    /**
     * Position dans la chaîne de l'organisation. Strictement croissante et sans
     * trou : une lacune est en soi le signe d'une suppression.
     */
    sequence: bigint('sequence', { mode: 'number' }).notNull(),
    /** Nul pour les actions du système (traitements asynchrones). */
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'restrict' }),
    actorRole: memberRoleEnum('actor_role'),
    /** Code stable : `rubric.lock`, `grade.finalize`, `identity.reveal`. */
    action: text('action').notNull(),
    objectType: text('object_type').notNull(),
    objectId: uuid('object_id'),
    /** Valeurs avant et après. Jamais de donnée personnelle en clair superflue. */
    previousValue: jsonb('previous_value'),
    newValue: jsonb('new_value'),
    reason: text('reason'),
    metadata: jsonb('metadata').notNull().default({}),
    /** Corrèle plusieurs événements issus de la même requête HTTP. */
    requestId: text('request_id'),
    ipAddress: text('ip_address'),
    /** Hash de l'événement précédent de la même organisation. */
    previousHash: text('previous_hash'),
    /** HMAC du contenu de cet événement et de `previousHash`. */
    hash: text('hash').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('audit_events_sequence_unique').on(table.organizationId, table.sequence),
    index('audit_events_org_time_idx').on(table.organizationId, table.occurredAt),
    index('audit_events_object_idx').on(table.objectType, table.objectId),
    index('audit_events_actor_idx').on(table.actorId),
    index('audit_events_action_idx').on(table.organizationId, table.action),
  ],
)

/** Actions journalisées obligatoirement. La liste fait foi. */
export const AUDIT_ACTIONS = {
  AUTH_LOGIN: 'auth.login',
  AUTH_LOGOUT: 'auth.logout',
  ASSESSMENT_CREATE: 'assessment.create',
  ASSESSMENT_STATUS_CHANGE: 'assessment.status_change',
  SUBJECT_IMPORT: 'subject.import',
  QUESTION_UPDATE: 'question.update',
  ANSWER_KEY_CREATE: 'answer_key.create',
  ANSWER_KEY_VALIDATE: 'answer_key.validate',
  RUBRIC_CREATE: 'rubric.create',
  RUBRIC_VALIDATE: 'rubric.validate',
  RUBRIC_LOCK: 'rubric.lock',
  SUBMISSION_IMPORT: 'submission.import',
  OCR_RUN: 'ocr.run',
  TRANSCRIPTION_EDIT: 'transcription.edit',
  GRADE_PROPOSE: 'grade.propose',
  GRADE_REVIEW: 'grade.review',
  GRADE_MODIFY: 'grade.modify',
  GRADE_FINALIZE: 'grade.finalize',
  GRADE_PUBLISH: 'grade.publish',
  EXPORT_CREATE: 'export.create',
  IDENTITY_REVEAL: 'identity.reveal',
  PERMISSION_CHANGE: 'permission.change',
  ASSIGNMENT_CHANGE: 'assignment.change',
} as const

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS]
