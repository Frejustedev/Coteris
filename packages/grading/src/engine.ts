/**
 * Moteur de barème déterministe.
 *
 * Aucune I/O, aucun réseau, aucune horloge, aucun aléa — la règle est imposée par
 * ESLint (voir eslint.config.js). Deux exécutions sur les mêmes entrées produisent
 * exactement le même résultat, aujourd'hui et dans dix ans.
 *
 * Chaque opération qui modifie une valeur laisse une trace `AppliedRule`. Un
 * enseignant peut donc voir non seulement combien de points ont été proposés,
 * mais pourquoi — et un jury peut refaire le calcul à la main.
 */

import {
  ZERO,
  add,
  clamp,
  distribute,
  fromMillipoints,
  formatPoints,
  max as maxOf,
  min as minOf,
  percentOf,
  roundToStep,
  subtract,
  sum,
  times,
  type Millipoints,
} from '@coteris/shared'

import {
  GradingError,
  type AppliedRule,
  type CriterionAssessment,
  type CriterionOutcome,
  type QuestionGradingRules,
  type QuestionOutcome,
  type RubricCriterion,
} from './types'

const NEGATIVE_INFINITY_POINTS = fromMillipoints(Number.MIN_SAFE_INTEGER)
const POSITIVE_INFINITY_POINTS = fromMillipoints(Number.MAX_SAFE_INTEGER)

/** Accumule les traces d'un calcul. */
class RuleTrace {
  private readonly entries: AppliedRule[] = []

  record(rule: string, detail: string, before: Millipoints, after: Millipoints): Millipoints {
    if (before !== after) {
      this.entries.push({ rule, detail, before, after })
    }
    return after
  }

  /** Enregistre une règle même sans effet sur la valeur, quand le fait est notable. */
  note(rule: string, detail: string, value: Millipoints): void {
    this.entries.push({ rule, detail, before: value, after: value })
  }

  all(): readonly AppliedRule[] {
    return [...this.entries]
  }
}

/**
 * Un état autre qu'« absent » doit s'appuyer sur au moins un extrait de la réponse.
 *
 * L'attribution manuelle en est dispensée : c'est un humain qui décide, et son
 * motif est enregistré ailleurs, dans `human_reviews`.
 */
function needsEvidence(assessment: CriterionAssessment, criterion: RubricCriterion): boolean {
  if (criterion.attribution === 'manual') return false
  return (
    assessment.status !== 'absent' || assessment.contradicted || assessment.factuallyWrong
  )
}

function effectiveCap(criterion: RubricCriterion): Millipoints {
  return criterion.cap ?? criterion.pointsMax
}

/** Points bruts avant contradictions, erreurs factuelles et plafonds. */
function basePoints(
  criterion: RubricCriterion,
  assessment: CriterionAssessment,
  trace: RuleTrace,
): Millipoints {
  const { attribution, pointsMax, partialRatioPercent } = criterion
  const { status } = assessment

  switch (attribution) {
    case 'all_or_nothing': {
      if (status === 'present') {
        trace.note('all_or_nothing.full', 'Critère présent : points entiers.', pointsMax)
        return pointsMax
      }
      if (status === 'partial') {
        trace.note(
          'all_or_nothing.partial_denied',
          "Critère en tout ou rien : une réponse partielle ne rapporte rien.",
          ZERO,
        )
      }
      return ZERO
    }

    case 'partial': {
      if (status === 'present') return pointsMax
      if (status === 'partial') {
        const value = percentOf(pointsMax, partialRatioPercent)
        trace.note(
          'partial.ratio',
          `Réponse partielle : ${partialRatioPercent} % de ${formatPoints(pointsMax)} point(s).`,
          value,
        )
        return value
      }
      return ZERO
    }

    case 'per_element': {
      if (status === 'absent') return ZERO
      return perElementPoints(criterion, assessment, trace)
    }

    case 'manual': {
      if (assessment.manualPoints === null) {
        throw new GradingError(
          `Le critère « ${criterion.label} » est en notation manuelle mais aucune valeur ` +
            `n'a été fournie. Le moteur ne devine pas une note.`,
        )
      }
      return assessment.manualPoints
    }

    case 'bonus': {
      if (status === 'present') return pointsMax
      if (status === 'partial') return percentOf(pointsMax, partialRatioPercent)
      return ZERO
    }

    case 'penalty': {
      // `pointsMax` est stocké positif ; le moteur le retranche.
      if (status === 'present') return subtract(ZERO, pointsMax)
      if (status === 'partial') return subtract(ZERO, percentOf(pointsMax, partialRatioPercent))
      return ZERO
    }
  }
}

