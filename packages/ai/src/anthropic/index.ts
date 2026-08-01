/**
 * Fournisseur d'analyse textuelle adossé à l'API Anthropic — pipeline A.
 *
 * CE QUI DISTINGUE CE FICHIER DU SIMULATEUR
 *
 * Le simulateur ne peut pas se tromper de façon intéressante : il découpe ses
 * extraits dans le texte original, ne classe que des critères qu'il a lus, et ne
 * dépasse aucune borne de longueur. Un modèle de langage, lui, peut oublier un
 * critère, reformuler une citation, produire un identifiant plausible qu'il n'a
 * jamais reçu, ou écrire 520 caractères là où 500 sont admis.
 *
 * Or, dans ce pipeline, **une analyse rejetée ne remonte pas comme une erreur :
 * elle devient une note de zéro enregistrée et scellée dans le journal d'audit**
 * (voir `inconclusive()` dans `packages/pipeline/src/grade-answer.ts`). Un
 * fournisseur qui se contenterait de transmettre la sortie brute du modèle
 * transformerait donc chacun de ces écarts en zéro silencieux.
 *
 * D'où la discipline de ce fichier, en trois temps :
 *
 * 1. RÉPARER ce qui est mécanique et ne change pas le sens — recaler les extraits
 *    sur le texte réel de la copie, tronquer les explications trop longues,
 *    borner les valeurs numériques.
 * 2. REDEMANDER une fois, en renvoyant au modèle les défauts constatés, quand
 *    l'écart porte sur le fond — un critère oublié, un identifiant inventé.
 * 3. ÉCHOUER BRUYAMMENT si la seconde tentative ne passe toujours pas. Une tâche
 *    en échec se voit ; un zéro ne se voit pas.
 *
 * Le fournisseur valide sa propre sortie avec les validateurs du dépôt avant de
 * la rendre. Ce qui sort d'ici passe donc les barrières du pipeline par
 * construction : celui-ci ne peut plus produire de zéro à cause de nous.
 */

import { Anthropic } from '@anthropic-ai/sdk'
import type {
  Message,
  MessageCreateParamsNonStreaming,
  MessageParam,
} from '@anthropic-ai/sdk/resources/messages'
import { z } from 'zod'

import {
  analysisResultSchema,
  AnalysisValidationError,
  validateCriteriaScope,
  validateEvidence,
  type AnalysisResult,
} from '../analysis'
import {
  ProviderError,
  type AnalysisRequest,
  type ProviderResponse,
  type ProviderUsage,
  type TextAnalysisProvider,
} from '../providers'
import { recalerExtrait, tronquer } from './normalize'
import { composerMessage, composerReprise, INVITE_SYSTEME } from './prompt'
import { SCHEMA_ANALYSE } from './schema'

/** Modèle par défaut. Sert aussi de clé de tarification dans `PRICING`. */
export const MODELE_PAR_DEFAUT = 'claude-opus-5'

/**
 * Plafond de jetons de sortie.
 *
 * Sur `claude-opus-5` le raisonnement est actif par défaut et **partage ce
 * plafond avec le texte de réponse**. Un plafond dimensionné pour la seule
 * réponse tronque le JSON en plein milieu : `stop_reason` vaut alors
 * `max_tokens`, le parse échoue, et la question tombe à zéro. On voit large.
 */
const JETONS_SORTIE_PAR_DEFAUT = 16_000

/** Ce que le fournisseur a dû réparer, ou n'a pas pu réparer. */
export interface DiagnosticAnalyse {
  readonly type:
    | 'extrait_recale'
    | 'extrait_fabrique'
    | 'critere_retrograde'
    | 'critere_hors_bareme'
    | 'texte_tronque'
    | 'valeur_bornee'
    | 'reprise'
  readonly detail: string
}

