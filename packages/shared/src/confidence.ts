/**
 * Niveaux de confiance d'une proposition de correction.
 *
 * Trois niveaux, avec des seuils configurables par organisation. Les valeurs
 * indicatives du cahier des charges sont : vert ≥ 90 %, orange 65–89 %,
 * rouge < 65 %.
 *
 * Principe : une faible confiance ne se cache jamais. Un cas rouge est signalé
 * comme tel à l'enseignant, il n'est pas présenté comme une proposition ordinaire.
 */

export type ConfidenceLevel = 'green' | 'orange' | 'red'

/** Score de confiance, entre 0 et 1 inclus. */
declare const brand: unique symbol
export type ConfidenceScore = number & { readonly [brand]: 'ConfidenceScore' }

export class ConfidenceError extends RangeError {
  constructor(message: string) {
    super(message)
    this.name = 'ConfidenceError'
  }
}

export function confidenceScore(value: number): ConfidenceScore {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new ConfidenceError(`Score de confiance hors de [0, 1] : ${value}`)
  }
  return value as ConfidenceScore
}

export interface ConfidenceThresholds {
  /** Seuil bas du vert, en pourcentage. */
  readonly greenMin: number
  /** Seuil bas de l'orange, en pourcentage. */
  readonly orangeMin: number
}

export const DEFAULT_THRESHOLDS: ConfidenceThresholds = {
  greenMin: 90,
  orangeMin: 65,
}

export function assertValidThresholds(thresholds: ConfidenceThresholds): void {
  const { greenMin, orangeMin } = thresholds
  if (greenMin < 0 || greenMin > 100 || orangeMin < 0 || orangeMin > 100) {
    throw new ConfidenceError('Les seuils de confiance doivent être compris entre 0 et 100.')
  }
  if (orangeMin >= greenMin) {
    throw new ConfidenceError(
      'Le seuil orange doit être strictement inférieur au seuil vert, sinon aucun cas ' +
        'ne serait jamais signalé comme incertain.',
    )
  }
}

export function levelFor(
  score: ConfidenceScore,
  thresholds: ConfidenceThresholds = DEFAULT_THRESHOLDS,
): ConfidenceLevel {
  assertValidThresholds(thresholds)
  const percent = score * 100
  if (percent >= thresholds.greenMin) return 'green'
  if (percent >= thresholds.orangeMin) return 'orange'
  return 'red'
}

/**
 * Facteurs entrant dans le calcul de la confiance d'une proposition.
 *
 * Chaque facteur est entre 0 et 1. Le calcul est délibérément simple et lisible :
 * un enseignant doit pouvoir comprendre pourquoi un cas est orange.
 */
export interface ConfidenceFactors {
  /** Confiance de l'OCR sur la zone de réponse. */
  readonly ocr: number
  /** Netteté de la correspondance entre la réponse et les critères. */
  readonly criteriaMatch: number
  /** Part des critères détectés effectivement adossés à un extrait justificatif. */
  readonly evidenceCoverage: number
}

export interface ConfidencePenalties {
  /** Le modèle a signalé des passages incertains. */
  readonly hasUncertainSpans: boolean
  /** Une contradiction a été détectée dans la réponse. */
  readonly hasContradiction: boolean
  /** Un élément correct mais absent du corrigé a été repéré. */
  readonly hasUnexpectedElement: boolean
  /** Deux analyses ont abouti à des conclusions divergentes. */
  readonly analysesDisagree: boolean
}

const PENALTY = {
  uncertainSpans: 0.1,
  contradiction: 0.15,
  unexpectedElement: 0.2,
  disagreement: 0.35,
} as const

/**
 * Combine les facteurs en un score unique.
 *
 * L'OCR n'est PAS un terme d'une moyenne pondérée, mais un **plafond
 * multiplicatif**. C'est la propriété importante de ce calcul, et elle mérite
 * qu'on s'y arrête.
 *
 * Avec une moyenne pondérée, une correspondance de critères excellente
 * compenserait une transcription douteuse. Or c'est exactement l'inverse qui est
 * vrai : si la transcription est mauvaise, la correspondance a été calculée sur
 * du texte erroné. Une bonne correspondance sur une mauvaise lecture n'est pas
 * rassurante, elle est dénuée de sens.
 *
 * On ne peut donc pas être plus confiant dans l'analyse qu'on ne l'est dans le
 * texte qu'elle a lu. Le produit exprime cette dépendance.
 *
 * Les pénalités sont ensuite soustraites. Le désaccord entre deux analyses coûte
 * le plus cher : c'est le signal le plus fiable qu'un humain doit trancher.
 */
export function computeConfidence(
  factors: ConfidenceFactors,
  penalties: ConfidencePenalties,
): ConfidenceScore {
  for (const [name, value] of Object.entries(factors)) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new ConfidenceError(`Facteur de confiance « ${name} » hors de [0, 1] : ${value}`)
    }
  }

  const analyse = factors.criteriaMatch * 0.6 + factors.evidenceCoverage * 0.4

  let score = factors.ocr * analyse
  if (penalties.hasUncertainSpans) score -= PENALTY.uncertainSpans
  if (penalties.hasContradiction) score -= PENALTY.contradiction
  if (penalties.hasUnexpectedElement) score -= PENALTY.unexpectedElement
  if (penalties.analysesDisagree) score -= PENALTY.disagreement

  return confidenceScore(Math.min(1, Math.max(0, score)))
}

/**
 * Détermine si une proposition exige une validation humaine attentive.
 *
 * Rappel : TOUTE note exige une validation humaine. Cette fonction indique
 * seulement les cas qu'on ne doit jamais valider en lot.
 */
export function requiresCarefulReview(
  level: ConfidenceLevel,
  penalties: Pick<ConfidencePenalties, 'hasUnexpectedElement' | 'analysesDisagree'>,
): boolean {
  return level !== 'green' || penalties.hasUnexpectedElement || penalties.analysesDisagree
}

export const CONFIDENCE_LABELS: Record<ConfidenceLevel, string> = {
  green: 'Confiance élevée',
  orange: 'À vérifier',
  red: 'Validation humaine requise',
}
