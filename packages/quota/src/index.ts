/**
 * @coteris/quota — coupe-circuit budgétaire et comptabilité des appels d'IA.
 *
 * POURQUOI CE PAQUET EXISTE
 *
 * Ces fonctions vivaient dans le worker, seul appelant d'un modèle. L'aide à la
 * structuration du corrigé en ouvre un second, depuis l'application web — et
 * `apps/web` ne peut pas importer `apps/worker` : aucune dépendance ne le
 * déclare, et deux applications ne se dépendent pas l'une l'autre.
 *
 * Restait à recopier le SQL. C'est exactement la divergence que ce dépôt a
 * évitée jusqu'ici : deux plafonds qui comptent différemment finiraient par
 * laisser passer ce que l'un croit avoir arrêté.
 *
 * La base est prise sous forme d'un contrat **structurel**, à la manière de
 * `JobTransaction` : le paquet ne dépend d'aucun client concret, ce qui le rend
 * appelable depuis les deux applications sans qu'aucune n'ait à connaître
 * l'autre.
 */

import { sql } from 'drizzle-orm'

import { computeCost, microEur, type MicroEur, type QuotaState, type UsageForCost } from '@coteris/ai'

/**
 * Base de données, typée structurellement.
 *
 * Ne dépend pas de la forme exacte du client, qui varie selon le pilote.
 */
export interface BaseQuota {
  execute(query: unknown): Promise<unknown>
}

/** Nature de l'appel, telle que l'attend la colonne `ai_runs.task_type`. */
export type TypeTâcheIa =
  | 'subject_extraction'
  | 'answer_key_structuring'
  | 'ocr'
  | 'segmentation'
  | 'analysis'
  | 'second_pass'
  | 'comment_generation'

/** Mois courant au format `AAAA-MM`, clé de `usage_records`. */
function periode(maintenant: Date): string {
  return `${maintenant.getUTCFullYear()}-${String(maintenant.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Lit l'état budgétaire d'une organisation.
 *
 * La consommation est lue en une ligne, pas agrégée : `usage_records` porte un
 * total par organisation et par mois, précisément pour que la vérification qui
 * précède *chaque* appel ne balaie pas des centaines de milliers de lignes.
 *
 * @returns `null` si aucun quota n'est configuré — auquel cas aucun plafond ne
 *   s'applique, et l'appelant doit le signaler plutôt que de l'ignorer.
 */
export async function lireQuota(
  db: BaseQuota,
  organizationId: string,
  assessmentId: string | null,
  maintenant: Date,
): Promise<QuotaState | null> {
  const lignes = (await db.execute(sql`
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
  /**
   * Nature de l'appel.
   *
   * Explicite, et non plus « analysis » en dur : l'énumération en compte sept, et
   * un tableau de bord de coûts qui les confondrait ne dirait plus rien de ce
   * qui coûte cher.
   */
  readonly taskType: TypeTâcheIa
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
 * le coupe-circuit lira avant l'appel suivant.
 *
 * **Un appel en échec est comptabilisé lui aussi** quand il a consommé des
 * jetons : le fournisseur le facture, donc le budget doit le voir. Ne compter
 * que les succès ferait diverger le plafond de la facture — et c'est justement
 * sur les échecs répétés que la dépense s'emballe.
 */
export async function comptabiliserAppel(
  db: BaseQuota,
  appel: AppelÀComptabiliser,
  maintenant: Date,
): Promise<MicroEur> {
  const cout = computeCost(appel.usage)

  await db.execute(sql`
    INSERT INTO ai_runs (
      organization_id, assessment_id, provider, model, task_type, prompt_version,
      page_count, input_tokens, output_tokens, cost_micro_eur, duration_ms, status, error
    ) VALUES (
      ${appel.organizationId}::uuid,
      ${appel.assessmentId}::uuid,
      ${appel.usage.provider},
      ${appel.usage.model},
      ${appel.taskType},
      ${appel.promptVersion},
      ${appel.usage.pageCount},
      ${appel.usage.inputTokens},
      ${appel.usage.outputTokens},
      ${cout},
      ${appel.usage.durationMs},
      ${appel.status},
      ${appel.error}
    )
    RETURNING id
  `)

  await db.execute(sql`
    INSERT INTO usage_records (organization_id, period, ai_call_count, cost_micro_eur)
    VALUES (${appel.organizationId}::uuid, ${periode(maintenant)}, 1, ${cout})
    ON CONFLICT (organization_id, period) DO UPDATE SET
      ai_call_count  = usage_records.ai_call_count + 1,
      cost_micro_eur = usage_records.cost_micro_eur + ${cout},
      updated_at     = now()
  `)

  return cout
}