/** Sous-ensemble du client SDK réellement utilisé, pour pouvoir l'injecter en test. */
export interface ClientAnalyse {
  readonly messages: {
    create(params: MessageCreateParamsNonStreaming): Promise<Message>
  }
}

export interface AnthropicAnalysisOptions {
  /** Clé d'API. À défaut, le SDK lit `ANTHROPIC_API_KEY`. */
  readonly apiKey?: string
  readonly model?: string
  readonly effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  readonly maxTokens?: number
  /**
   * Reprises internes du SDK sur erreur réseau ou 429/5xx.
   *
   * Volontairement basses : la tâche est déjà rejouée trois fois par la file de
   * travaux, et chaque tentative refacture un appel complet.
   */
  readonly maxRetries?: number
  readonly timeoutMs?: number
  /** Client injecté. Les tests s'en servent pour ne jamais toucher le réseau. */
  readonly client?: ClientAnalyse
  /**
   * Appelé pour chaque réparation ou anomalie.
   *
   * C'est le seul canal de sortie disponible : `ProviderUsage` n'a pas de champ
   * libre et `PipelineStep` n'est persisté nulle part. Le banc d'essai s'en sert
   * pour compter les réparations, faute de quoi un fournisseur qui hallucine
   * régulièrement ses citations serait indiscernable d'un fournisseur exact.
   */
  readonly onDiagnostic?: (diagnostic: DiagnosticAnalyse) => void
}

// --- Lecture permissive de la sortie du modèle --------------------------------

/**
 * Schéma volontairement laxiste, appliqué à la sortie brute.
 *
 * Il n'impose ni bornes de longueur, ni format d'identifiant, ni intervalle
 * numérique : ces contraintes-là sont rétablies par la réparation, puis
 * vérifiées par `analysisResultSchema`. Parser d'abord strictement reviendrait à
 * jeter une analyse presque bonne pour une explication de dix caractères de trop.
 */
const detectionLache = z.object({
  criterionId: z.string(),
  excerpts: z.array(z.string()).default([]),
  matchedElementCount: z.number().optional(),
})

const problemeLache = z.object({
  criterionId: z.string(),
  excerpt: z.string(),
  explanation: z.string(),
})

const schemaLache = z.object({
  presentCriteria: z.array(detectionLache).default([]),
  partialCriteria: z.array(detectionLache).default([]),
  missingCriteria: z.array(z.string()).default([]),
  contradictions: z.array(problemeLache).default([]),
  factualErrors: z.array(problemeLache).default([]),
  unexpectedElements: z
    .array(
      z.object({
        excerpt: z.string(),
        explanation: z.string(),
        nearestCriterionId: z.string().nullable().default(null),
      }),
    )
    .default([]),
  uncertainSpans: z
    .array(z.object({ excerpt: z.string(), reason: z.string() }))
    .default([]),
  needsHumanReview: z.boolean().default(true),
  matchClarity: z.number().default(0),
})

// --- Réparation ---------------------------------------------------------------

const MAX_EXPLICATION = 500
const MAX_RAISON = 300

/**
 * Ramène la sortie du modèle dans les clous de `analysisResultSchema`, sans
 * jamais inventer de contenu.
 *
 * Toute réparation va dans le sens de la prudence : un extrait introuvable est
 * retiré, un critère qui perd sa dernière preuve redevient absent. Jamais
 * l'inverse. Le principe « aucune note sans preuve » se défend ici, avant même
 * les barrières du pipeline.
 */
