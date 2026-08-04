/**
 * Pipeline de correction d'une réponse.
 *
 * C'est ici que se rejoignent les trois briques : le fournisseur d'IA identifie
 * des états, la validation vérifie les preuves, le moteur déterministe calcule les
 * points. Aucune de ces responsabilités ne déborde sur les autres.
 *
 * Le pipeline est **explicite, observable et testable** : chaque étape produit une
 * trace, et l'ensemble s'exécute sans base de données ni réseau — les entrées sont
 * passées en paramètres, la sortie est une structure de données.
 *
 * Les étapes suivent la section 19 du cahier des charges :
 *   1. préparation      4. calcul des points
 *   2. contrôle de lisibilité   5. niveau de confiance
 *   3. analyse structurée       6. vérification sélective   7. proposition
 */

import {
  computeConfidence,
  confidenceScore,
  levelFor,
  requiresCarefulReview,
  type ConfidenceLevel,
  type ConfidenceScore,
  type ConfidenceThresholds,
  DEFAULT_THRESHOLDS,
} from '@coteris/shared'
import {
  gradeQuestion,
  type CriterionAssessment,
  type QuestionGradingRules,
  type QuestionOutcome,
  type RubricCriterion,
} from '@coteris/grading'
import {
  AnalysisValidationError,
  analysisResultSchema,
  inconclusiveAnalysis,
  validateCriteriaScope,
  validateEvidence,
  type AnalysisRequest,
  type AnalysisResult,
  type OcrResult,
  type ProviderUsage,
  type TextAnalysisProvider,
} from '@coteris/ai'

export interface GradeAnswerInput {
  readonly questionPrompt: string
  readonly answerKeyText: string
  readonly language: string
  /** Barème verrouillé. Le pipeline refuse de s'exécuter sans verrouillage. */
  readonly rubricLocked: boolean
  readonly criteria: readonly RubricCriterion[]
  /** Formulations acceptables par critère, transmises au modèle. */
  readonly acceptableAnswersByCriterion: Readonly<Record<string, readonly string[]>>
  readonly questionRules: QuestionGradingRules
  readonly ocr: OcrResult
  readonly thresholds?: ConfidenceThresholds
  /** Confiance OCR en deçà de laquelle on n'analyse même pas. */
  readonly minimumOcrConfidence?: number
  /**
   * Force une seconde vérification, même sur un cas vert.
   *
   * C'est par ce paramètre que passe l'échantillonnage aléatoire de contrôle
   * qualité : le tirage a lieu chez l'appelant, pour que ce module reste
   * déterministe et donc testable à l'identique.
   */
  readonly forceSecondPass?: boolean
}

export interface PipelineStep {
  readonly step: string
  readonly detail: string
}

export interface GradeAnswerOutcome {
  readonly outcome: QuestionOutcome
  readonly analysis: AnalysisResult
  readonly confidence: ConfidenceScore
  readonly confidenceLevel: ConfidenceLevel
  /** Toute note exige une validation humaine ; ceci signale les cas à examiner de près. */
  readonly needsCarefulReview: boolean
  /** Vrai si une seconde analyse est justifiée. Jamais systématique. */
  readonly needsSecondPass: boolean
  readonly warnings: readonly string[]
  readonly steps: readonly PipelineStep[]
  /**
   * Consommation rapportée par le fournisseur, ou `null` si aucun appel n'a eu
   * lieu — copie blanche, transcription trop douteuse.
   *
   * Sans elle, jetons, durée et modèle sont perdus dès la déstructuration, et le
   * coût par copie — l'un des critères de décision du banc d'essai — ne peut pas
   * être calculé. Un rapport qui annonce 0 € pour un modèle facturé est un
   * chiffre faux mais crédible.
   */
  readonly usage: ProviderUsage | null
}

export class RubricNotLockedError extends Error {
  constructor() {
    super(
      "Aucune correction n'est possible sans barème validé et verrouillé. " +
        "C'est un principe du produit, pas une vérification de confort.",
    )
    this.name = 'RubricNotLockedError'
  }
}

const DEFAULT_MIN_OCR_CONFIDENCE = 0.4

/**
 * Corrige une réponse et produit une proposition justifiée.
 *
 * @param analyzer Fournisseur d'analyse. En test et par défaut, le simulateur.
 */
