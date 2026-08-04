/**
 * Production du corrigé annoté remis à l'étudiant.
 *
 * Ce document sort de l'établissement. Il ne peut donc être produit que sur une
 * copie **entièrement validée par un humain** — et « entièrement » demande à être
 * défini avec soin, parce que trois manières plausibles de le faire sont fausses.
 *
 * LE PRÉDICAT, ET LES TROIS PIÈGES QU'IL ÉVITE
 *
 * 1. **Ne pas se restreindre à la dernière analyse.** Une copie ré-analysée —
 *    après correction d'une transcription — porte les décisions de plusieurs
 *    exécutions. Les mélanger ferait additionner deux fois les mêmes points.
 *
 * 2. **Ne pas vérifier que toutes les questions sont couvertes.** Une question
 *    jamais analysée ne produit AUCUNE décision : elle ne contredit donc aucun
 *    contrôle portant sur les décisions existantes. Le document afficherait un
 *    total incomplet en le présentant comme définitif.
 *
 * 3. **Lire la note dans la table des notes.** Elle n'est alimentée que par les
 *    données de démonstration : en exploitation, elle est vide. Le total est
 *    recalculé ici par somme des points ATTRIBUÉS — jamais des points proposés,
 *    qui viennent du modèle.
 */

import { sql } from 'drizzle-orm'

import { AUDIT_ACTIONS } from '@coteris/database'
import { ForbiddenError, authorize, type Principal } from '@coteris/auth'
import { appendAuditEvent, type AuditTransaction } from '@coteris/audit'
import {
  construireCorrigéAnnoté,
  contentTypeForFileName,
  exportFileName,
  type CorrigéAnnoté,
  type CritèreCorrigé,
  type QuestionCorrigée,
} from '@coteris/exports'
import { storageKey } from '@coteris/storage'

import { db, schema } from '../db'
import { assertServerOnly } from '../server-guard'
import { storage } from '../storage'

assertServerOnly('services/corrige-annote')

export interface EntréeCorrigéAnnoté {
  readonly submissionId: string
  readonly now: Date
  readonly auditSecret: string
  readonly requestId?: string | null | undefined
}

export interface RésultatCorrigéAnnoté {
  readonly ok: boolean
  readonly exportId?: string
  readonly fileName?: string
  readonly message?: string
  /** Substitutions de caractères appliquées, à afficher au correcteur. */
  readonly substitutions?: number
}

export async function créerCorrigéAnnoté(
  principal: Principal,
  userId: string,
  entrée: EntréeCorrigéAnnoté,
): Promise<RésultatCorrigéAnnoté> {
  try {
    authorize(principal, 'export', 'create')
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, message: 'Votre rôle ne permet pas de produire un corrigé annoté.' }
    }
    throw error
  }

  const [copie] = (await db.execute(sql`
    SELECT s.id, s.anonymous_code, s.assessment_id, a.title
    FROM submissions s
    JOIN assessments a ON a.id = s.assessment_id
    WHERE s.id = ${entrée.submissionId}::uuid
      AND s.organization_id = ${principal.organizationId}::uuid
      AND s.deleted_at IS NULL
  `)) as unknown as Record<string, unknown>[]

  if (!copie) return { ok: false, message: 'Copie introuvable.' }

  const assessmentId = String(copie['assessment_id'])
  const titre = String(copie['title'])

  const refus = await contrôlerValidationComplète(
    principal.organizationId,
    entrée.submissionId,
    assessmentId,
  )
  if (refus !== null) return { ok: false, message: refus }

  const données = await chargerCorrigé(
    principal.organizationId,
    entrée.submissionId,
    assessmentId,
    titre,
    String(copie['anonymous_code']),
    entrée.now,
  )

  const { pdf, substitutions } = await construireCorrigéAnnoté(données)

  const fileName = exportFileName(titre, `corrige-${données.codeCopie}`, entrée.now, 'pdf')
  const key = storageKey(principal.organizationId, [
    'exports',
    `${entrée.submissionId}-corrige-${entrée.now.getTime()}.pdf`,
  ])

  await storage().put(key, pdf, { contentType: contentTypeForFileName(fileName) })

  let exportId = ''

  await db.transaction(async (tx) => {
    const [ligne] = await tx
      .insert(schema.exportJobs)
      .values({
        organizationId: principal.organizationId,
        assessmentId,
        kind: 'pdf_corrected',
        status: 'ready',
        fileKey: key,
        fileName,
        parameters: { submissionId: entrée.submissionId, substitutions },
        requestedBy: userId,
        completedAt: entrée.now,
        expiresAt: new Date(entrée.now.getTime() + 30 * 24 * 3600 * 1000),
      })
      .returning()

    exportId = String((ligne as Record<string, unknown>)['id'])

    await appendAuditEvent(
      tx as unknown as AuditTransaction,
      {
        organizationId: principal.organizationId,
        actorId: userId,
        actorRole: principal.roles[0] ?? null,
        action: AUDIT_ACTIONS.EXPORT_CREATE,
        objectType: 'export',
        objectId: exportId,
        newValue: { genre: 'corrige_annote', submissionId: entrée.submissionId, fileName },
        requestId: entrée.requestId ?? null,
        occurredAt: entrée.now,
      },
      entrée.auditSecret,
    )
  })

  return { ok: true, exportId, fileName, substitutions }
}

// --- Le prédicat -------------------------------------------------------------

/**
 * Vérifie qu'une copie est entièrement validée.
 *
 * @returns `null` si le document peut être produit, sinon le motif du refus, en
 *   français et adressé au correcteur. Un refus explicite vaut mieux qu'un
 *   document partiel : celui-ci partirait chez l'étudiant.
 */