function reparer(
  brut: z.infer<typeof schemaLache>,
  request: AnalysisRequest,
  signaler: (d: DiagnosticAnalyse) => void,
): AnalysisResult {
  const connus = new Set(request.criteria.map((c) => c.id))
  const transcription = request.transcription

  /** Recale un extrait sur la copie. `null` = citation fabriquée. */
  const recaler = (extrait: string, contexte: string): string | null => {
    const recale = recalerExtrait(transcription, extrait)
    if (recale === null) {
      signaler({
        type: 'extrait_fabrique',
        detail: `${contexte} : « ${extrait.slice(0, 60)} » est introuvable dans la copie.`,
      })
      return null
    }
    if (recale !== extrait) {
      signaler({
        type: 'extrait_recale',
        detail: `${contexte} : citation recalée sur le texte de la copie.`,
      })
    }
    return recale
  }

  const presents: AnalysisResult['presentCriteria'] = []
  const partiels: AnalysisResult['partialCriteria'] = []
  const absents = new Set<string>()

  const traiterDetections = (
    detections: readonly z.infer<typeof detectionLache>[],
    cible: AnalysisResult['presentCriteria'],
    etiquette: string,
  ): void => {
    for (const d of detections) {
      if (!connus.has(d.criterionId)) {
        signaler({
          type: 'critere_hors_bareme',
          detail: `${etiquette} : l'identifiant ${d.criterionId} n'appartient pas au barème.`,
        })
        continue
      }

      const extraits = d.excerpts
        .map((e) => recaler(e, `${etiquette} ${d.criterionId}`))
        .filter((e): e is string => e !== null)

      if (extraits.length === 0) {
        // Un critère sans preuve exploitable ne peut pas rapporter de points.
        // On le déclare absent plutôt que de laisser le moteur le refuser plus
        // loin avec un avertissement que l'enseignant ne saura pas interpréter.
        signaler({
          type: 'critere_retrograde',
          detail: `${etiquette} ${d.criterionId} : aucune preuve vérifiable, critère déclaré absent.`,
        })
        absents.add(d.criterionId)
        continue
      }

      const compte = d.matchedElementCount
      const compteValide =
        compte !== undefined && Number.isFinite(compte) && compte >= 0
          ? Math.floor(compte)
          : extraits.length

      cible.push({
        criterionId: d.criterionId,
        excerpts: extraits,
        matchedElementCount: compteValide,
      })
    }
  }

  traiterDetections(brut.presentCriteria, presents, 'critère présent')
  traiterDetections(brut.partialCriteria, partiels, 'critère partiel')

  for (const id of brut.missingCriteria) {
    if (!connus.has(id)) {
      signaler({
        type: 'critere_hors_bareme',
        detail: `critère absent : l'identifiant ${id} n'appartient pas au barème.`,
      })
      continue
    }
    absents.add(id)
  }

  // Un critère rétrogradé ne doit pas rester aussi dans les listes de tête.
  const classes = new Set<string>([
    ...presents.map((d) => d.criterionId),
    ...partiels.map((d) => d.criterionId),
  ])
  const absentsFinaux = [...absents].filter((id) => !classes.has(id))

  /**
   * Contradictions et erreurs factuelles ne sont retenues que sur un critère
   * classé présent ou partiel.
   *
   * Sur un critère absent, le pipeline ne recopie pas l'extrait du problème dans
   * les preuves de l'évaluation : le moteur refuse alors le critère « faute
   * d'extrait justificatif », et l'enseignant lit un avertissement qui accuse le
   * modèle de n'avoir rien fourni alors qu'il avait fourni une citation valide.
   */
  const traiterProblemes = (
    problemes: readonly z.infer<typeof problemeLache>[],
    etiquette: string,
  ): AnalysisResult['contradictions'] => {
    const retenus: Array<{ criterionId: string; excerpt: string; explanation: string }> = []

    for (const p of problemes) {
      if (!classes.has(p.criterionId)) {
        signaler({
          type: 'critere_hors_bareme',
          detail:
            `${etiquette} sur ${p.criterionId} : le critère n'est pas classé présent ou ` +
            `partiel, le signalement serait inexploitable en aval.`,
        })
        continue
      }

      const extrait = recaler(p.excerpt, `${etiquette} ${p.criterionId}`)
      if (extrait === null) continue

      const explication = tronquer(p.explanation.trim(), MAX_EXPLICATION)
      if (explication.length !== p.explanation.trim().length) {
        signaler({ type: 'texte_tronque', detail: `${etiquette} : explication tronquée.` })
      }
      if (explication.length === 0) continue

      retenus.push({ criterionId: p.criterionId, excerpt: extrait, explanation: explication })
    }

    return retenus
  }

  const inattendus: AnalysisResult['unexpectedElements'] = []
  for (const u of brut.unexpectedElements) {
    const extrait = recaler(u.excerpt, 'élément inattendu')
    if (extrait === null) continue
    const explication = tronquer(u.explanation.trim(), MAX_EXPLICATION)
    if (explication.length === 0) continue
    inattendus.push({
      excerpt: extrait,
      explanation: explication,
      nearestCriterionId:
        u.nearestCriterionId !== null && connus.has(u.nearestCriterionId)
          ? u.nearestCriterionId
          : null,
    })
  }

  /**
   * Les passages incertains ne sont PAS vérifiés par `validateEvidence` : c'est
   * le seul endroit du produit où une citation non confrontée à la copie
   * atteindrait la base et pèserait sur la confiance affichée. On les recale ici.
   */
  const incertains: AnalysisResult['uncertainSpans'] = []
  for (const u of brut.uncertainSpans) {
    const extrait = recaler(u.excerpt, 'passage incertain')
    if (extrait === null) continue
    const raison = tronquer(u.reason.trim(), MAX_RAISON)
    if (raison.length === 0) continue
    incertains.push({ excerpt: extrait, reason: raison })
  }

  const nettete = Math.min(1, Math.max(0, brut.matchClarity))
  if (nettete !== brut.matchClarity) {
    signaler({
      type: 'valeur_bornee',
      detail: `matchClarity ramenée de ${brut.matchClarity} à ${nettete}.`,
    })
  }

  return {
    presentCriteria: presents,
    partialCriteria: partiels,
    missingCriteria: absentsFinaux,
    contradictions: traiterProblemes(brut.contradictions, 'contradiction'),
    factualErrors: traiterProblemes(brut.factualErrors, 'erreur factuelle'),
    unexpectedElements: inattendus,
    uncertainSpans: incertains,
    // Aucune proposition ne contourne la validation humaine, quoi que dise le
    // modèle. Ce n'est pas à lui d'en décider.
    needsHumanReview: true,
    matchClarity: nettete,
  }
}