export async function gradeAnswer(
  input: GradeAnswerInput,
  analyzer: TextAnalysisProvider,
): Promise<GradeAnswerOutcome> {
  const steps: PipelineStep[] = []
  const warnings: string[] = []

  // --- Étape 1 : préparation ------------------------------------------------
  if (!input.rubricLocked) throw new RubricNotLockedError()

  const criterionIds = input.criteria.map((c) => c.id as string)
  steps.push({
    step: 'preparation',
    detail: `${input.criteria.length} critère(s) du barème verrouillé, transcription de ${input.ocr.fullText.length} caractères.`,
  })

  // --- Étape 2 : contrôle de lisibilité -------------------------------------
  const minOcr = input.minimumOcrConfidence ?? DEFAULT_MIN_OCR_CONFIDENCE
  const motsIncertains = input.ocr.words.filter((w) => w.confidence < 0.6)
  const transcriptionVide = input.ocr.fullText.trim().length === 0

  if (transcriptionVide) {
    steps.push({ step: 'readability', detail: 'Transcription vide : copie blanche ou zone illisible.' })
    return inconclusive(input, criterionIds, steps, [
      "La zone de réponse ne contient aucun texte lisible. Aucun point n'est proposé.",
    ])
  }

  if (input.ocr.confidence < minOcr) {
    // On n'invente pas. Une transcription trop douteuse ne donne lieu à aucune
    // proposition : le cas part directement en validation humaine.
    steps.push({
      step: 'readability',
      detail: `Confiance OCR de ${(input.ocr.confidence * 100).toFixed(0)} %, en deçà du seuil de ${(minOcr * 100).toFixed(0)} %. Analyse non lancée.`,
    })
    return inconclusive(input, criterionIds, steps, [
      'La transcription est trop incertaine pour proposer des points. Une relecture humaine est requise.',
    ])
  }

  if (motsIncertains.length > 0) {
    warnings.push(
      `${motsIncertains.length} mot(s) lus avec une confiance faible : ` +
        motsIncertains
          .slice(0, 5)
          .map((w) => `« ${w.text} »`)
          .join(', ') +
        (motsIncertains.length > 5 ? '…' : ''),
    )
  }

  steps.push({
    step: 'readability',
    detail: `Confiance OCR de ${(input.ocr.confidence * 100).toFixed(0)} %, ${motsIncertains.length} mot(s) incertain(s).`,
  })

  // --- Étape 3 : analyse structurée -----------------------------------------
  const request: AnalysisRequest = {
    questionPrompt: input.questionPrompt,
    answerKeyText: input.answerKeyText,
    language: input.language,
    transcription: input.ocr.fullText,
    criteria: input.criteria.map((c) => ({
      id: c.id as string,
      label: c.label,
      description: null,
      acceptableAnswers: input.acceptableAnswersByCriterion[c.id as string] ?? [],
      expectedElementCount: c.expectedElementCount,
    })),
  }

  const { result: brut, usage } = await analyzer.analyze(request)

  const parsed = analysisResultSchema.safeParse(brut)
  if (!parsed.success) {
    // Le détail de l'échec est journalisé : sans lui, on sait que l'analyse a
    // été rejetée mais pas quel champ a fauté, et l'invite reste incorrigeable
    // à partir de la production.
    const défauts = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || 'racine'} : ${i.message}`)
    steps.push({
      step: 'analysis',
      detail: `Sortie du modèle non conforme au schéma — ${défauts.join(' ; ')}`,
    })
    return inconclusive(input, criterionIds, steps, [
      "L'analyse produite n'est pas exploitable. Une correction manuelle est requise.",
    ], usage)
  }

  const analysis = parsed.data

  try {
    // Les deux barrières : preuves réellement présentes dans la copie, et
    // critères appartenant au barème verrouillé.
    validateEvidence(analysis, input.ocr.fullText)
    validateCriteriaScope(analysis, criterionIds)
  } catch (error) {
    const problèmes = error instanceof AnalysisValidationError ? error.problems : []
    steps.push({
      step: 'analysis',
      detail: `Analyse rejetée : ${problèmes.length} problème(s) de preuve ou de périmètre.`,
    })
    return inconclusive(input, criterionIds, steps, [
      "Les justifications produites ne correspondent pas au contenu de la copie. " +
        'Aucun point ne peut être proposé sur cette base.',
      ...problèmes.slice(0, 3),
    ])
  }

  steps.push({
    step: 'analysis',
    detail:
      `${analysis.presentCriteria.length} présent(s), ${analysis.partialCriteria.length} partiel(s), ` +
      `${analysis.missingCriteria.length} absent(s), ${analysis.contradictions.length} contradiction(s).`,
  })

  // --- Étape 4 : calcul déterministe des points -----------------------------
  const assessments = toAssessments(analysis, input.criteria)
  const outcome = gradeQuestion(input.questionRules, input.criteria, assessments)

  steps.push({
    step: 'scoring',
    detail: `Moteur déterministe : ${outcome.total} millièmes sur ${outcome.pointsMax}.`,
  })

  // --- Étape 5 : niveau de confiance ----------------------------------------
  const évaluésAvecPreuve = [...analysis.presentCriteria, ...analysis.partialCriteria]
  const evidenceCoverage =
    évaluésAvecPreuve.length === 0
      ? 1
      : évaluésAvecPreuve.filter((d) => d.excerpts.length > 0).length / évaluésAvecPreuve.length

  const confidence = computeConfidence(
    {
      ocr: input.ocr.confidence,
      criteriaMatch: analysis.matchClarity,
      evidenceCoverage,
    },
    {
      hasUncertainSpans: analysis.uncertainSpans.length > 0 || motsIncertains.length > 0,
      hasContradiction: analysis.contradictions.length > 0,
      hasUnexpectedElement: analysis.unexpectedElements.length > 0,
      analysesDisagree: false,
    },
  )

  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS
  const confidenceLevel = levelFor(confidence, thresholds)

  steps.push({
    step: 'confidence',
    detail: `Confiance de ${(confidence * 100).toFixed(0)} % — niveau ${confidenceLevel}.`,
  })

  // --- Étape 6 : faut-il une seconde vérification ? -------------------------
  //
  // Jamais systématique : une double analyse sur chaque réponse doublerait le
  // coût pour un gain nul sur les cas nets.
  //
  // La proximité d'un « seuil important » ne se juge PAS ici. Une question notée
  // 0,5 sur 1 n'est proche d'aucun seuil signifiant : les seuils qui comptent —
  // la moyenne, la barre d'admission — portent sur la copie entière. Appliquer
  // ce critère par question enverrait en seconde analyse payante toute réponse à
  // demi-points, c'est-à-dire une grande partie de l'épreuve. Cette décision
  // revient à l'orchestrateur, qui voit le total de la copie.
  //
  // L'échantillonnage aléatoire de cas verts n'est pas décidé ici non plus : ce
  // module doit rester déterministe. L'appelant le demande via `forceSecondPass`.
  const needsSecondPass =
    input.forceSecondPass === true ||
    confidenceLevel !== 'green' ||
    analysis.unexpectedElements.length > 0

  if (analysis.unexpectedElements.length > 0) {
    warnings.push(
      `${analysis.unexpectedElements.length} élément(s) correct(s) repéré(s) mais absent(s) du corrigé. ` +
        'Le correcteur doit trancher.',
    )
  }

  const critèresSansPreuve = outcome.criteria.filter((c) => c.deniedForMissingEvidence)
  if (critèresSansPreuve.length > 0) {
    warnings.push(
      `${critèresSansPreuve.length} critère(s) laissé(s) à zéro faute d'extrait justificatif.`,
    )
  }

  steps.push({
    step: 'second_pass',
    detail: needsSecondPass
      ? 'Seconde vérification justifiée.'
      : 'Cas net : pas de seconde analyse, pas de coût supplémentaire.',
  })

  return {
    outcome,
    analysis,
    confidence,
    confidenceLevel,
    needsCarefulReview: requiresCarefulReview(confidenceLevel, {
      hasUnexpectedElement: analysis.unexpectedElements.length > 0,
      analysesDisagree: false,
    }),
    needsSecondPass,
    warnings,
    steps,
    usage,
  }
}

