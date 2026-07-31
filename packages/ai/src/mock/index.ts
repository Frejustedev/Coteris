/**
 * Fournisseurs simulés, déterministes.
 *
 * Ils permettent de construire et de tester toute la chaîne — segmentation, OCR,
 * analyse, calcul, validation humaine, export — sans réseau, sans clé d'API et
 * sans dépenser un centime. C'est le fournisseur par défaut, et celui qu'utilisent
 * tous les tests.
 *
 * Le simulateur d'analyse fait de la correspondance lexicale sur les réponses
 * acceptables du barème. Ce n'est évidemment pas ce que fera un vrai modèle, mais
 * il produit une sortie **de la même forme**, avec de vraies preuves extraites de
 * la transcription — ce qui suffit à valider toute la mécanique en aval.
 */

import {
  type AnalysisRequest,
  type OcrProvider,
  type OcrResult,
  type OcrWord,
  type ProviderResponse,
  type RegionImage,
  type TextAnalysisProvider,
} from '../providers'
import type { AnalysisResult, CriterionDetection } from '../analysis'

/** Transcriptions simulées, indexées par clé d'image. */
export type TranscriptionFixtures = Readonly<Record<string, string>>

export interface MockOcrOptions {
  readonly fixtures?: TranscriptionFixtures
  /** Confiance retournée. Permet de tester les bandes orange et rouge. */
  readonly confidence?: number
  /** Mots déclarés incertains, pour éprouver le comportement en cas de doute. */
  readonly uncertainWords?: readonly string[]
}

const DEFAULT_TRANSCRIPTION =
  "Il faut donner de l'iode non radioactif pour protéger la thyroïde avant l'injection."

/**
 * Découpe un texte en mots avec leurs décalages exacts.
 *
 * Les décalages doivent être justes : c'est ce qui permettra, plus tard, de
 * remonter d'un extrait justificatif au pixel correspondant sur la copie.
 */
function tokenize(text: string, confidence: number, uncertain: readonly string[]): OcrResult {
  const words: OcrWord[] = []
  const pattern = /\S+/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    const word = match[0]
    const estIncertain = uncertain.some((u) => word.toLocaleLowerCase('fr-FR').includes(u))
    words.push({
      text: word,
      startOffset: match.index,
      endOffset: match.index + word.length,
      confidence: estIncertain ? 0.45 : confidence,
      alternatives: estIncertain ? [word.replace(/[aeiou]/, 'o')] : [],
    })
  }

  return { fullText: text, words, confidence, engineVersion: 'mock-1.0.0' }
}

export function createMockOcrProvider(options: MockOcrOptions = {}): OcrProvider {
  const fixtures = options.fixtures ?? {}
  const confidence = options.confidence ?? 0.97
  const uncertain = options.uncertainWords ?? []

  return {
    name: 'mock',
    transcribe(image: RegionImage): Promise<ProviderResponse<OcrResult>> {
      const text = fixtures[image.key] ?? DEFAULT_TRANSCRIPTION
      return Promise.resolve({
        result: tokenize(text, confidence, uncertain),
        usage: {
          provider: 'mock',
          model: 'mock-ocr',
          inputTokens: null,
          outputTokens: null,
          pageCount: 1,
          // Durée fixe : le simulateur doit rester déterministe, y compris
          // dans ce qu'il rapporte.
          durationMs: 12,
        },
      })
    },
  }
}

// --- Analyse -----------------------------------------------------------------

/**
 * Normalise pour la comparaison, en conservant la correspondance des positions.
 *
 * Le piège : `normalize('NFD')` décompose « é » en deux caractères. Retirer
 * ensuite les diacritiques change la longueur de la chaîne, et les indices ne
 * correspondent plus au texte original — l'extrait retourné serait décalé de
 * quelques caractères, silencieusement.
 *
 * On construit donc, en parallèle du texte normalisé, une table qui associe
 * chaque position normalisée à sa position d'origine.
 */
function normalizeWithMap(text: string): { normalized: string; map: number[] } {
  let normalized = ''
  const map: number[] = []

  for (let i = 0; i < text.length; i++) {
    const char = text[i] as string
    const folded = char
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[‘’ʼ]/g, "'")
      .toLocaleLowerCase('fr-FR')

    for (const c of folded) {
      normalized += c
      map.push(i)
    }
  }

  return { normalized, map }
}