function perElementPoints(
  criterion: RubricCriterion,
  assessment: CriterionAssessment,
  trace: RuleTrace,
): Millipoints {
  const expected = criterion.expectedElementCount
  if (expected <= 0) {
    throw new GradingError(
      `Le critère « ${criterion.label} » est en points par élément mais n'attend aucun élément.`,
    )
  }

  const raw = assessment.matchedElementCount
  if (!Number.isInteger(raw) || raw < 0) {
    throw new GradingError(
      `Nombre d'éléments identifiés invalide pour « ${criterion.label} » : ${raw}.`,
    )
  }

  const matched = Math.min(raw, expected)
  if (matched < raw) {
    trace.note(
      'per_element.excess_ignored',
      `${raw} éléments identifiés pour ${expected} attendus : le surplus est ignoré.`,
      ZERO,
    )
  }

  if (criterion.pointsPerElement !== null) {
    const value = times(criterion.pointsPerElement, matched)
    trace.note(
      'per_element.fixed_rate',
      `${matched} élément(s) × ${formatPoints(criterion.pointsPerElement)} point(s).`,
      value,
    )
    return value
  }

  // Sans taux fixe, la valeur du critère est répartie exactement entre les
  // éléments attendus. `distribute` garantit que citer tous les éléments rapporte
  // le critère entier, sans perte d'un millième sur une division non entière.
  const parts = distribute(criterion.pointsMax, expected)
  const value = sum(parts.slice(0, matched))
  trace.note(
    'per_element.distributed',
    `${matched} élément(s) sur ${expected}, répartition exacte de ` +
      `${formatPoints(criterion.pointsMax)} point(s).`,
    value,
  )
  return value
}

function applyContradiction(
  criterion: RubricCriterion,
  points: Millipoints,
  trace: RuleTrace,
): Millipoints {
  const policy = criterion.contradictionPolicy
  switch (policy.kind) {
    case 'ignore':
      return points
    case 'zero':
      return trace.record(
        'contradiction.zero',
        'Contradiction détectée : le critère est annulé.',
        points,
        ZERO,
      )
    case 'cap_percent': {
      const ceiling = percentOf(criterion.pointsMax, policy.percent)
      return trace.record(
        'contradiction.cap_percent',
        `Contradiction détectée : critère plafonné à ${policy.percent} % ` +
          `(${formatPoints(ceiling)} point(s)).`,
        points,
        minOf(points, ceiling),
      )
    }
    case 'penalty':
      return trace.record(
        'contradiction.penalty',
        `Contradiction détectée : ${formatPoints(policy.amount)} point(s) retiré(s).`,
        points,
        subtract(points, policy.amount),
      )
  }
}

/** Calcule les points d'un seul critère, hors exclusions. */
function computeCriterion(
  criterion: RubricCriterion,
  assessment: CriterionAssessment,
): { points: Millipoints; rules: readonly AppliedRule[]; deniedForMissingEvidence: boolean } {
  const trace = new RuleTrace()

  if (needsEvidence(assessment, criterion) && assessment.evidence.length === 0) {
    // « Aucune note sans preuve » — vérifié, pas seulement documenté.
    // On refuse aussi bien d'accorder que de retirer des points : une pénalité
    // sans justification est aussi contestable qu'un point non justifié.
    trace.note(
      'evidence.missing',
      "Aucun extrait justificatif : le critère est laissé à zéro et signalé pour " +
        'validation humaine.',
      ZERO,
    )
    return { points: ZERO, rules: trace.all(), deniedForMissingEvidence: true }
  }

  let points = basePoints(criterion, assessment, trace)

  if (assessment.contradicted) {
    points = applyContradiction(criterion, points, trace)
  }

  if (assessment.factuallyWrong && criterion.factualErrorPenalty !== null) {
    points = trace.record(
      'factual_error.penalty',
      `Erreur factuelle : ${formatPoints(criterion.factualErrorPenalty)} point(s) retiré(s).`,
      points,
      subtract(points, criterion.factualErrorPenalty),
    )
  }

  // Plafond et plancher du critère.
  if (criterion.attribution === 'penalty') {
    points = trace.record(
      'criterion.clamp',
      `Pénalité bornée à ${formatPoints(criterion.pointsMax)} point(s).`,
      points,
      clamp(points, subtract(ZERO, criterion.pointsMax), ZERO),
    )
  } else {
    const ceiling = effectiveCap(criterion)
    points = trace.record(
      'criterion.clamp',
      `Critère borné à ${formatPoints(ceiling)} point(s).`,
      points,
      clamp(points, subtract(ZERO, criterion.pointsMax), ceiling),
    )
  }

  return { points, rules: trace.all(), deniedForMissingEvidence: false }
}

