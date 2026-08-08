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
import type { Message, MessageParam } from '@anthropic-ai/sdk/resources/messages'
import type { MessageBatch } from '@anthropic-ai/sdk/resources/messages/batches'
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
  type BatchAnalysisOutcome,
  type BatchTextAnalysisProvider,
  type ProviderResponse,
  type ProviderUsage,
} from '../providers'
import {
  attendre,
  construireParams,
  erreurFournisseur,
  jetonsEntree,
  texteDe,
  verifierArret,
  type ClientAnalyse,
  type NiveauEffort,
  type Reglages,
} from './appel'
import { recalerExtrait, tronquer } from './normalize'
import { composerMessage, composerReprise, INVITE_SYSTEME } from './prompt'
import { SCHEMA_ANALYSE } from './schema'

export type { ClientAnalyse } from './appel'

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

export interface AnthropicAnalysisOptions {
  /** Clé d'API. À défaut, le SDK lit `ANTHROPIC_API_KEY`. */
  readonly apiKey?: string
  readonly model?: string
  readonly effort?: NiveauEffort
  readonly maxTokens?: number
  /**
   * Reprises internes du SDK sur erreur réseau ou 429/5xx.
   *
   * Volontairement basses : la tâche est déjà rejouée trois fois par la file de
   * travaux, et chaque tentative refacture un appel complet.
   */
  readonly maxRetries?: number
  readonly timeoutMs?: number
  /**
   * Délai au-delà duquel on cesse d'attendre un lot. Défaut : une heure.
   *
   * L'abandon ne l'annule pas : le lot poursuit son traitement chez le
   * fournisseur et reste récupérable par son identifiant. On cesse d'attendre,
   * on ne jette rien.
   */
  readonly batchTimeoutMs?: number
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

type Interpretation =
  | { readonly analyse: AnalysisResult; readonly problemes?: undefined }
  | { readonly analyse?: undefined; readonly problemes: readonly string[] }

/**
 * Lit, répare et valide la sortie du modèle.
 *
 * Les deux chemins passent par ici, donc par les mêmes barrières. Un lot qui
 * validerait moins sévèrement qu'un appel unitaire livrerait des analyses que le
 * pipeline rejetterait ensuite — c'est-à-dire des zéros.
 */
function interpreter(
  texte: string,
  request: AnalysisRequest,
  signaler: (d: DiagnosticAnalyse) => void,
): Interpretation {
  try {
    const brut = schemaLache.parse(JSON.parse(texte) as unknown)
    const repare = reparer(brut, request, signaler)
    const strict = analysisResultSchema.parse(repare)
    validateEvidence(strict, request.transcription)
    validateCriteriaScope(
      strict,
      request.criteria.map((c) => c.id),
    )
    return { analyse: strict }
  } catch (erreur) {
    if (erreur instanceof AnalysisValidationError) return { problemes: erreur.problems }
    if (erreur instanceof z.ZodError) {
      return {
        problemes: erreur.issues.map((i) => `${i.path.join('.') || 'racine'} : ${i.message}`),
      }
    }
    if (erreur instanceof SyntaxError) {
      return { problemes: ["La réponse n'est pas un JSON valide."] }
    }
    throw erreur
  }
}

// --- Fournisseur --------------------------------------------------------------

export function createAnthropicTextAnalysisProvider(
  options: AnthropicAnalysisOptions = {},
): BatchTextAnalysisProvider {
  const modele = options.model ?? MODELE_PAR_DEFAUT
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

    async analyze(request: AnalysisRequest): Promise<ProviderResponse<AnalysisResult>> {
      const debut = Date.now()

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
          message = await client.messages.create(
            construireParams(reglages, messages, INVITE_SYSTEME, SCHEMA_ANALYSE),
          )
        } catch (erreur) {
          throw erreurFournisseur(erreur)
        }

        jetonsIn += jetonsEntree(message)
        jetonsOut += message.usage.output_tokens

        verifierArret(message, modele)
        const texte = texteDe(message)
        const lecture = interpreter(texte, request, signaler)

        if (lecture.analyse !== undefined) {
          return {
            result: lecture.analyse,
            usage: {
              provider: 'anthropic',
              model: modele,
              inputTokens: jetonsIn,
              outputTokens: jetonsOut,
              pageCount: null,
              durationMs: Date.now() - debut,
            } satisfies ProviderUsage,
          }
        }

        derniersProblemes = lecture.problemes

        if (tentative === 0) {
          signaler({
            type: 'reprise',
            detail: `Analyse non conforme, reprise demandée : ${lecture.problemes.join(' ; ')}`,
          })
          messages.push(
            { role: 'assistant', content: texte },
            { role: 'user', content: composerReprise(lecture.problemes) },
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

    /**
     * Analyse un lot entier, à moitié prix.
     *
     * Corriger une épreuve n'est pas sensible à la latence : personne n'attend la
     * copie 137 pour relire la première. La remise de 50 % du traitement par lot
     * est donc acquise sans contrepartie — et c'est le seul levier de coût
     * sérieux, l'effort n'en économisant que cinq pour cent.
     *
     * Une analyse non conforme n'est pas reprise DANS le lot : elle repasse par
     * le chemin unitaire, qui sait dialoguer avec le modèle pour lui faire
     * corriger ses défauts. C'est plus cher, mais cela ne concerne qu'une
     * poignée de cas, et fabriquer un second lot pour eux ferait attendre tout
     * le monde une seconde fois.
     */
    async analyzeBatch(
      requests: readonly AnalysisRequest[],
      onProgress?: (message: string) => void,
    ): Promise<readonly BatchAnalysisOutcome[]> {
      const dire = onProgress ?? ((): void => {})
      const lots = client.messages.batches
      if (lots === undefined) {
        throw new ProviderError(
          'anthropic',
          "Ce client ne propose pas l'API de traitement par lot.",
          false,
        )
      }
      if (requests.length === 0) return []

      const debut = Date.now()

      let lot: MessageBatch
      try {
        lot = await lots.create({
          requests: requests.map((request, index) => ({
            custom_id: `r${index}`,
            params: construireParams(
              reglages,
              [{ role: 'user', content: composerMessage(request) }],
              INVITE_SYSTEME,
              SCHEMA_ANALYSE,
            ),
          })),
        })
      } catch (erreur) {
        throw erreurFournisseur(erreur)
      }

      dire(`Lot ${lot.id} déposé : ${requests.length} analyses.`)

      // Attente. L'intervalle croît pour ne pas marteler l'API sur les lots
      // longs, sans dépasser la minute — au-delà, la fin du lot passerait
      // inaperçue trop longtemps.
      let intervalle = 5_000
      const limite = Date.now() + (options.batchTimeoutMs ?? 3_600_000)
      while (lot.processing_status !== 'ended') {
        if (Date.now() > limite) {
          throw new ProviderError(
            'anthropic',
            `Le lot ${lot.id} n'a pas abouti dans le délai imparti. Il continue côté ` +
              `fournisseur : ses résultats restent récupérables par son identifiant.`,
            true,
          )
        }
        await attendre(intervalle)
        intervalle = Math.min(intervalle * 1.5, 60_000)
        try {
          lot = await lots.retrieve(lot.id)
        } catch (erreur) {
          throw erreurFournisseur(erreur)
        }
        const c = lot.request_counts
        dire(
          `Lot ${lot.id} : ${c.succeeded} abouties, ${c.processing} en cours, ` +
            `${c.errored} en erreur.`,
        )
      }

      const issues = new Map<number, BatchAnalysisOutcome>()
      const àReprendre: number[] = []

      for await (const réponse of await lots.results(lot.id)) {
        const index = Number(réponse.custom_id.slice(1))
        const request = requests[index]
        if (request === undefined) continue

        if (réponse.result.type !== 'succeeded') {
          issues.set(index, {
            index,
            response: null,
            error: new ProviderError(
              'anthropic',
              `Analyse « ${réponse.result.type} » dans le lot ${lot.id}.`,
              réponse.result.type === 'errored',
            ),
          })
          continue
        }

        const message = réponse.result.message
        try {
          verifierArret(message, modele)
        } catch (erreur) {
          issues.set(index, {
            index,
            response: null,
            error:
              erreur instanceof ProviderError
                ? erreur
                : new ProviderError('anthropic', String(erreur), false),
          })
          continue
        }

        const lecture = interpreter(texteDe(message), request, signaler)
        if (lecture.analyse === undefined) {
          // Non conforme : le chemin unitaire saura lui faire corriger ses
          // défauts, ce qu'un lot ne permet pas.
          àReprendre.push(index)
          continue
        }

        issues.set(index, {
          index,
          response: {
            result: lecture.analyse,
            usage: {
              provider: 'anthropic-batch',
              model: modele,
              inputTokens: jetonsEntree(message),
              outputTokens: message.usage.output_tokens,
              pageCount: null,
              // Durée du lot entier rapportée à une analyse : une durée par lot
              // n'aurait pas de sens dans une moyenne par réponse.
              durationMs: Math.round((Date.now() - debut) / requests.length),
            } satisfies ProviderUsage,
          },
          error: null,
        })
      }

      if (àReprendre.length > 0) {
        dire(`${àReprendre.length} analyse(s) non conforme(s) : reprise au tarif unitaire.`)
      }

      for (const index of àReprendre) {
        const request = requests[index]
        if (request === undefined) continue
        try {
          issues.set(index, { index, response: await this.analyze(request), error: null })
        } catch (erreur) {
          issues.set(index, {
            index,
            response: null,
            error:
              erreur instanceof ProviderError
                ? erreur
                : new ProviderError('anthropic', String(erreur), false),
          })
        }
      }

      // Toute demande reçoit une issue, y compris celles que le lot n'a pas
      // rendues : un tableau plus court que celui des demandes ferait glisser
      // les indices chez l'appelant, donc attribuer des notes aux mauvaises copies.
      return requests.map(
        (_, index) =>
          issues.get(index) ?? {
            index,
            response: null,
            error: new ProviderError(
              'anthropic',
              `Le lot ${lot.id} n'a rendu aucun résultat pour cette analyse.`,
              true,
            ),
          },
      )
    },
  }
}
