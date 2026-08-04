/**
 * Analyse d'une zone de réponse.
 *
 * C'est le travail central du worker : lire la réponse, l'analyser selon le
 * barème verrouillé, et enregistrer une **proposition** — jamais une note.
 *
 * Relancer la tâche produit une nouvelle analyse, pas un doublon incohérent : un
 * nouveau `grading_run` est créé et l'ancien reste consultable. C'est ce qui
 * permet de comparer deux analyses successives après correction d'une
 * transcription — et les décisions déjà validées par un humain ne sont jamais
 * écrasées, puisque le worker n'écrit que `points_proposed`.
 */

import { sql } from 'drizzle-orm'

import { appendAuditEvent, type AuditTransaction } from '@coteris/audit'
import {
  AUDIT_ACTIONS,
  gradingDecisions,
  gradingEvidence,
  gradingRuns,
} from '@coteris/database'
import { analysisRequestFor, gradeAnswer } from '@coteris/pipeline'
import { parsePayload, TASKS, type AnalyzeRegionPayload } from '@coteris/jobs'
import {
  checkQuota,
  computeCost,
  estimateUsageFor,
  QuotaExceededError,
  type OcrResult,
  type OcrWord,
} from '@coteris/ai'
import type { Millipoints } from '@coteris/shared'
import type { QuestionGradingRules, RubricCriterion } from '@coteris/grading'

import type { WorkerContext } from '../context'
import { comptabiliserAppel, lireQuota } from '../quota'

