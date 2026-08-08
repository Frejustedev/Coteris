/**
 * Abstractions des fournisseurs d'IA.
 *
 * Le métier ne dépend jamais d'un fournisseur concret. Ce n'est pas une
 * architecture multi-fournisseurs disproportionnée : c'est le minimum pour que la
 * phase de banc d'essai puisse comparer plusieurs pipelines, et pour que tous les
 * tests s'exécutent sans réseau ni dépense.
 */

import type { AnalysisResult } from './analysis'
import type { BarèmeProposé, RubricDraftRequest } from './rubric-draft'

/** Image d'une zone de réponse recadrée. Jamais une page entière. */
export interface RegionImage {
  readonly key: string
  readonly bytes: Uint8Array
  readonly mimeType: string
  readonly widthPx: number
  readonly heightPx: number
}

export interface OcrWord {
  readonly text: string
  readonly startOffset: number
  readonly endOffset: number
  readonly confidence: number
  readonly alternatives: readonly string[]
  readonly x?: number
  readonly y?: number
  readonly width?: number
  readonly height?: number
}

export interface OcrResult {
  readonly fullText: string
  readonly words: readonly OcrWord[]
  /** Confiance globale, entre 0 et 1. */
  readonly confidence: number
  readonly engineVersion: string
}

export interface ProviderUsage {
  readonly provider: string
  readonly model: string
  readonly inputTokens: number | null
  readonly outputTokens: number | null
  readonly pageCount: number | null
  readonly durationMs: number
}

export interface ProviderResponse<T> {
  readonly result: T
  readonly usage: ProviderUsage
}

export interface OcrProvider {
  readonly name: string
  transcribe(image: RegionImage): Promise<ProviderResponse<OcrResult>>
}

/** Contexte fourni au modèle pour analyser une réponse. */
export interface AnalysisRequest {
  readonly questionPrompt: string
  readonly answerKeyText: string
  readonly criteria: readonly {
    readonly id: string
    readonly label: string
    readonly description: string | null
    readonly acceptableAnswers: readonly string[]
    readonly expectedElementCount: number
  }[]
  readonly transcription: string
  readonly language: string
}

/** Analyse à partir du texte transcrit — pipeline A. */
export interface TextAnalysisProvider {
  readonly name: string
  analyze(request: AnalysisRequest): Promise<ProviderResponse<AnalysisResult>>
}

/** Issue d'une analyse au sein d'un lot. Exactement l'un des deux champs est renseigné. */
export interface BatchAnalysisOutcome {
  /** Position dans le tableau de demandes : un lot rend ses résultats en désordre. */
  readonly index: number
  readonly response: ProviderResponse<AnalysisResult> | null
  readonly error: ProviderError | null
}

/**
 * Analyse par lot, pour les charges qui ne sont pas sensibles à la latence.
 *
 * Corriger une épreuve est exactement cela : personne n'attend la copie 137 pour
 * commencer à relire la première. Les fournisseurs qui facturent ce mode moins
 * cher — souvent moitié prix — rendent la correction deux fois plus abordable
 * sans rien changer à sa qualité.
 *
 * Les erreurs sont rendues DANS le tableau plutôt que levées : dans un lot de
 * deux cents, une seule analyse en échec ne doit pas emporter les cent
 * quatre-vingt-dix-neuf autres, déjà payées.
 */
export interface BatchTextAnalysisProvider extends TextAnalysisProvider {
  analyzeBatch(
    requests: readonly AnalysisRequest[],
    onProgress?: (message: string) => void,
  ): Promise<readonly BatchAnalysisOutcome[]>
}

export function supportsBatch(
  provider: TextAnalysisProvider,
): provider is BatchTextAnalysisProvider {
  return typeof (provider as Partial<BatchTextAnalysisProvider>).analyzeBatch === 'function'
}

/**
 * Proposition d'un découpage de barème à partir d'un corrigé rédigé.
 *
 * Distinct de l'analyse : celle-ci juge une copie contre un barème existant,
 * celui-là aide à écrire le barème. Aucune de ses propositions ne corrige quoi
 * que ce soit tant qu'un enseignant ne l'a pas acceptée — « aucune correction
 * sans barème validé » n'admet pas d'exception pour un barème que le modèle
 * aurait rédigé lui-même.
 */
export interface RubricDraftProvider {
  readonly name: string
  proposeRubric(request: RubricDraftRequest): Promise<ProviderResponse<BarèmeProposé>>
}

/** Analyse multimodale, directement sur l'image de la zone — pipeline B. */
export interface VisionAnalysisProvider {
  readonly name: string
  analyze(
    request: AnalysisRequest & { readonly image: RegionImage },
  ): Promise<ProviderResponse<AnalysisResult>>
}

export interface EmbeddingProvider {
  readonly name: string
  embed(texts: readonly string[]): Promise<ProviderResponse<readonly (readonly number[])[]>>
}

export class ProviderError extends Error {
  readonly provider: string
  readonly retryable: boolean

  constructor(provider: string, message: string, retryable = true) {
    super(message)
    this.name = 'ProviderError'
    this.provider = provider
    this.retryable = retryable
  }
}
