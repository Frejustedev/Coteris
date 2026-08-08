/**
 * Proposition de barème simulée, déterministe.
 *
 * Elle découpe le corrigé sur sa ponctuation forte et fait de chaque fragment un
 * critère. C'est évidemment plus grossier que ce que produirait un modèle, mais
 * la sortie a la **même forme**, avec de vraies citations tirées du texte — ce
 * qui suffit à éprouver toute la mécanique en aval : validation, répartition des
 * points, écriture en brouillon, acceptation par l'enseignant.
 *
 * Elle ne coûte rien et ne touche pas le réseau : c'est le fournisseur par
 * défaut, et celui de tous les tests.
 */

import type { ProviderResponse, RubricDraftProvider } from '../providers'
import type { BarèmeProposé, RubricDraftRequest } from '../rubric-draft'

export interface MockRubricOptions {
  /** Nombre maximal de critères produits. Permet d'éprouver les cas limites. */
  readonly maxCritères?: number
}

/** Réduit un fragment à un intitulé court : les premiers mots significatifs. */
function intitulé(fragment: string): string {
  const mots = fragment.split(/\s+/u).filter((m) => m.length > 0)
  return mots.slice(0, 6).join(' ').slice(0, 200)
}

export function createMockRubricDraftProvider(
  options: MockRubricOptions = {},
): RubricDraftProvider {
  const plafond = options.maxCritères ?? 10

  return {
    name: 'mock',

    proposeRubric(request: RubricDraftRequest): Promise<ProviderResponse<BarèmeProposé>> {
      // Découpage sur la ponctuation forte, en conservant les fragments tels
      // qu'ils apparaissent : la citation doit se retrouver littéralement dans
      // le corrigé, comme pour un vrai fournisseur.
      const fragments = request.answerKeyText
        .split(/(?<=[.;:])\s+/u)
        .map((f) => f.trim())
        .filter((f) => f.length > 3)

      const retenus = fragments.slice(0, plafond)

      return Promise.resolve({
        result: {
          critères: retenus.map((fragment) => ({
            label: intitulé(fragment),
            citation: fragment.slice(0, 1000),
            acceptableAnswers: [intitulé(fragment)],
            poids: 1,
          })),
          passagesNonCouverts: fragments.slice(plafond).map((f) => f.slice(0, 500)),
        },
        usage: {
          provider: 'mock',
          model: 'mock-rubric',
          inputTokens: 0,
          outputTokens: 0,
          pageCount: null,
          // Durée fixe : le simulateur reste déterministe jusque dans ce qu'il
          // rapporte.
          durationMs: 5,
        },
      })
    },
  }
}