export async function analyserReponse(brut: unknown, ctx: WorkerContext): Promise<void> {
  const payload = parsePayload(TASKS.ANALYZE_REGION, brut) as AnalyzeRegionPayload

  const contexte = await chargerContexte(ctx, payload)
  if (!contexte) {
    // Zone supprimée, ou barème non verrouillé, entre la mise en file et
    // l'exécution. Ce n'est pas une erreur technique et réessayer n'y changerait
    // rien : on abandonne proprement plutôt que d'épuiser les tentatives.
    console.warn(
      `Zone ${payload.answerRegionId} sans barème verrouillé ou introuvable — tâche abandonnée.`,
    )
    return
  }

  const { question, rubric, criteres, transcription } = contexte

  const regles: QuestionGradingRules = {
    questionId: question.id as QuestionGradingRules['questionId'],
    pointsMax: question.maxPoints as Millipoints,
    allowNegative: false,
    roundingStep: null,
    missingRequiredPolicy: { kind: 'none' },
    allowBonusOverflow: false,
  }

  const formulations: Record<string, readonly string[]> = {}
  for (const c of criteres) {
    formulations[c.id] = (c.acceptableAnswers as string[] | null) ?? []
  }

  const ocr: OcrResult = {
    fullText: transcription,
    words: motsDepuisTexte(transcription, contexte.ocrConfidence),
    confidence: contexte.ocrConfidence,
    engineVersion: contexte.ocrRunId ? 'transcription-courante' : 'lecture-directe',
  }

  // --- Coupe-circuit budgétaire, AVANT l'appel ------------------------------
  //
  // Compter après ne fait que constater le dépassement de facture. L'estimation
  // surestime volontairement : un garde-fou qui sous-estime laisse passer
  // précisément ce qu'il devait arrêter.
  const maintenant = new Date()
  const entree = {
    questionPrompt: question.prompt,
    answerKeyText: contexte.answerKeyText,
    language: 'fr',
    rubricLocked: true,
    criteria: criteres.map((c) => versCritereMoteur(c, question.id)),
    acceptableAnswersByCriterion: formulations,
    questionRules: regles,
    ocr,
    forceSecondPass: payload.forceSecondPass,
  }

  const quota = await lireQuota(ctx, payload.organizationId, contexte.assessmentId, maintenant)
  if (quota === null) {
    // Une organisation sans quota configuré n'est pas bloquée : ajouter ce
    // garde-fou ne doit pas se traduire par une panne générale. Mais l'absence
    // se voit, à chaque appel.
    console.warn(
      `[quota] organisation ${payload.organizationId} sans plafond configuré — ` +
        "appel autorisé sans vérification budgétaire.",
    )
  } else {
    const estimation = estimateUsageFor(
      analysisRequestFor(entree),
      ctx.analyzer.name,
      ctx.analyzerModel,
    )
    const décision = checkQuota(quota, computeCost(estimation))
    if (!décision.allowed) {
      // Le refus laisse une trace. Sans elle, une organisation dont le plafond
      // bloque tout n'aurait dans ses journaux que des tâches en échec, sans
      // jamais la raison.
      await comptabiliserAppel(
        ctx,
        {
          organizationId: payload.organizationId,
          assessmentId: contexte.assessmentId,
          usage: {
            provider: ctx.analyzer.name,
            model: ctx.analyzerModel,
            inputTokens: null,
            outputTokens: null,
            pageCount: null,
            durationMs: null,
          },
          promptVersion: ctx.promptVersion,
          status: 'skipped_quota',
          error: décision.reason,
        },
        maintenant,
      )
      // Lever plutôt que proposer zéro : une tâche en échec se voit, un zéro
      // enregistré et scellé dans le journal d'audit passe pour une correction.
      throw new QuotaExceededError(décision)
    }
  }

  // Le chronomètre démarre AVANT l'appel. Placé après, il mesurait la durée de
  // la transaction d'écriture et non celle de la correction : avec le simulateur
  // à 8 ms personne ne s'en apercevait, avec un appel réseau de plusieurs
  // secondes la colonne aurait rapporté quelques millisecondes — au moment
  // précis où l'on cherche à mesurer la latence du fournisseur.
  const debut = Date.now()

  let resultat
  try {
    resultat = await gradeAnswer(entree, ctx.analyzer)
  } catch (erreur) {
    // Un appel qui échoue après avoir consommé des jetons est facturé par le
    // fournisseur. Ne comptabiliser que les succès ferait diverger le plafond de
    // la facture — et c'est justement sur les échecs répétés que la dépense
    // s'emballe, puisque la tâche est rejouée.
    await comptabiliserAppel(
      ctx,
      {
        organizationId: payload.organizationId,
        assessmentId: contexte.assessmentId,
        usage: {
          provider: ctx.analyzer.name,
          model: ctx.analyzerModel,
          inputTokens: null,
          outputTokens: null,
          pageCount: null,
          durationMs: Date.now() - debut,
        },
        promptVersion: ctx.promptVersion,
        status: 'failed',
        error: erreur instanceof Error ? erreur.message.slice(0, 2000) : String(erreur),
      },
      maintenant,
    )
    throw erreur
  }

  if (resultat.usage !== null) {
    await comptabiliserAppel(
      ctx,
      {
        organizationId: payload.organizationId,
        assessmentId: contexte.assessmentId,
        usage: resultat.usage,
        promptVersion: ctx.promptVersion,
        status: 'success',
        error: null,
      },
      maintenant,
    )
  }

  await ctx.db.transaction(async (tx) => {
    const [run] = await tx
      .insert(gradingRuns)
      .values({
        organizationId: payload.organizationId,
        submissionId: payload.submissionId,
        answerRegionId: contexte.regionId,
        questionId: question.id,
        rubricVersionId: rubric.versionId,
        answerKeyVersionId: rubric.answerKeyVersionId,
        transcriptionVersionId: contexte.transcriptionVersionId,
        promptVersion: ctx.promptVersion,
        pass: payload.forceSecondPass ? 'second_pass' : 'first_pass',
        unexpectedElements: resultat.analysis.unexpectedElements,
        uncertainSpans: resultat.analysis.uncertainSpans,
        needsHumanReview: true,
        confidence: resultat.confidence,
        confidenceLevel: resultat.confidenceLevel,
        totalProposed: resultat.outcome.total,
        durationMs: Date.now() - debut,
      })
      .returning()

    const runId = String((run as Record<string, unknown>)['id'])

    for (const critere of resultat.outcome.criteria) {
      const detection = [
        ...resultat.analysis.presentCriteria,
        ...resultat.analysis.partialCriteria,
      ].find((d) => d.criterionId === (critere.criterionId as string))

      const [decision] = await tx
        .insert(gradingDecisions)
        .values({
          organizationId: payload.organizationId,
          gradingRunId: runId,
          submissionId: payload.submissionId,
          questionId: question.id,
          rubricCriterionId: critere.criterionId as string,
          status: critere.status,
          contradicted: critere.contradicted,
          factuallyWrong: critere.factuallyWrong,
          matchedElementCount: detection?.matchedElementCount ?? 0,
          pointsPossible: critere.pointsPossible,
          pointsProposed: critere.pointsComputed,
          // Jamais rempli par le worker : seul un humain attribue des points.
          pointsAwarded: null,
          confidence: resultat.confidence,
          confidenceLevel: resultat.confidenceLevel,
          structuredJustification: {
            matched_elements: detection?.excerpts ?? [],
            decision:
              critere.pointsComputed === critere.pointsPossible
                ? 'full_credit'
                : critere.pointsComputed > 0
                  ? 'partial_credit'
                  : 'no_credit',
            needs_human_review: true,
          },
          appliedRules: critere.appliedRules,
          warnings: resultat.warnings,
          excluded: critere.excluded,
          deniedForMissingEvidence: critere.deniedForMissingEvidence,
        })
        .returning()

      const decisionId = String((decision as Record<string, unknown>)['id'])

      for (const [i, extrait] of (detection?.excerpts ?? []).entries()) {
        await tx.insert(gradingEvidence).values({
          organizationId: payload.organizationId,
          gradingDecisionId: decisionId,
          excerpt: extrait,
          sortOrder: i,
        })
      }
    }

    // Même transaction que la proposition : une note proposée sans trace, ou une
    // trace sans proposition, ruinerait la valeur probante du journal.
    await appendAuditEvent(
      tx as unknown as AuditTransaction,
      {
        organizationId: payload.organizationId,
        actorId: payload.requestedBy,
        action: AUDIT_ACTIONS.GRADE_PROPOSE,
        objectType: 'grading_run',
        objectId: runId,
        newValue: {
          questionId: question.id,
          totalProposed: resultat.outcome.total,
          confidenceLevel: resultat.confidenceLevel,
          promptVersion: ctx.promptVersion,
        },
        reason: payload.forceSecondPass ? 'Seconde vérification' : null,
        metadata: { ocrRunId: contexte.ocrRunId },
        occurredAt: maintenant,
      },
      ctx.auditSecret,
    )
  })

  console.log(
    `  question ${question.number} — ${resultat.outcome.total / 1000} / ` +
      `${question.maxPoints / 1000} (${resultat.confidenceLevel})`,
  )
}