async function contrôlerValidationComplète(
  organizationId: string,
  submissionId: string,
  assessmentId: string,
): Promise<string | null> {
  const [état] = (await db.execute(sql`
    WITH questions_epreuve AS (
      SELECT id FROM questions
      WHERE assessment_id = ${assessmentId}::uuid
        AND organization_id = ${organizationId}::uuid
        AND deleted_at IS NULL
    ),
    -- Décisions de la DERNIÈRE analyse de chaque question, et d'elle seule.
    decisions_courantes AS (
      SELECT d.question_id, d.points_awarded
      FROM grading_decisions d
      WHERE d.submission_id = ${submissionId}::uuid
        AND d.organization_id = ${organizationId}::uuid
        AND d.grading_run_id = (
          SELECT gr.id FROM grading_runs gr
          WHERE gr.question_id = d.question_id AND gr.submission_id = d.submission_id
          ORDER BY gr.created_at DESC LIMIT 1
        )
    )
    SELECT
      (SELECT count(*) FROM questions_epreuve)                              AS questions,
      (SELECT count(DISTINCT question_id) FROM decisions_courantes)         AS questions_corrigees,
      (SELECT count(*) FROM decisions_courantes)                            AS decisions,
      (SELECT count(*) FROM decisions_courantes WHERE points_awarded IS NULL) AS non_validees
  `)) as unknown as Record<string, unknown>[]

  if (!état) return 'Impossible de vérifier l’état de la copie.'

  const questions = Number(état['questions'])
  const corrigées = Number(état['questions_corrigees'])
  const décisions = Number(état['decisions'])
  const nonValidées = Number(état['non_validees'])

  if (questions === 0) return 'Cette épreuve ne comporte aucune question.'
  if (décisions === 0) return 'Cette copie n’a pas encore été analysée.'

  if (corrigées < questions) {
    // Le piège central : une question jamais analysée ne produit aucune
    // décision, donc ne fait échouer aucun contrôle portant sur les décisions.
    return (
      `${questions - corrigées} question(s) sur ${questions} n’ont pas encore été ` +
      `analysées. Un corrigé produit maintenant afficherait un total incomplet ` +
      `en le présentant comme définitif.`
    )
  }

  if (nonValidées > 0) {
    return (
      `${nonValidées} décision(s) n’ont pas encore été validées par un correcteur. ` +
      `Le corrigé ne reprend que des points attribués par un humain.`
    )
  }

  return null
}

// --- Assemblage --------------------------------------------------------------

async function chargerCorrigé(
  organizationId: string,
  submissionId: string,
  assessmentId: string,
  titre: string,
  codeCopie: string,
  maintenant: Date,
): Promise<CorrigéAnnoté> {
  const questions = (await db.execute(sql`
    SELECT id, number, prompt, max_points
    FROM questions
    WHERE assessment_id = ${assessmentId}::uuid
      AND organization_id = ${organizationId}::uuid
      AND deleted_at IS NULL
    ORDER BY sort_order
  `)) as unknown as Record<string, unknown>[]

  const décisions = (await db.execute(sql`
    SELECT
      d.question_id,
      rc.label,
      rc.sort_order,
      d.points_possible,
      d.points_awarded,
      d.denied_for_missing_evidence,
      d.excluded,
      COALESCE(
        (SELECT json_agg(e.excerpt ORDER BY e.sort_order)
         FROM grading_evidence e WHERE e.grading_decision_id = d.id),
        '[]'::json
      ) AS evidence
    FROM grading_decisions d
    JOIN rubric_criteria rc ON rc.id = d.rubric_criterion_id
    WHERE d.submission_id = ${submissionId}::uuid
      AND d.organization_id = ${organizationId}::uuid
      AND d.grading_run_id = (
        SELECT gr.id FROM grading_runs gr
        WHERE gr.question_id = d.question_id AND gr.submission_id = d.submission_id
        ORDER BY gr.created_at DESC LIMIT 1
      )
    ORDER BY rc.sort_order
  `)) as unknown as Record<string, unknown>[]

  const parQuestion = new Map<string, CritèreCorrigé[]>()
  for (const d of décisions) {
    const clé = String(d['question_id'])
    const liste = parQuestion.get(clé) ?? []
    liste.push({
      intitulé: String(d['label']),
      pointsObtenus: Number(d['points_awarded'] ?? 0),
      pointsPossibles: Number(d['points_possible']),
      extraits: (d['evidence'] as string[] | null) ?? [],
      refuséFauteDePreuve: Boolean(d['denied_for_missing_evidence']),
      exclu: Boolean(d['excluded']),
    })
    parQuestion.set(clé, liste)
  }

  const questionsCorrigées: QuestionCorrigée[] = questions.map((q) => {
    const critères = parQuestion.get(String(q['id'])) ?? []
    return {
      numéro: String(q['number']),
      énoncé: String(q['prompt']),
      // Somme des points ATTRIBUÉS. Jamais la table des notes, vide en
      // exploitation, ni les points proposés, qui viennent du modèle.
      pointsObtenus: critères.reduce((s, c) => s + c.pointsObtenus, 0),
      pointsMax: Number(q['max_points']),
      critères,
    }
  })

  return {
    titreÉpreuve: titre,
    codeCopie,
    datePublication: maintenant,
    total: questionsCorrigées.reduce((s, q) => s + q.pointsObtenus, 0),
    totalMax: questionsCorrigées.reduce((s, q) => s + q.pointsMax, 0),
    questions: questionsCorrigées,
  }
}
