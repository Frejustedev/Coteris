/**
 * Coupe-circuit budgétaire — lecture de l'état, et comptabilité des appels.
 *
 * CE QUI EXISTAIT, ET CE QUI MANQUAIT
 *
 * `computeCost`, `checkQuota`, `QuotaExceededError` et les tables `ai_runs`,
 * `usage_records`, `organization_quotas` étaient écrits, testés — et appelés par
 * aucun code d'exécution. Le fichier `.env.example` affirmait pourtant que le
 * plafond était « vérifié AVANT chaque appel ». Ce module est le chaînon qui
 * manquait entre les deux.
 *
 * DEUX DÉCISIONS
 *
 * **Une organisation sans quota configuré n'est pas bloquée.** Refuser tout
 * appel faute de configuration transformerait l'ajout de ce garde-fou en panne
 * générale. L'absence de quota est journalisée à chaque appel : elle se voit,
 * elle ne coupe pas.
 *
 * **La consommation est lue en une ligne, pas agrégée.** `usage_records` porte
 * un total par organisation et par mois, précisément pour que la vérification
 * qui précède *chaque* appel ne balaie pas des centaines de milliers de lignes
 * d'historique.
 */

import { sql } from 'drizzle-orm'

import { computeCost, microEur, type MicroEur, type QuotaState, type UsageForCost } from '@coteris/ai'

import type { WorkerContext } from './context'

/** Mois courant au format `AAAA-MM`, clé de `usage_records`. */
function periode(maintenant: Date): string {
  return `${maintenant.getUTCFullYear()}-${String(maintenant.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Lit l'état budgétaire d'une organisation.
 *
 * @returns `null` si aucun quota n'est configuré — auquel cas aucun plafond ne
 *   s'applique, et l'appelant doit le signaler plutôt que de l'ignorer.
 */
export async function lireQuota(
  ctx: WorkerContext,
  organizationId: string,
  assessmentId: string | null,
  maintenant: Date,
): Promise<QuotaState | null> {
  const lignes = (await ctx.db.execute(sql`
    SELECT
      q.monthly_budget_micro_eur           AS budget_mensuel,
      q.per_assessment_budget_micro_eur    AS budget_epreuve,
      q.suspended_at                       AS suspendu_le,
      q.suspension_reason                  AS motif,
      COALESCE(u.cost_micro_eur, 0)        AS depense_mois,
      COALESCE((
        SELECT SUM(r.cost_micro_eur)
        FROM ai_runs r
        WHERE r.organization_id = q.organization_id
          AND r.assessment_id IS NOT DISTINCT FROM ${assessmentId}::uuid
      ), 0)                                AS depense_epreuve
    FROM organization_quotas q
    LEFT JOIN usage_records u
      ON u.organization_id = q.organization_id
     AND u.period = ${periode(maintenant)}
    WHERE q.organization_id = ${organizationId}::uuid
    LIMIT 1
  `)) as unknown as Record<string, unknown>[]

  const ligne = lignes[0]
  if (!ligne) return null

  const suspendu = ligne['suspendu_le']

  return {
    organizationId,
    spentThisMonth: microEur(Number(ligne['depense_mois'])),
    monthlyBudget: microEur(Number(ligne['budget_mensuel'])),
    spentOnAssessment: microEur(Number(ligne['depense_epreuve'])),
    perAssessmentBudget: microEur(Number(ligne['budget_epreuve'])),
    suspended: suspendu !== null && suspendu !== undefined,
    suspensionReason: typeof ligne['motif'] === 'string' ? ligne['motif'] : null,
  }
}

export interface AppelÀComptabiliser {
  readonly organizationId: string
  readonly assessmentId: string | null
  readonly usage: UsageForCost & { readonly durationMs: number | null }
  readonly promptVersion: number
  /**
   * `skipped_quota` trace un appel que le coupe-circuit a refusé.
   *
   * Il coûte zéro et n'incrémente donc pas la dépense, mais il doit laisser une
   * trace : sans elle, une organisation dont le plafond bloque tout n'aurait
   * dans ses journaux que des tâches en échec, sans jamais la raison.
   */
  readonly status: 'success' | 'failed' | 'skipped_quota'
  readonly error: string | null
}

/**
 * Enregistre un appel et met à jour la consommation du mois.
 *
 * Les deux écritures sont indissociables : `ai_runs` porte le détail, dont on a
 * besoin pour recalculer et pour auditer, et `usage_records` porte le total que
 * le coupe-circuit lira avant l'appel suivant. Écrire l'un sans l'autre ferait
 * soit oublier la dépense, soit la rendre illisible sans agrégation.
 *
 * **Un appel en échec est comptabilisé lui aussi** quand il a consommé des
 * jetons : le fournisseur le facture, donc le budget doit le voir. Ne compter
 * que les succès ferait diverger le plafond de la facture.
 */
export async function comptabiliserAppel(
  ctx: WorkerContext,
  appel: AppelÀComptabiliser,
  maintenant: Date,
): Promise<MicroEur> {
  const cout = computeCost(appel.usage)

  await ctx.db.execute(sql`
    INSERT INTO ai_runs (
      organization_id, assessment_id, provider, model, task_type, prompt_version,
      page_count, input_tokens, output_tokens, cost_micro_eur, duration_ms, status, error
    ) VALUES (
      ${appel.organizationId}::uuid,
      ${appel.assessmentId}::uuid,
      ${appel.usage.provider},
      ${appel.usage.model},
      'analysis',
      ${appel.promptVersion},
      ${appel.usage.pageCount},
      ${appel.usage.inputTokens},
      ${appel.usage.outputTokens},
      ${cout},
      ${appel.usage.durationMs},
      ${appel.status},
      ${appel.error}
    )
  `)

  await ctx.db.execute(sql`
    INSERT INTO usage_records (organization_id, period, ai_call_count, cost_micro_eur)
    VALUES (${appel.organizationId}::uuid, ${periode(maintenant)}, 1, ${cout})
    ON CONFLICT (organization_id, period) DO UPDATE SET
      ai_call_count  = usage_records.ai_call_count + 1,
      cost_micro_eur = usage_records.cost_micro_eur + ${cout},
      updated_at     = now()
  `)

  return cout
}
