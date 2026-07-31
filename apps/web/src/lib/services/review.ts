/**
 * Service de validation humaine.
 *
 * Séparé des actions serveur pour une raison précise : une action serveur ne
 * s'appelle qu'à travers le protocole de Next.js, donc ne se teste pas
 * directement. La logique qui décide si une note peut changer — et qui écrit
 * l'audit — mérite mieux qu'une vérification par l'interface.
 *
 * Ce module ne dépend ni de Next.js, ni de React. Il reçoit le principal et
 * l'identifiant de l'utilisateur en paramètres.
 */

import { and, eq, sql } from 'drizzle-orm'

import { AUDIT_ACTIONS } from '@coteris/database'
import { ForbiddenError, authorize, type Principal } from '@coteris/auth'
import { appendAuditEvent, type AuditTransaction } from '@coteris/audit'

import { db, schema } from '../db'

export interface RésultatRevue {
  readonly ok: boolean
  readonly message?: string
}

export interface EntréeValidation {
  readonly decisionId: string
  /** Points attribués, en millièmes. */
  readonly points: number
  readonly reason?: string | undefined
  readonly comment?: string | undefined
  readonly requestId?: string | null | undefined
  /** Injecté par l'appelant, pour que le service reste testable. */
  readonly now: Date
  readonly auditSecret: string
}

/**
 * Valide ou modifie les points d'un critère.
 *
 * `points` égal à la proposition = acceptation ; différent = modification, et le
 * motif devient alors obligatoire — une note modifiée sans justification est
 * indéfendable devant un jury.
 */