// --- Chargement ----------------------------------------------------------------

interface CritereChargé {
  id: string
  label: string
  attribution: string
  maxPoints: number
  sortOrder: number
  partialRatioPercent: number
  expectedElementCount: number
  pointsPerElement: number | null
  cap: number | null
  acceptableAnswers: unknown
}

interface ContexteAnalyse {
  regionId: string
  assessmentId: string
  question: { id: string; number: string; prompt: string; maxPoints: number }
  rubric: { versionId: string; answerKeyVersionId: string }
  criteres: CritereChargé[]
  transcription: string
  ocrConfidence: number
  ocrRunId: string | null
  transcriptionVersionId: string | null
  answerKeyText: string
}

async function chargerContexte(
  ctx: WorkerContext,
  payload: AnalyzeRegionPayload,
): Promise<ContexteAnalyse | null> {
  const [base] = (await ctx.db.execute(sql`
    SELECT
      ar.id                    AS region_id,
      ar.cropped_image_key     AS image_key,
      q.id                     AS question_id,
      q.assessment_id          AS assessment_id,
      q.number,
      q.prompt,
      q.max_points,
      rv.id                    AS rubric_version_id,
      rv.answer_key_version_id
    FROM answer_regions ar
    JOIN questions q ON q.id = ar.question_id
    JOIN rubrics r ON r.assessment_id = q.assessment_id
    JOIN rubric_versions rv ON rv.rubric_id = r.id
    WHERE ar.id = ${payload.answerRegionId}::uuid
      AND ar.organization_id = ${payload.organizationId}::uuid
      -- « Aucune correction sans barème validé » : la condition est dans la
      -- requête. Sans barème verrouillé, la tâche n'a tout simplement pas d'objet.
      AND rv.locked_at IS NOT NULL
    ORDER BY rv.version_number DESC
    LIMIT 1
  `)) as unknown as Record<string, unknown>[]

  if (!base) return null

  const criteres = (await ctx.db.execute(sql`
    SELECT id, label, attribution, max_points, sort_order, partial_ratio_percent,
           expected_element_count, points_per_element, cap, acceptable_answers
    FROM rubric_criteria
    WHERE rubric_version_id = ${String(base['rubric_version_id'])}::uuid
      AND question_id = ${String(base['question_id'])}::uuid
      -- Un critère resté à l'état de brouillon n'entre jamais dans une correction.
      AND validation_status IN ('accepted', 'modified')
      AND deleted_at IS NULL
    ORDER BY sort_order
  `)) as unknown as Record<string, unknown>[]

  const [corrige] = (await ctx.db.execute(sql`
    SELECT string_agg(content, ' · ' ORDER BY sort_order) AS texte
    FROM answer_key_elements
    WHERE question_id = ${String(base['question_id'])}::uuid
      AND answer_key_version_id = ${String(base['answer_key_version_id'])}::uuid
  `)) as unknown as { texte: string | null }[]

  // Le worker préfère TOUJOURS une transcription existante à une nouvelle
  // lecture : si un correcteur l'a corrigée à la main, relancer l'OCR effacerait
  // son travail — et c'est précisément après une telle correction qu'on relance
  // l'analyse.
  const [tv] = (await ctx.db.execute(sql`
    SELECT tv.id, tv.text, tv.ocr_run_id, o.confidence
    FROM transcription_versions tv
    LEFT JOIN ocr_runs o ON o.id = tv.ocr_run_id
    WHERE tv.answer_region_id = ${payload.answerRegionId}::uuid
      AND tv.is_current = true
    ORDER BY tv.version_number DESC
    LIMIT 1
  `)) as unknown as Record<string, unknown>[]

  let transcription = tv ? String(tv['text']) : ''

  // Pas de passe OCR jointe = le texte n'a pas été LU, il a été saisi ou corrigé
  // à la main. Il n'y a donc aucune incertitude de lecture, et la confiance vaut 1.
  //
  // L'ancienne valeur de 0,9 était un plafond fantôme. Dans le calcul de
  // confiance, l'OCR est un plafond MULTIPLICATIF : avec evidenceCoverage à 1 —
  // ce qu'il vaut structurellement, le schéma imposant déjà au moins un extrait —
  // la formule se réduit à `ocr × (0,6·matchClarity + 0,4)`. À 0,9, même une
  // netteté parfaite plafonne à 0,900 et une netteté de 0,99 tombe à 0,895 :
  // le seuil vert de 90 % devenait inatteignable sauf à renvoyer exactement 1,0.
  // Autrement dit, sur des réponses saisies, un fournisseur honnête envoyait
  // TOUTES les copies en relecture attentive, et seul un fournisseur
  // systématiquement optimiste produisait du vert.
  let ocrConfidence =
    tv?.['confidence'] === null || tv?.['confidence'] === undefined
      ? 1
      : Number(tv['confidence'])
  const ocrRunId = tv?.['ocr_run_id'] ? String(tv['ocr_run_id']) : null
  const transcriptionVersionId = tv ? String(tv['id']) : null

  // Aucune transcription mais une image disponible : on lit la copie.
  if (!tv && base['image_key']) {
    const cle = String(base['image_key'])
    const objet = await ctx.storage.get(cle)
    if (objet) {
      const { result } = await ctx.ocr.transcribe({
        key: cle,
        bytes: objet.bytes,
        mimeType: objet.contentType,
        widthPx: 0,
        heightPx: 0,
      })
      transcription = result.fullText
      ocrConfidence = result.confidence
    }
  }

  return {
    regionId: String(base['region_id']),
    assessmentId: String(base['assessment_id']),
    question: {
      id: String(base['question_id']),
      number: String(base['number']),
      prompt: String(base['prompt']),
      maxPoints: Number(base['max_points']),
    },
    rubric: {
      versionId: String(base['rubric_version_id']),
      answerKeyVersionId: String(base['answer_key_version_id']),
    },
    criteres: criteres.map((c) => ({
      id: String(c['id']),
      label: String(c['label']),
      attribution: String(c['attribution']),
      maxPoints: Number(c['max_points']),
      sortOrder: Number(c['sort_order']),
      partialRatioPercent: Number(c['partial_ratio_percent']),
      expectedElementCount: Number(c['expected_element_count']),
      pointsPerElement:
        c['points_per_element'] === null || c['points_per_element'] === undefined
          ? null
          : Number(c['points_per_element']),
      cap: c['cap'] === null || c['cap'] === undefined ? null : Number(c['cap']),
      acceptableAnswers: c['acceptable_answers'],
    })),
    transcription,
    ocrConfidence,
    ocrRunId,
    transcriptionVersionId,
    answerKeyText: corrige?.texte ?? '',
  }
}

