/**
 * Colonnes et énumérations communes à tout le schéma.
 *
 * Deux règles structurantes, appliquées sans exception :
 *
 * 1. **Toute table métier porte `organization_id`, non nul.** C'est la clé de la
 *    séparation entre établissements. Une table sans cette colonne ne peut pas
 *    être cloisonnée, ni par le code, ni par RLS.
 *
 * 2. **Les points sont des entiers en millièmes.** Jamais `real`, jamais
 *    `numeric`. Voir docs/adr/0006-arithmetique-des-points.md.
 */

import { integer, pgEnum, timestamp, uuid } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

/** Clé primaire UUID générée par la base. */
export const primaryId = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`)

/** Horodatages de création et de dernière modification. */
export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}

/**
 * Suppression logique.
 *
 * Utilisée partout où l'historique doit survivre à la suppression : on ne détruit
 * jamais une copie, une note ou une décision de correction. Un examen se conteste
 * parfois des mois plus tard.
 */
export const softDelete = {
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}

/**
 * Colonne de points, en millièmes.
 *
 * Le nom de la fonction est délibérément explicite : personne ne doit écrire
 * `real('points')` par inadvertance.
 */
export const millipointsColumn = (name: string) => integer(name)

// --- Énumérations ------------------------------------------------------------

/** Cycle de vie d'une épreuve. Les transitions sont contrôlées côté application. */
export const assessmentStatusEnum = pgEnum('assessment_status', [
  'DRAFT',
  'SUBJECT_REVIEW',
  'ANSWER_KEY_REVIEW',
  'RUBRIC_REVIEW',
  'READY_FOR_SUBMISSIONS',
  'SUBMISSIONS_PROCESSING',
  'GRADING',
  'HUMAN_REVIEW',
  'FINALIZED',
  'PUBLISHED',
  'ARCHIVED',
])

export const questionTypeEnum = pgEnum('question_type', [
  'mcq',
  'true_false',
  'short_answer',
  'short_essay',
  'clinical_case',
])

export const attributionTypeEnum = pgEnum('attribution_type', [
  'all_or_nothing',
  'partial',
  'per_element',
  'manual',
  'bonus',
  'penalty',
])

export const criterionStatusEnum = pgEnum('criterion_status', ['present', 'partial', 'absent'])

export const confidenceLevelEnum = pgEnum('confidence_level', ['green', 'orange', 'red'])

/** Statut qualité d'une copie importée. */
export const scanQualityEnum = pgEnum('scan_quality', [
  'acceptable',
  'auto_improvable',
  'check_recommended',
  'reimport_required',
])

export const submissionStatusEnum = pgEnum('submission_status', [
  'uploaded',
  'quality_checked',
  'segmented',
  'transcribed',
  'graded',
  'reviewed',
  'finalized',
  'failed',
])

/** État de validation d'un élément produit par l'IA. */
export const validationStatusEnum = pgEnum('validation_status', [
  'draft',
  'accepted',
  'modified',
  'rejected',
])

/**
 * Qui a écrit un critère de barème.
 *
 * Distinct de `validation_status`, qui dit si un enseignant l'a tranché. Un
 * critère peut être proposé par un modèle ET accepté sans retouche : les deux
 * informations sont nécessaires, et l'une ne se déduit pas de l'autre.
 */
export const criterionOriginEnum = pgEnum('criterion_origin', ['human', 'ai_suggested'])

export const aiTaskTypeEnum = pgEnum('ai_task_type', [
  'subject_extraction',
  'answer_key_structuring',
  'ocr',
  'segmentation',
  'analysis',
  'second_pass',
  'comment_generation',
])

export const aiRunStatusEnum = pgEnum('ai_run_status', ['success', 'failed', 'skipped_quota'])

export const reviewDecisionEnum = pgEnum('review_decision', [
  'accepted',
  'modified',
  'rejected',
  'deferred',
])

export const memberRoleEnum = pgEnum('member_role', ['coordinator', 'grader', 'tech_admin'])