// --- Lecture de la réponse ----------------------------------------------------

/** Concatène les blocs de texte de la réponse. */
function texteDe(message: Message): string {
  return message.content
    .filter((bloc): bloc is Extract<typeof bloc, { type: 'text' }> => bloc.type === 'text')
    .map((bloc) => bloc.text)
    .join('')
}

/**
 * Vérifie `stop_reason` **avant** toute lecture du contenu.
 *
 * Un refus des classificateurs de sûreté revient en HTTP 200 avec un contenu
 * vide ; une troncature revient avec un JSON coupé au milieu. Dans les deux cas,
 * lire `content` sans vérifier produit une analyse fantôme — donc un zéro.
 */
function verifierArret(message: Message, modele: string): void {
  const raison = message.stop_reason

  if (raison === 'refusal') {
    const details = message.stop_details
    const categorie =
      details !== null && details !== undefined && 'category' in details
        ? (details.category ?? 'non précisée')
        : 'non précisée'
    throw new ProviderError(
      'anthropic',
      `Le modèle ${modele} a refusé d'analyser cette réponse (catégorie : ${categorie}). ` +
        `La copie doit être corrigée à la main ; elle ne doit pas être notée zéro.`,
      false,
    )
  }

  if (raison === 'max_tokens') {
    throw new ProviderError(
      'anthropic',
      `Réponse tronquée : le plafond de jetons de sortie a été atteint. Sur ce modèle le ` +
        `raisonnement partage ce plafond avec la réponse — augmentez maxTokens.`,
      true,
    )
  }

  if (raison === 'model_context_window_exceeded') {
    throw new ProviderError(
      'anthropic',
      "La fenêtre de contexte est dépassée : la question, le corrigé ou la copie sont trop longs.",
      false,
    )
  }

  if (raison !== 'end_turn' && raison !== 'stop_sequence') {
    throw new ProviderError(
      'anthropic',
      `Arrêt inattendu du modèle (« ${raison ?? 'null'} »).`,
      false,
    )
  }
}