function validateInputs(
  rules: QuestionGradingRules,
  criteria: readonly RubricCriterion[],
  assessments: readonly CriterionAssessment[],
): void {
  const seen = new Set<string>()
  for (const criterion of criteria) {
    if (criterion.questionId !== rules.questionId) {
      throw new GradingError(
        `Le critère « ${criterion.label} » appartient à une autre question que celle évaluée.`,
      )
    }
    if (seen.has(criterion.id)) {
      throw new GradingError(`Critère en double dans le barème : ${criterion.id}.`)
    }
    seen.add(criterion.id)
  }

  const byId = new Map(criteria.map((c) => [c.id, c]))

  for (const criterion of criteria) {
    for (const excluderId of criterion.excludedBy) {
      const excluder = byId.get(excluderId)
      if (!excluder) {
        throw new GradingError(
          `Le critère « ${criterion.label} » référence un critère excluant absent du barème.`,
        )
      }
      // L'ordre strict rend les exclusions acycliques, donc le résultat
      // indépendant de l'ordre d'évaluation.
      if (excluder.order >= criterion.order) {
        throw new GradingError(
          `Le critère « ${criterion.label} » ne peut être exclu que par un critère ` +
            `d'ordre inférieur. « ${excluder.label} » a l'ordre ${excluder.order}, ` +
            `« ${criterion.label} » a l'ordre ${criterion.order}.`,
        )
      }
    }
  }

  const assessed = new Set<string>()
  for (const assessment of assessments) {
    if (!byId.has(assessment.criterionId)) {
      throw new GradingError(
        `L'analyse porte sur un critère absent du barème verrouillé : ${assessment.criterionId}. ` +
          `Aucune correction n'est possible hors du barème validé.`,
      )
    }
    if (assessed.has(assessment.criterionId)) {
      throw new GradingError(`Deux évaluations pour le même critère : ${assessment.criterionId}.`)
    }
    assessed.add(assessment.criterionId)
  }
}

/** Un critère non évalué est traité comme absent, sans preuve. */
function defaultAssessment(criterion: RubricCriterion): CriterionAssessment {
  return {
    criterionId: criterion.id,
    status: 'absent',
    contradicted: false,
    factuallyWrong: false,
    matchedElementCount: 0,
    manualPoints: criterion.attribution === 'manual' ? ZERO : null,
    evidence: [],
  }
}

/**
 * Calcule la note d'une question.
 *
 * @param rules Règles de la question, issues du barème verrouillé.
 * @param criteria Critères validés de la question.
 * @param assessments États identifiés par l'analyse ou saisis par le correcteur.
 */
