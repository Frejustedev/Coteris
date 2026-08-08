/**
 * Fournisseur de proposition de barème, adossé à l'API Anthropic.
 *
 * Même discipline que le fournisseur d'analyse — réparer, redemander une fois,
 * échouer bruyamment — mais avec une conséquence différente en cas de laxisme.
 *
 * Une analyse ratée fausse une note. Un barème raté fausse TOUTES les notes de
 * la question, pour tous les étudiants, et il le fait de façon invisible :
 * personne ne relit un barème verrouillé en se demandant si l'un de ses critères
 * a été inventé. La seule réparation admise ici est de RETIRER ce qui ne se
 * vérifie pas ; jamais de compléter, jamais de deviner.
 */

import { Anthropic } from '@anthropic-ai/sdk'
import type { Message, MessageParam } from '@anthropic-ai/sdk/resources/messages'
import { z } from 'zod'

import {
  ProviderError,
  type ProviderResponse,
  type ProviderUsage,
  type RubricDraftProvider,
} from '../providers'
import {
  barèmeProposéSchema,
  RubricDraftError,
  validateDraftCitations,
  type BarèmeProposé,
  type RubricDraftRequest,
} from '../rubric-draft'
import {
  construireParams,
  erreurFournisseur,
  jetonsEntree,
  texteDe,
  verifierArret,
  type ClientAnalyse,
  type NiveauEffort,
  type Reglages,
} from './appel'
import { composerMessageBarème, composerRepriseBarème, INVITE_BAREME } from './rubric-prompt'
import { SCHEMA_BAREME } from './rubric-schema'

export const MODELE_BAREME_PAR_DEFAUT = 'claude-opus-5'

/** Un barème tient dans bien moins qu'une analyse ; le raisonnement, non. */
const JETONS_SORTIE_PAR_DEFAUT = 12_000

const MAX_LABEL = 200
const MAX_CITATION = 1000
const MAX_FORMULATION = 200

export interface DiagnosticBarème {
  readonly type: 'citation_recalee' | 'critere_ecarte' | 'texte_tronque' | 'reprise'
  readonly detail: string
}

export interface AnthropicRubricOptions {
  readonly apiKey?: string
  readonly model?: string
  readonly effort?: NiveauEffort
  readonly maxTokens?: number
  readonly maxRetries?: number
  readonly timeoutMs?: number
  readonly client?: ClientAnalyse
  readonly onDiagnostic?: (diagnostic: DiagnosticBarème) => void
}

/** Schéma laxiste appliqué à la sortie brute, avant réparation. */
const critèreLâche = z.object({
  label: z.string(),
  citation: z.string(),
  acceptableAnswers: z.array(z.string()).default([]),
  poids: z.number().default(1),
})

const schémaLâche = z.object({
  critères: z.array(critèreLâche).default([]),
  passagesNonCouverts: z.array(z.string()).default([]),
})

function tronquer(texte: string, maximum: number): string {
  return texte.length <= maximum ? texte : texte.slice(0, maximum).trimEnd()
}

/**
 * Ramène la proposition dans les clous, en retirant seulement.
 *
 * Aucune réparation n'ajoute de contenu. Un critère dont l'intitulé est vide,
 * dont la citation est vide, ou dont le poids est hors bornes est ÉCARTÉ — pas
 * complété par une valeur plausible. Le seul défaut réparé sans perte est la
 * longueur.
 */
