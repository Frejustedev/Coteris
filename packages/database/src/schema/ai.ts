/**
 * Suivi des appels d'IA, des coûts et des quotas.
 *
 * Le coût d'inférence est une fonctionnalité métier, pas une métrique
 * d'observabilité. Une plateforme dont le coût par copie dépasse le prix de vente
 * n'a pas de modèle économique — il faut donc le mesurer par appel, dès le début,
 * et pouvoir couper avant de dépenser.
 *
 * Les coûts sont stockés en **millionièmes d'euro** (entiers), pour la même raison
 * que les points le sont en millièmes : un appel coûte parfois 0,0003 €, et
 * additionner des flottants sur des milliers d'appels dérive.
 */

import { sql } from 'drizzle-orm'
import {
  bigint,
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

import { assessments } from './assessments'
import { organizations } from './auth'
import { aiRunStatusEnum, aiTaskTypeEnum, primaryId, timestamps } from './_shared'

export const aiRuns = pgTable(
  'ai_runs',
  {
    id: primaryId(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    assessmentId: uuid('assessment_id').references(() => assessments.id, { onDelete: 'set null' }),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    modelVersion: text('model_version'),
    taskType: aiTaskTypeEnum('task_type').notNull(),
    promptVersion: integer('prompt_version').notNull(),
    pageCount: integer('page_count'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    /** Coût estimé, en millionièmes d'euro. */
    costMicroEur: bigint('cost_micro_eur', { mode: 'number' }).notNull().default(0),
    durationMs: integer('duration_ms'),
    status: aiRunStatusEnum('status').notNull(),
    error: text('error'),
    ...timestamps,
  },
  (table) => [
    index('ai_runs_org_time_idx').on(table.organizationId, table.createdAt),
    index('ai_runs_assessment_idx').on(table.assessmentId),
    index('ai_runs_task_idx').on(table.organizationId, table.taskType),
  ],
)

/**
 * Consommation agrégée par organisation et par mois.
 *
 * Table distincte des `ai_runs` : le coupe-circuit doit pouvoir lire la
 * consommation courante en une ligne, avant chaque appel, sans agréger des
 * centaines de milliers de lignes.
 */
export const usageRecords = pgTable(
  'usage_records',
  {
    id: primaryId(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Mois au format `AAAA-MM`. */
    period: text('period').notNull(),
    aiCallCount: integer('ai_call_count').notNull().default(0),
    pageCount: integer('page_count').notNull().default(0),
    submissionCount: integer('submission_count').notNull().default(0),
    costMicroEur: bigint('cost_micro_eur', { mode: 'number' }).notNull().default(0),
    ...timestamps,
  },
  (table) => [uniqueIndex('usage_records_unique').on(table.organizationId, table.period)],
)

export const subscriptionPlans = pgTable(
  'subscription_plans',
  {
    id: primaryId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    /**
     * Plafond mensuel, en millionièmes d'euro.
     *
     * Il n'existe pas de valeur signifiant « illimité ». Une offre illimitée
     * adossée à un coût d'inférence variable est un risque financier non borné.
     */
    monthlyBudgetMicroEur: bigint('monthly_budget_micro_eur', { mode: 'number' }).notNull(),
    maxSubmissionsPerMonth: integer('max_submissions_per_month').notNull(),
    features: jsonb('features').notNull().default({}),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('subscription_plans_code_unique').on(table.code),
    check('subscription_plans_budget_bounded', sql`${table.monthlyBudgetMicroEur} > 0`),
  ],
)

export const organizationQuotas = pgTable(
  'organization_quotas',
  {
    id: primaryId(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id').references(() => subscriptionPlans.id, { onDelete: 'set null' }),
    monthlyBudgetMicroEur: bigint('monthly_budget_micro_eur', { mode: 'number' }).notNull(),
    perAssessmentBudgetMicroEur: bigint('per_assessment_budget_micro_eur', {
      mode: 'number',
    }).notNull(),
    /** Coupe-circuit manuel : suspend tout appel d'IA pour l'organisation. */
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    suspensionReason: text('suspension_reason'),
    ...timestamps,
  },
  (table) => [uniqueIndex('organization_quotas_unique').on(table.organizationId)],
)