export function gradeQuestion(
  rules: QuestionGradingRules,
  criteria: readonly RubricCriterion[],
  assessments: readonly CriterionAssessment[],
): QuestionOutcome {
  validateInputs(rules, criteria, assessments)

  const questionTrace = new RuleTrace()
  const assessmentById = new Map(assessments.map((a) => [a.criterionId, a]))

  // Ordre stable : le résultat ne doit jamais dépendre de l'ordre du tableau reçu.
  const ordered = [...criteria].sort((a, b) =>
    a.order === b.order ? a.id.localeCompare(b.id) : a.order - b.order,
  )

  const outcomes: CriterionOutcome[] = []
  const awarded = new Set<string>()

  for (const criterion of ordered) {
    const assessment = assessmentById.get(criterion.id) ?? defaultAssessment(criterion)

    const excludedByAwarded = criterion.excludedBy.find((id) => awarded.has(id))
    if (excludedByAwarded !== undefined) {
      const excluder = ordered.find((c) => c.id === excludedByAwarded)
      outcomes.push({
        criterionId: criterion.id,
        label: criterion.label,
        status: assessment.status,
        contradicted: assessment.contradicted,
        factuallyWrong: assessment.factuallyWrong,
        pointsPossible: criterion.pointsMax,
        pointsComputed: ZERO,
        excluded: true,
        deniedForMissingEvidence: false,
        appliedRules: [
          {
            rule: 'criterion.excluded',
            detail: `Critère exclu car « ${excluder?.label ?? excludedByAwarded} » a été attribué.`,
            before: criterion.pointsMax,
            after: ZERO,
          },
        ],
      })
      continue
    }

    const { points, rules: appliedRules, deniedForMissingEvidence } = computeCriterion(
      criterion,
      assessment,
    )

    if (points > ZERO) awarded.add(criterion.id)

    outcomes.push({
      criterionId: criterion.id,
      label: criterion.label,
      status: assessment.status,
      contradicted: assessment.contradicted,
      factuallyWrong: assessment.factuallyWrong,
      pointsPossible: criterion.pointsMax,
      pointsComputed: points,
      excluded: false,
      deniedForMissingEvidence,
      appliedRules,
    })
  }

  const rawTotal = sum(outcomes.map((o) => o.pointsComputed))
  let total = rawTotal

  // Critères obligatoires absents.
  const missingRequired = ordered.filter((criterion) => {
    if (!criterion.required) return false
    const outcome = outcomes.find((o) => o.criterionId === criterion.id)
    return outcome !== undefined && outcome.pointsComputed <= ZERO
  })

  if (missingRequired.length > 0) {
    const noms = missingRequired.map((c) => `« ${c.label} »`).join(', ')
    const policy = rules.missingRequiredPolicy
    if (policy.kind === 'zero_question') {
      total = questionTrace.record(
        'required.zero_question',
        `Critère(s) obligatoire(s) non satisfait(s) : ${noms}. La question est annulée.`,
        total,
        ZERO,
      )
    } else if (policy.kind === 'cap_percent') {
      const ceiling = percentOf(rules.pointsMax, policy.percent)
      total = questionTrace.record(
        'required.cap_percent',
        `Critère(s) obligatoire(s) non satisfait(s) : ${noms}. Question plafonnée à ` +
          `${policy.percent} % (${formatPoints(ceiling)} point(s)).`,
        total,
        minOf(total, ceiling),
      )
    } else {
      questionTrace.note(
        'required.missing',
        `Critère(s) obligatoire(s) non satisfait(s) : ${noms}. Aucune conséquence ` +
          `supplémentaire selon le barème.`,
        total,
      )
    }
  }

  // Plafond et plancher de la question.
  const floor = rules.allowNegative ? NEGATIVE_INFINITY_POINTS : ZERO
  const ceiling = rules.allowBonusOverflow ? POSITIVE_INFINITY_POINTS : rules.pointsMax

  total = questionTrace.record(
    'question.clamp',
    rules.allowBonusOverflow
      ? `Note ramenée à un minimum de ${formatPoints(floor === NEGATIVE_INFINITY_POINTS ? ZERO : floor)}.`
      : `Note bornée à ${formatPoints(rules.pointsMax)} point(s).`,
    total,
    clamp(total, floor, ceiling),
  )

  const cappedTotal = total

  if (rules.roundingStep !== null) {
    total = questionTrace.record(
      'question.rounding',
      `Arrondi au pas de ${formatPoints(rules.roundingStep)} point(s). ` +
        `La valeur exacte reste conservée.`,
      total,
      clamp(roundToStep(total, rules.roundingStep), floor, ceiling),
    )
  }

  return {
    questionId: rules.questionId,
    criteria: outcomes,
    rawTotal,
    cappedTotal,
    total,
    pointsMax: rules.pointsMax,
    appliedRules: questionTrace.all(),
  }
}

/** Somme des notes de plusieurs questions, pour la note d'une copie. */
export function totalForSubmission(outcomes: readonly QuestionOutcome[]): Millipoints {
  return sum(outcomes.map((outcome) => outcome.total))
}

/** Barème total d'une épreuve. */
export function maxForSubmission(outcomes: readonly QuestionOutcome[]): Millipoints {
  return sum(outcomes.map((outcome) => outcome.pointsMax))
}

/** Vrai si au moins un critère a été laissé à zéro faute d'extrait justificatif. */
export function hasUnjustifiedCriteria(outcome: QuestionOutcome): boolean {
  return outcome.criteria.some((criterion) => criterion.deniedForMissingEvidence)
}

export { add as addPoints, maxOf as maxPoints }