/**
 * Cherche une formulation acceptable dans la transcription et retourne
 * l'extrait **tel qu'il figure réellement** dans le texte.
 *
 * Retourner le texte original, et non la formulation du barème, est essentiel :
 * la preuve doit citer la copie, pas le corrigé.
 */
function findExcerpt(transcription: string, phrase: string): string | null {
  const { normalized: haystack, map } = normalizeWithMap(transcription)
  const { normalized: needle } = normalizeWithMap(phrase)

  if (needle.length === 0) return null

  const index = haystack.indexOf(needle)
  if (index === -1) return null

  const start = map[index]
  const lastCharOrigin = map[index + needle.length - 1]
  if (start === undefined || lastCharOrigin === undefined) return null

  return transcription.slice(start, lastCharOrigin + 1)
}

export interface MockAnalysisOptions {
  /** Force certains critères à l'état partiel, pour éprouver les cas orange. */
  readonly partialCriterionIds?: readonly string[]
  readonly contradictedCriterionIds?: readonly string[]
  /** Extraits à signaler comme corrects mais absents du corrigé. */
  readonly unexpectedExcerpts?: readonly string[]
  readonly matchClarity?: number
}

/**
 * Analyse simulée par correspondance lexicale.
 *
 * Un critère est déclaré présent si l'une de ses formulations acceptables figure
 * dans la transcription. L'extrait retourné provient toujours de la copie.
 */
export function createMockTextAnalysisProvider(
  options: MockAnalysisOptions = {},
): TextAnalysisProvider {
  const partiels = new Set(options.partialCriterionIds ?? [])
  const contredits = new Set(options.contradictedCriterionIds ?? [])

  return {
    name: 'mock',
    analyze(request: AnalysisRequest): Promise<ProviderResponse<AnalysisResult>> {
      const présents: CriterionDetection[] = []
      const partiels_: CriterionDetection[] = []
      const absents: string[] = []

      for (const critère of request.criteria) {
        const extraits: string[] = []
        let éléments = 0

        for (const formulation of critère.acceptableAnswers) {
          const extrait = findExcerpt(request.transcription, formulation)
          if (extrait !== null) {
            extraits.push(extrait)
            éléments += 1
          }
        }

        if (extraits.length === 0) {
          absents.push(critère.id)
        } else if (partiels.has(critère.id)) {
          partiels_.push({ criterionId: critère.id, excerpts: extraits, matchedElementCount: éléments })
        } else {
          présents.push({ criterionId: critère.id, excerpts: extraits, matchedElementCount: éléments })
        }
      }

      const contradictions = [...contredits]
        .filter((id) => request.criteria.some((c) => c.id === id))
        .map((id) => {
          const premierMot = request.transcription.trim().split(/\s+/)[0] ?? request.transcription
          return {
            criterionId: id,
            excerpt: premierMot,
            explanation: 'Contradiction simulée pour les besoins des tests.',
          }
        })

      const inattendus = (options.unexpectedExcerpts ?? [])
        .map((phrase) => findExcerpt(request.transcription, phrase))
        .filter((e): e is string => e !== null)
        .map((excerpt) => ({
          excerpt,
          explanation: 'Élément correct mais absent du corrigé.',
          nearestCriterionId: null,
        }))

      const result: AnalysisResult = {
        presentCriteria: présents,
        partialCriteria: partiels_,
        missingCriteria: absents,
        contradictions,
        factualErrors: [],
        unexpectedElements: inattendus,
        uncertainSpans: [],
        // Toute proposition passe par une validation humaine : le simulateur
        // ne prétend jamais le contraire.
        needsHumanReview: true,
        matchClarity: options.matchClarity ?? (présents.length > 0 ? 0.95 : 0.6),
      }

      return Promise.resolve({
        result,
        usage: {
          provider: 'mock',
          model: 'mock-analysis',
          inputTokens: 0,
          outputTokens: 0,
          pageCount: null,
          durationMs: 8,
        },
      })
    },
  }
}