function versCritereMoteur(c: CritereChargé, questionId: string): RubricCriterion {
  return {
    id: c.id as RubricCriterion['id'],
    questionId: questionId as RubricCriterion['questionId'],
    label: c.label,
    attribution: c.attribution as RubricCriterion['attribution'],
    pointsMax: c.maxPoints as Millipoints,
    order: c.sortOrder,
    required: false,
    partialRatioPercent: c.partialRatioPercent,
    expectedElementCount: c.expectedElementCount,
    pointsPerElement: c.pointsPerElement as Millipoints | null,
    cap: c.cap as Millipoints | null,
    contradictionPolicy: { kind: 'ignore' },
    factualErrorPenalty: null,
    excludedBy: [],
  }
}

/**
 * Reconstruit des mots avec leurs positions depuis un texte.
 *
 * Utilisé quand l'analyse repart d'une transcription corrigée à la main : il n'y
 * a plus de découpage OCR, mais le pipeline a besoin d'une structure de mots pour
 * repérer les passages incertains.
 */
function motsDepuisTexte(texte: string, confiance: number): OcrWord[] {
  const mots: OcrWord[] = []
  const motif = /\S+/g
  let m: RegExpExecArray | null
  while ((m = motif.exec(texte)) !== null) {
    mots.push({
      text: m[0],
      startOffset: m.index,
      endOffset: m.index + m[0].length,
      confidence: confiance,
      alternatives: [],
    })
  }
  return mots
}