export async function appliquerDécision(
  principal: Principal,
  userId: string,
  entrée: EntréeValidation,
): Promise<RésultatRevue> {
  try {
    // L'interface a peut-être masqué le bouton. Le serveur, lui, interdit.
    authorize(principal, 'grading', 'review')
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, message: 'Votre rôle ne permet pas de valider une correction.' }
    }
    throw error
  }

  const [décision] = await db
    .select({
      id: schema.gradingDecisions.id,
      submissionId: schema.gradingDecisions.submissionId,
      pointsPossible: schema.gradingDecisions.pointsPossible,
      pointsProposed: schema.gradingDecisions.pointsProposed,
      pointsAwarded: schema.gradingDecisions.pointsAwarded,
      criterionId: schema.gradingDecisions.rubricCriterionId,
      runId: schema.gradingDecisions.gradingRunId,
    })
    .from(schema.gradingDecisions)
    .where(
      and(
        eq(schema.gradingDecisions.id, entrée.decisionId),
        // Le cloisonnement est dans le WHERE : une décision d'une autre
        // organisation est introuvable, pas « refusée ».
        eq(schema.gradingDecisions.organizationId, principal.organizationId),
      ),
    )
    .limit(1)

  if (!décision) return { ok: false, message: 'Cette décision est introuvable.' }

  if (entrée.points < 0 || entrée.points > décision.pointsPossible) {
    return {
      ok: false,
      message: `Un critère ne peut pas dépasser sa valeur, soit ${décision.pointsPossible / 1000} point(s).`,
    }
  }

  const modifie = entrée.points !== décision.pointsProposed
  if (modifie && !entrée.reason?.trim()) {
    return {
      ok: false,
      message:
        'Un motif est requis pour s’écarter de la proposition. Une note modifiée sans ' +
        'justification est indéfendable.',
    }
  }

  const [noteGlobale] = await db
    .select({ finalizedAt: schema.grades.finalizedAt })
    .from(schema.grades)
    .where(
      and(
        eq(schema.grades.submissionId, décision.submissionId),
        sql`${schema.grades.questionId} IS NULL`,
        sql`${schema.grades.supersededAt} IS NULL`,
      ),
    )
    .limit(1)

  if (noteGlobale?.finalizedAt) {
    // Modifier une note finalisée exige une nouvelle version, pas une écriture
    // en place. Refuser explicitement vaut mieux que laisser une note officielle
    // changer sans trace de version.
    return {
      ok: false,
      message:
        'Cette note est finalisée. Sa modification exige la création d’une nouvelle version, ' +
        'non encore implémentée.',
    }
  }

  const [run] = await db
    .select({
      rubricVersionId: schema.gradingRuns.rubricVersionId,
      answerKeyVersionId: schema.gradingRuns.answerKeyVersionId,
    })
    .from(schema.gradingRuns)
    .where(eq(schema.gradingRuns.id, décision.runId))
    .limit(1)

  if (!run) return { ok: false, message: 'Les versions du barème sont introuvables.' }

  await db.transaction(async (tx) => {
    await tx
      .update(schema.gradingDecisions)
      .set({
        pointsAwarded: entrée.points,
        reviewedBy: userId,
        reviewedAt: entrée.now,
        updatedAt: entrée.now,
      })
      .where(eq(schema.gradingDecisions.id, entrée.decisionId))

    // Historique : jamais un écrasement, toujours une ligne de plus.
    await tx.insert(schema.humanReviews).values({
      organizationId: principal.organizationId,
      gradingDecisionId: entrée.decisionId,
      reviewerId: userId,
      decision: modifie ? 'modified' : 'accepted',
      pointsBefore: décision.pointsAwarded ?? décision.pointsProposed,
      pointsAfter: entrée.points,
      reason: entrée.reason ?? null,
      comment: entrée.comment ?? null,
      rubricVersionId: run.rubricVersionId,
      answerKeyVersionId: run.answerKeyVersionId,
      viaBulkValidation: false,
    })

    // Même transaction que la décision : une note modifiée dont la trace
    // manquerait — ou l'inverse — ruinerait la valeur probante du journal.
    await appendAuditEvent(
      tx as unknown as AuditTransaction,
      {
        organizationId: principal.organizationId,
        actorId: userId,
        actorRole: principal.roles[0] ?? null,
        action: modifie ? AUDIT_ACTIONS.GRADE_MODIFY : AUDIT_ACTIONS.GRADE_REVIEW,
        objectType: 'grading_decision',
        objectId: entrée.decisionId,
        previousValue: { pointsAwarded: décision.pointsAwarded },
        newValue: { pointsAwarded: entrée.points },
        reason: entrée.reason ?? null,
        metadata: { criterionId: décision.criterionId },
        requestId: entrée.requestId ?? null,
        occurredAt: entrée.now,
      },
      entrée.auditSecret,
    )
  })

  await recalculerNotes(principal.organizationId, décision.submissionId)
  return { ok: true }
}

export interface EntréeValidationGroupée {
  readonly submissionId: string
  readonly questionId: string
  readonly requestId?: string | null | undefined
  readonly now: Date
  readonly auditSecret: string
}

/**
 * Valide en une fois tous les critères d'une question restés sans décision.
 *
 * Réservé aux cas verts, comme l'exige le cahier des charges. Chaque décision
 * reste consultable individuellement, et l'action est tracée comme groupée :
 * un audit doit pouvoir distinguer une validation examinée d'une validation en
 * lot.
 */