function réparer(
  brut: z.infer<typeof schémaLâche>,
  signaler: (d: DiagnosticBarème) => void,
): BarèmeProposé {
  const critères: BarèmeProposé['critères'] = []

  for (const c of brut.critères) {
    const label = tronquer(c.label.trim(), MAX_LABEL)
    const citation = tronquer(c.citation.trim(), MAX_CITATION)

    if (label.length === 0 || citation.length === 0) {
      signaler({
        type: 'critere_ecarte',
        detail: `critère sans intitulé ou sans citation, écarté : « ${c.label.slice(0, 40)} »`,
      })
      continue
    }

    if (label.length !== c.label.trim().length || citation.length !== c.citation.trim().length) {
      signaler({ type: 'texte_tronque', detail: `« ${label.slice(0, 40)} » : texte tronqué.` })
    }

    critères.push({
      label,
      citation,
      acceptableAnswers: c.acceptableAnswers
        .map((a) => tronquer(a.trim(), MAX_FORMULATION))
        .filter((a) => a.length > 0)
        .slice(0, 20),
      poids: Math.min(5, Math.max(1, Math.round(c.poids))),
    })
  }

  return {
    critères: critères.slice(0, 30),
    passagesNonCouverts: brut.passagesNonCouverts
      .map((p) => tronquer(p.trim(), 500))
      .filter((p) => p.length > 0)
      .slice(0, 20),
  }
}

export function createAnthropicRubricDraftProvider(
  options: AnthropicRubricOptions = {},
): RubricDraftProvider {
  const modele = options.model ?? MODELE_BAREME_PAR_DEFAUT
  const reglages: Reglages = {
    modele,
    effort: options.effort ?? 'high',
    maxTokens: options.maxTokens ?? JETONS_SORTIE_PAR_DEFAUT,
  }
  const signaler = options.onDiagnostic ?? ((): void => {})

  const client: ClientAnalyse =
    options.client ??
    new Anthropic({
      ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
      maxRetries: options.maxRetries ?? 1,
      timeout: options.timeoutMs ?? 120_000,
    })

  return {
    name: 'anthropic',

    async proposeRubric(
      request: RubricDraftRequest,
    ): Promise<ProviderResponse<BarèmeProposé>> {
      const debut = Date.now()
      const messages: MessageParam[] = [
        { role: 'user', content: composerMessageBarème(request) },
      ]

      let jetonsIn = 0
      let jetonsOut = 0
      let derniersProblèmes: readonly string[] = []

      for (let tentative = 0; tentative < 2; tentative++) {
        let message: Message
        try {
          message = await client.messages.create(
            construireParams(reglages, messages, INVITE_BAREME, SCHEMA_BAREME),
          )
        } catch (erreur) {
          throw erreurFournisseur(erreur)
        }

        jetonsIn += jetonsEntree(message)
        jetonsOut += message.usage.output_tokens

        verifierArret(message, modele)
        const texte = texteDe(message)

        let problèmes: readonly string[]
        try {
          const brut = schémaLâche.parse(JSON.parse(texte) as unknown)
          const réparé = réparer(brut, signaler)
          const strict = barèmeProposéSchema.parse(réparé)

          // La barrière : chaque critère cite un passage réel du corrigé.
          validateDraftCitations(strict, request.answerKeyText)

          return {
            result: strict,
            usage: {
              provider: 'anthropic',
              model: modele,
              inputTokens: jetonsIn,
              outputTokens: jetonsOut,
              pageCount: null,
              durationMs: Date.now() - debut,
            } satisfies ProviderUsage,
          }
        } catch (erreur) {
          if (erreur instanceof RubricDraftError) problèmes = erreur.problems
          else if (erreur instanceof z.ZodError) {
            problèmes = erreur.issues.map((i) => `${i.path.join('.') || 'racine'} : ${i.message}`)
          } else if (erreur instanceof SyntaxError) {
            problèmes = ["La réponse n'est pas un JSON valide."]
          } else throw erreur
        }

        derniersProblèmes = problèmes

        if (tentative === 0) {
          signaler({
            type: 'reprise',
            detail: `Proposition non conforme, reprise demandée : ${problèmes.join(' ; ')}`,
          })
          messages.push(
            { role: 'assistant', content: texte },
            { role: 'user', content: composerRepriseBarème(problèmes) },
          )
        }
      }

      // Échouer plutôt que de rendre un barème partiel. Un enseignant à qui l'on
      // propose trois critères sur huit croira que son corrigé n'en contenait
      // que trois.
      throw new ProviderError(
        'anthropic',
        `Le modèle n'a pas produit de proposition conforme en deux tentatives :\n` +
          derniersProblèmes.map((p) => `  · ${p}`).join('\n'),
        false,
      )
    },
  }
}
