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
  /** Un modèle a proposé un découpage de barème. Aucun critère ne corrige encore. */
  RUBRIC_SUGGEST: 'rubric.suggest',
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
  /** Attribution d'une copie à un correcteur. */
  ASSIGNMENT_CHANGE: 'assignment.change',
  /**
   * Ajustement manuel des zones de réponse d'une copie.
   *
   * Distinct de `assignment.change`, qui portait cet événement à tort. Les deux
   * finiront filtrés séparément — l'un pour retracer qui a corrigé quoi, l'autre
   * pour retracer un découpage contesté — et la chaîne d'audit est en ajout
   * seul : un mélange devient irréparable dès la première ligne écrite.
   */
  REGION_ADJUST: 'region.adjust',
} as const

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS]

/**
 * Libellés lisibles des actions, en français.
 *
 * Ils vivent ici, à côté du catalogue qui fait foi, et non chez chaque
 * consommateur : la table était recopiée dans l'export CSV et dans l'écran
 * d'historique, et les deux copies avaient déjà commencé à diverger. Le type
 * `Record<AuditAction, string>` fait échouer la compilation dès qu'une action
 * est ajoutée sans son libellé — un journal d'audit dont une ligne s'affiche en
 * identifiant technique ne remplit pas son office.
 */
export const LIBELLÉS_ACTIONS: Record<AuditAction, string> = {
  'auth.login': 'Connexion',
  'auth.logout': 'Déconnexion',
  'assessment.create': 'Création d’épreuve',
  'assessment.status_change': 'Changement d’état',
  'subject.import': 'Import du sujet',
  'question.update': 'Modification de question',
  'answer_key.create': 'Création du corrigé',
  'answer_key.validate': 'Validation du corrigé',
  'rubric.create': 'Création du barème',
  'rubric.suggest': 'Proposition de barème par le modèle',
  'rubric.validate': 'Validation du barème',
  'rubric.lock': 'Verrouillage du barème',
  'submission.import': 'Import d’une copie',
  'ocr.run': 'Lecture de la copie',
  'transcription.edit': 'Correction de transcription',
  'grade.propose': 'Proposition de note',
  'grade.review': 'Validation d’une décision',
  'grade.modify': 'Modification d’une note',
  'grade.finalize': 'Finalisation de la note',
  'grade.publish': 'Publication',
  'export.create': 'Export',
  'identity.reveal': 'Levée d’anonymat',
  'permission.change': 'Changement de permission',
  'assignment.change': 'Attribution de copie',
  'region.adjust': 'Ajustement des zones de réponse',
}

/**
 * Libellé d'une action lue en base.
 *
 * La colonne `action` est un `text` : une valeur écrite par une version
 * antérieure du code peut ne plus figurer au catalogue. On rend alors
 * l'identifiant brut plutôt que rien — un journal en ajout seul contient
 * forcément des traces plus vieilles que le code qui les relit.
 */
export function libelléAction(action: string): string {
  return (LIBELLÉS_ACTIONS as Record<string, string>)[action] ?? action
}