/** Total des jetons d'entrée facturés, écriture et lecture de cache comprises. */
function jetonsEntree(message: Message): number {
  const u = message.usage
  return (
    u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
  )
}

// --- Fournisseur --------------------------------------------------------------

export function createAnthropicTextAnalysisProvider(
  options: AnthropicAnalysisOptions = {},
): TextAnalysisProvider {
  const modele = options.model ?? MODELE_PAR_DEFAUT
  const effort = options.effort ?? 'high'
  const maxTokens = options.maxTokens ?? JETONS_SORTIE_PAR_DEFAUT
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

    async analyze(request: AnalysisRequest): Promise<ProviderResponse<AnalysisResult>> {
      const debut = Date.now()
      const identifiants = request.criteria.map((c) => c.id)

      const messages: MessageParam[] = [
        { role: 'user', content: composerMessage(request) },
      ]

      let jetonsIn = 0
      let jetonsOut = 0
      let derniersProblemes: readonly string[] = []

      // Deux tentatives : la première, puis une reprise nourrie des défauts
      // constatés. Au-delà, on échoue — insister coûte cher et convainc rarement.
      for (let tentative = 0; tentative < 2; tentative++) {
        let message: Message
        try {
          message = await client.messages.create({
            model: modele,
            max_tokens: maxTokens,
            system: INVITE_SYSTEME,
            messages,
            output_config: { effort, format: { type: 'json_schema', schema: SCHEMA_ANALYSE } },
          })
        } catch (erreur) {
          const details = erreur instanceof Error ? erreur.message : String(erreur)
          throw new ProviderError('anthropic', `Appel au modèle en échec : ${details}`, true)
        }

        jetonsIn += jetonsEntree(message)
        jetonsOut += message.usage.output_tokens

        verifierArret(message, modele)
        const texte = texteDe(message)

        let problemes: readonly string[]
        try {
          const brut = schemaLache.parse(JSON.parse(texte) as unknown)
          const repare = reparer(brut, request, signaler)

          // Le fournisseur se soumet aux mêmes barrières que le pipeline. Ce qui
          // sort d'ici les passe donc par construction.
          const strict = analysisResultSchema.parse(repare)
          validateEvidence(strict, request.transcription)
          validateCriteriaScope(strict, identifiants)

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
          if (erreur instanceof AnalysisValidationError) {
            problemes = erreur.problems
          } else if (erreur instanceof z.ZodError) {
            problemes = erreur.issues.map((i) => `${i.path.join('.') || 'racine'} : ${i.message}`)
          } else if (erreur instanceof SyntaxError) {
            problemes = ['La réponse n\'est pas un JSON valide.']
          } else {
            throw erreur
          }
        }

        derniersProblemes = problemes

        if (tentative === 0) {
          signaler({
            type: 'reprise',
            detail: `Analyse non conforme, reprise demandée : ${problemes.join(' ; ')}`,
          })
          messages.push(
            { role: 'assistant', content: texte },
            { role: 'user', content: composerReprise(problemes) },
          )
        }
      }

      // Échouer bruyamment. Retourner ici une analyse vide produirait une note de
      // zéro signée, indiscernable d'une copie blanche correctement analysée.
      throw new ProviderError(
        'anthropic',
        `Le modèle n'a pas produit d'analyse conforme en deux tentatives :\n` +
          derniersProblemes.map((p) => `  · ${p}`).join('\n'),
        false,
      )
    },
  }
}