/** Traduit la sortie du modèle en états attendus par le moteur de barème. */
function toAssessments(
  analysis: AnalysisResult,
  criteria: readonly RubricCriterion[],
): CriterionAssessment[] {
  const contredits = new Set(analysis.contradictions.map((c) => c.criterionId))
  const erronés = new Set(analysis.factualErrors.map((f) => f.criterionId))

  const build = (
    criterionId: string,
    status: 'present' | 'partial' | 'absent',
    excerpts: readonly string[],
    matchedElementCount: number,
  ): CriterionAssessment => ({
    criterionId: criterionId as CriterionAssessment['criterionId'],
    status,
    contradicted: contredits.has(criterionId),
    factuallyWrong: erronés.has(criterionId),
    matchedElementCount,
    manualPoints: null,
    evidence: [...excerpts],
  })

  const assessments: CriterionAssessment[] = []

  for (const d of analysis.presentCriteria) {
    assessments.push(build(d.criterionId, 'present', d.excerpts, d.matchedElementCount ?? 1))
  }
  for (const d of analysis.partialCriteria) {
    assessments.push(build(d.criterionId, 'partial', d.excerpts, d.matchedElementCount ?? 0))
  }
  for (const id of analysis.missingCriteria) {
    assessments.push(build(id, 'absent', [], 0))
  }

  // Un critère que le modèle aurait omis est traité comme absent, jamais ignoré.
  const couverts = new Set(assessments.map((a) => a.criterionId as string))
  for (const criterion of criteria) {
    if (!couverts.has(criterion.id as string)) {
      assessments.push(build(criterion.id as string, 'absent', [], 0))
    }
  }

  return assessments
}

/**
 * Sortie sans proposition de points, quand rien de fiable ne peut être conclu.
 *
 * @param usage Consommation de l'appel qui a mené ici, s'il a eu lieu. Un rejet
 *   après appel a bel et bien coûté de l'argent : le passer sous silence ferait
 *   sous-estimer le coût réel d'exactement les cas les plus problématiques.
 */
function inconclusive(
  input: GradeAnswerInput,
  criterionIds: readonly string[],
  steps: PipelineStep[],
  warnings: string[],
  usage: ProviderUsage | null = null,
): GradeAnswerOutcome {
  const analysis = inconclusiveAnalysis(criterionIds)
  const assessments = toAssessments(analysis, input.criteria)
  const outcome = gradeQuestion(input.questionRules, input.criteria, assessments)

  return {
    outcome,
    analysis,
    confidence: confidenceScore(0),
    confidenceLevel: 'red',
    needsCarefulReview: true,
    needsSecondPass: false,
    warnings,
    steps,
    usage,
  }
}