export async function validerQuestionEnLot(
  principal: Principal,
  userId: string,
  entrée: EntréeValidationGroupée,
): Promise<RésultatRevue> {
  try {
    authorize(principal, 'grading', 'review')
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, message: 'Votre rôle ne permet pas de valider une correction.' }
    }
    throw error
  }

  const [run] = await db
    .select({
      id: schema.gradingRuns.id,
      confidenceLevel: schema.gradingRuns.confidenceLevel,
      rubricVersionId: schema.gradingRuns.rubricVersionId,
      answerKeyVersionId: schema.gradingRuns.answerKeyVersionId,
    })
    .from(schema.gradingRuns)
    .where(
      and(
        eq(schema.gradingRuns.submissionId, entrée.submissionId),
        eq(schema.gradingRuns.questionId, entrée.questionId),
        eq(schema.gradingRuns.organizationId, principal.organizationId),
      ),
    )
    .limit(1)

  if (!run) return { ok: false, message: 'Analyse introuvable pour cette question.' }

  if (run.confidenceLevel !== 'green') {
    return {
      ok: false,
      message:
        'La validation groupée est réservée aux cas à confiance élevée. Ce cas doit être ' +
        'examiné critère par critère.',
    }
  }

  const décisions = await db
    .select({
      id: schema.gradingDecisions.id,
      pointsProposed: schema.gradingDecisions.pointsProposed,
      pointsAwarded: schema.gradingDecisions.pointsAwarded,
    })
    .from(schema.gradingDecisions)
    .where(
      and(
        eq(schema.gradingDecisions.gradingRunId, run.id),
        eq(schema.gradingDecisions.organizationId, principal.organizationId),
      ),
    )

  const àValider = décisions.filter((d) => d.pointsAwarded === null)
  if (àValider.length === 0) {
    return { ok: true, message: 'Toutes les décisions étaient déjà validées.' }
  }

  await db.transaction(async (tx) => {
    for (const d of àValider) {
      await tx
        .update(schema.gradingDecisions)
        .set({
          pointsAwarded: d.pointsProposed,
          reviewedBy: userId,
          reviewedAt: entrée.now,
          updatedAt: entrée.now,
        })
        .where(eq(schema.gradingDecisions.id, d.id))

      await tx.insert(schema.humanReviews).values({
        organizationId: principal.organizationId,
        gradingDecisionId: d.id,
        reviewerId: userId,
        decision: 'accepted',
        pointsBefore: d.pointsProposed,
        pointsAfter: d.pointsProposed,
        rubricVersionId: run.rubricVersionId,
        answerKeyVersionId: run.answerKeyVersionId,
        viaBulkValidation: true,
      })
    }

    await appendAuditEvent(
      tx as unknown as AuditTransaction,
      {
        organizationId: principal.organizationId,
        actorId: userId,
        actorRole: principal.roles[0] ?? null,
        action: AUDIT_ACTIONS.GRADE_REVIEW,
        objectType: 'grading_run',
        objectId: run.id,
        newValue: { validées: àValider.length, groupée: true },
        reason: 'Validation groupée d’un cas à confiance élevée',
        requestId: entrée.requestId ?? null,
        occurredAt: entrée.now,
      },
      entrée.auditSecret,
    )
  })

  await recalculerNotes(principal.organizationId, entrée.submissionId)
  return { ok: true }
}

/**
 * Recalcule les notes d'une copie à partir des points **attribués**.
 *
 * Tant qu'un critère n'est pas validé, sa contribution retombe sur la
 * proposition : la note affichée reste donc « proposée », et devient
 * « attribuée » à mesure que l'humain tranche.
 */
export async function recalculerNotes(
  organizationId: string,
  submissionId: string,
): Promise<void> {
  await db.execute(sql`
    WITH par_question AS (
      SELECT question_id,
             SUM(COALESCE(points_awarded, points_proposed)) AS total
      FROM grading_decisions
      WHERE submission_id = ${submissionId}::uuid
        AND organization_id = ${organizationId}::uuid
      GROUP BY question_id
    )
    UPDATE grades g
    SET points_exact = pq.total, points_rounded = pq.total, updated_at = now()
    FROM par_question pq
    WHERE g.submission_id = ${submissionId}::uuid
      AND g.question_id = pq.question_id
      AND g.superseded_at IS NULL
  `)

  await db.execute(sql`
    UPDATE grades g
    SET points_exact = t.total, points_rounded = t.total, updated_at = now()
    FROM (
      SELECT SUM(points_exact) AS total FROM grades
      WHERE submission_id = ${submissionId}::uuid
        AND question_id IS NOT NULL AND superseded_at IS NULL
    ) t
    WHERE g.submission_id = ${submissionId}::uuid
      AND g.question_id IS NULL AND g.superseded_at IS NULL
  `)
}
