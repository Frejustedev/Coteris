/**
 * Abstractions des fournisseurs d'IA.
 *
 * Le métier ne dépend jamais d'un fournisseur concret. Ce n'est pas une
 * architecture multi-fournisseurs disproportionnée : c'est le minimum pour que la
 * phase de banc d'essai puisse comparer plusieurs pipelines, et pour que tous les
 * tests s'exécutent sans réseau ni dépense.
 */

import type { AnalysisResult } from './analysis'

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
