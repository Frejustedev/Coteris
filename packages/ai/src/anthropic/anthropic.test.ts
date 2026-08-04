/**
 * Tests du fournisseur Anthropic, entièrement hors réseau.
 *
 * Chaque test correspond à un mode d'échec réel qui, sans traitement, se
 * traduirait en aval par une **note de zéro enregistrée et scellée** plutôt que
 * par une erreur visible. C'est la raison d'être de ce fichier : le simulateur
 * ne peut produire aucune de ces sorties, donc aucun test existant ne les couvre.
 */

import { describe, expect, it } from 'vitest'
import { APIError, RateLimitError } from '@anthropic-ai/sdk'
import type { Message } from '@anthropic-ai/sdk/resources/messages'
import type { MessageBatch } from '@anthropic-ai/sdk/resources/messages/batches'

import { createAnthropicTextAnalysisProvider, type DiagnosticAnalyse } from './index'
import { ProviderError, type AnalysisRequest } from '../providers'

const C1 = '11111111-1111-4111-8111-111111111111'
const C2 = '22222222-2222-4222-8222-222222222222'
const HORS_BAREME = '99999999-9999-4999-8999-999999999999'

const TRANSCRIPTION =
  "Il faut donner de l'iode non radioactif pour protéger la thyroïde avant l'injection."

function demande(surcharge: Partial<AnalysisRequest> = {}): AnalysisRequest {
  return {
    questionPrompt: 'Quelle précaution prendre avant une injection de produit iodé ?',
    answerKeyText: "Administrer de l'iode stable pour saturer la thyroïde.",
    criteria: [
      {
        id: C1,
        label: 'Iode non radioactif',
        description: null,
        acceptableAnswers: ['iode stable', 'iode non radioactif'],
        expectedElementCount: 1,
      },
      {
        id: C2,
        label: 'Protection de la thyroïde',
        description: null,
        acceptableAnswers: ['thyroïde'],
        expectedElementCount: 1,
      },
    ],
    transcription: TRANSCRIPTION,
    language: 'fr',
    ...surcharge,
  }
}

/** Fabrique une réponse d'API, avec juste ce que le fournisseur en lit. */
function reponse(
  charge: unknown,
  options: {
    stopReason?: Message['stop_reason']
    stopDetails?: Message['stop_details']
    inputTokens?: number
    outputTokens?: number
    cacheCreation?: number | null
    cacheRead?: number | null
  } = {},
): Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    container: null,
    stop_reason: options.stopReason ?? 'end_turn',
    stop_details: options.stopDetails ?? null,
    stop_sequence: null,
    content: [{ type: 'text', text: JSON.stringify(charge), citations: null }],
    usage: {
      input_tokens: options.inputTokens ?? 1000,
      output_tokens: options.outputTokens ?? 200,
      cache_creation_input_tokens: options.cacheCreation ?? null,
      cache_read_input_tokens: options.cacheRead ?? null,
      cache_creation: null,
      inference_geo: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: null,
    },
  }
}

/** Client de test : sert les réponses de la file, dans l'ordre. */
function clientAvec(...file: Message[]): {
  client: { messages: { create(): Promise<Message> } }
  appels: () => number
} {
  let index = 0
  return {
    client: {
      messages: {
        create(): Promise<Message> {
          const message = file[index]
          index += 1
          if (message === undefined) throw new Error('Appel inattendu au modèle.')
          return Promise.resolve(message)
        },
      },
    },
    appels: () => index,
  }
}

/** Sortie nominale, conforme et complète. */
function analyseValide(): Record<string, unknown> {
  return {
    presentCriteria: [
      { criterionId: C1, excerpts: ["l'iode non radioactif"], matchedElementCount: 1 },
    ],
    partialCriteria: [],
    missingCriteria: [C2],
    contradictions: [],
    factualErrors: [],
    unexpectedElements: [],
    uncertainSpans: [],
    needsHumanReview: true,
    matchClarity: 0.9,
  }
}

function fournisseur(
  file: Message[],
  diagnostics: DiagnosticAnalyse[] = [],
): ReturnType<typeof createAnthropicTextAnalysisProvider> {
  const { client } = clientAvec(...file)
  return createAnthropicTextAnalysisProvider({
    client: client as never,
    onDiagnostic: (d) => diagnostics.push(d),
  })
}

describe('createAnthropicTextAnalysisProvider', () => {
  it('retourne une analyse conforme et son usage', async () => {
    const p = fournisseur([reponse(analyseValide(), { inputTokens: 1200, outputTokens: 300 })])
    const { result, usage } = await p.analyze(demande())

    expect(result.presentCriteria).toHaveLength(1)
    expect(result.missingCriteria).toEqual([C2])
    expect(usage.provider).toBe('anthropic')
    expect(usage.model).toBe('claude-opus-5')
    expect(usage.outputTokens).toBe(300)
  })

  it('agrège les jetons de cache dans les jetons d\'entrée facturés', async () => {
    // `input_tokens` ne compte que le reliquat non caché. Ignorer les deux autres
    // compteurs ferait facturer à l'organisation une fraction du coût réel.
    const p = fournisseur([
      reponse(analyseValide(), { inputTokens: 100, cacheCreation: 800, cacheRead: 300 }),
    ])
    const { usage } = await p.analyze(demande())
    expect(usage.inputTokens).toBe(1200)
  })

  it('recale un extrait dont les accents ont été perdus', async () => {
    // `validateEvidence` ne tolère pas les accents. Sans recalage, cette sortie
    // parfaitement honnête ferait tomber la question entière à zéro.
    const diagnostics: DiagnosticAnalyse[] = []
    const charge = analyseValide()
    charge['presentCriteria'] = [
      { criterionId: C1, excerpts: ['proteger la thyroide'], matchedElementCount: 1 },
    ]
    const p = fournisseur([reponse(charge)], diagnostics)

    const { result } = await p.analyze(demande())

    expect(result.presentCriteria[0]?.excerpts[0]).toBe('protéger la thyroïde')
    expect(diagnostics.some((d) => d.type === 'extrait_recale')).toBe(true)
  })

  it('rétrograde en absent un critère dont la seule preuve est fabriquée', async () => {
    const diagnostics: DiagnosticAnalyse[] = []
    const charge = analyseValide()
    charge['presentCriteria'] = [
      { criterionId: C1, excerpts: ['une phrase que la copie ne contient pas'], matchedElementCount: 1 },
    ]
    const p = fournisseur([reponse(charge)], diagnostics)

    const { result } = await p.analyze(demande())

    expect(result.presentCriteria).toHaveLength(0)
    expect(result.missingCriteria).toContain(C1)
    expect(diagnostics.some((d) => d.type === 'extrait_fabrique')).toBe(true)
    expect(diagnostics.some((d) => d.type === 'critere_retrograde')).toBe(true)
  })

  it('tronque une explication trop longue au lieu de rejeter l\'analyse', async () => {
    // Les sorties structurées ne transportent pas `maxLength` : le modèle n'est
    // pas contraint, mais zod l'est. 520 caractères en français soigné suffisent
    // à invalider toute la question.
    const diagnostics: DiagnosticAnalyse[] = []
    const charge = analyseValide()
    charge['factualErrors'] = [
      { criterionId: C1, excerpt: "l'iode non radioactif", explanation: 'a'.repeat(520) },
    ]
    const p = fournisseur([reponse(charge)], diagnostics)

    const { result } = await p.analyze(demande())

    expect(result.factualErrors[0]?.explanation.length).toBeLessThanOrEqual(500)
    expect(diagnostics.some((d) => d.type === 'texte_tronque')).toBe(true)
  })

  it('écarte un identifiant de critère absent du barème', async () => {
    const diagnostics: DiagnosticAnalyse[] = []
    const charge = analyseValide()
    charge['partialCriteria'] = [
      { criterionId: HORS_BAREME, excerpts: ["l'injection"], matchedElementCount: 1 },
    ]
    const p = fournisseur([reponse(charge)], diagnostics)

    const { result } = await p.analyze(demande())

    expect(result.partialCriteria).toHaveLength(0)
    expect(diagnostics.some((d) => d.type === 'critere_hors_bareme')).toBe(true)
  })

  it('écarte une contradiction portée sur un critère classé absent', async () => {
    // En aval, l'extrait d'un problème n'est pas recopié dans les preuves du
    // critère : l'enseignant lirait « laissé à zéro faute d'extrait » alors que
    // le modèle en avait fourni un.
    const charge = analyseValide()
    charge['contradictions'] = [
      { criterionId: C2, excerpt: 'la thyroïde', explanation: 'Contredit plus loin.' },
    ]
    const p = fournisseur([reponse(charge)])

    const { result } = await p.analyze(demande())
    expect(result.contradictions).toHaveLength(0)
  })

  it('borne matchClarity et impose la relecture humaine', async () => {
    const charge = analyseValide()
    charge['matchClarity'] = 1.7
    charge['needsHumanReview'] = false
    const p = fournisseur([reponse(charge)])

    const { result } = await p.analyze(demande())

    expect(result.matchClarity).toBe(1)
    expect(result.needsHumanReview).toBe(true)
  })

  it('écarte un passage incertain dont la citation est inventée', async () => {
    // `validateEvidence` ne vérifie pas `uncertainSpans` : c'est le seul endroit
    // du produit où une citation non confrontée à la copie atteindrait la base.
    const charge = analyseValide()
    charge['uncertainSpans'] = [{ excerpt: 'texte totalement inventé', reason: 'Écriture illisible.' }]
    const p = fournisseur([reponse(charge)])

    const { result } = await p.analyze(demande())
    expect(result.uncertainSpans).toHaveLength(0)
  })

  it('redemande une analyse quand un critère a été oublié, et accepte la reprise', async () => {
    const diagnostics: DiagnosticAnalyse[] = []
    const incomplete = analyseValide()
    incomplete['missingCriteria'] = [] // C2 n'est classé nulle part

    const p = fournisseur([reponse(incomplete), reponse(analyseValide())], diagnostics)
    const { result, usage } = await p.analyze(demande())

    expect(result.missingCriteria).toEqual([C2])
    expect(diagnostics.some((d) => d.type === 'reprise')).toBe(true)
    // Les deux appels sont facturés : la reprise ne doit pas être invisible.
    expect(usage.inputTokens).toBe(2000)
    expect(usage.outputTokens).toBe(400)
  })

  it('échoue bruyamment si la reprise ne corrige rien', async () => {
    // Retourner ici une analyse vide produirait un zéro signé, indiscernable
    // d'une copie blanche correctement analysée.
    const incomplete = analyseValide()
    incomplete['missingCriteria'] = []

    const p = fournisseur([reponse(incomplete), reponse(incomplete)])

    await expect(p.analyze(demande())).rejects.toBeInstanceOf(ProviderError)
  })

  it('traite un refus du modèle comme une erreur, jamais comme une analyse', async () => {
    const p = fournisseur([
      reponse(
        {},
        { stopReason: 'refusal', stopDetails: { type: 'refusal', category: 'bio', explanation: null } },
      ),
    ])

    await expect(p.analyze(demande())).rejects.toMatchObject({
      name: 'ProviderError',
      retryable: false,
    })
  })

  it('traite une réponse tronquée comme une erreur rejouable', async () => {
    const p = fournisseur([reponse(analyseValide(), { stopReason: 'max_tokens' })])

    await expect(p.analyze(demande())).rejects.toMatchObject({
      name: 'ProviderError',
      retryable: true,
    })
  })

  it('distingue une erreur rejouable d\'une erreur définitive', async () => {
    // Un solde épuisé ou une clé révoquée reviennent en 400. Les traiter comme
    // rejouables ferait rejouer la tâche trois fois par la file de travaux, plus
    // les reprises du SDK — jusqu'à neuf appels pour un échec certain.
    const erreurDe = (classe: new (...args: never[]) => Error, message: string, status?: number): Error => {
      const e = Object.create(classe.prototype) as Error & { status?: number }
      Object.defineProperty(e, 'message', { value: message, enumerable: false })
      if (status !== undefined) e.status = status
      return e
    }

    const clientQuiLeve = (erreur: Error): { messages: { create(): Promise<Message> } } => ({
      messages: {
        create(): Promise<Message> {
          throw erreur
        },
      },
    })

    const définitif = createAnthropicTextAnalysisProvider({
      client: clientQuiLeve(erreurDe(APIError, 'Your credit balance is too low', 400)) as never,
    })
    await expect(définitif.analyze(demande())).rejects.toMatchObject({ retryable: false })

    const rejouable = createAnthropicTextAnalysisProvider({
      client: clientQuiLeve(erreurDe(RateLimitError, 'rate limited', 429)) as never,
    })
    await expect(rejouable.analyze(demande())).rejects.toMatchObject({ retryable: true })
  })

  it('traite un lot, remet les résultats dans l\'ordre et applique le tarif du lot', async () => {
    // Un lot rend ses résultats en désordre. Les recoller par position
    // attribuerait les analyses aux mauvaises copies — une faute silencieuse et
    // irrattrapable une fois les notes proposées.
    const charge2 = analyseValide()
    charge2['presentCriteria'] = [
      { criterionId: C2, excerpts: ['la thyroïde'], matchedElementCount: 1 },
    ]
    charge2['missingCriteria'] = [C1]

    const lot: MessageBatch = {
      id: 'batch_test',
      type: 'message_batch',
      processing_status: 'ended',
      created_at: '2026-08-04T00:00:00Z',
      expires_at: '2026-08-05T00:00:00Z',
      ended_at: '2026-08-04T00:10:00Z',
      archived_at: null,
      cancel_initiated_at: null,
      results_url: null,
      request_counts: { canceled: 0, errored: 0, expired: 0, processing: 0, succeeded: 2 },
    }

    const client = {
      messages: {
        create(): Promise<Message> {
          throw new Error('Le chemin unitaire ne doit pas être emprunté ici.')
        },
        batches: {
          create: () => Promise.resolve(lot),
          retrieve: () => Promise.resolve(lot),
          // Volontairement en ordre inverse.
          results: () =>
            Promise.resolve(
              (async function* () {
                yield {
                  custom_id: 'r1',
                  result: { type: 'succeeded' as const, message: reponse(charge2) },
                }
                yield {
                  custom_id: 'r0',
                  result: { type: 'succeeded' as const, message: reponse(analyseValide()) },
                }
              })(),
            ),
        },
      },
    }

    const p = createAnthropicTextAnalysisProvider({ client: client as never })
    const issues = await p.analyzeBatch([demande(), demande()])

    expect(issues).toHaveLength(2)
    expect(issues[0]?.index).toBe(0)
    expect(issues[0]?.response?.result.presentCriteria[0]?.criterionId).toBe(C1)
    expect(issues[1]?.response?.result.presentCriteria[0]?.criterionId).toBe(C2)
    // Le tarif du lot est distinct : le facturer au prix unitaire annulerait
    // dans les comptes l'économie qu'il produit.
    expect(issues[0]?.response?.usage.provider).toBe('anthropic-batch')
  })

  it('rend une erreur en place pour une analyse ratée, sans emporter le reste du lot', async () => {
    const lot: MessageBatch = {
      id: 'batch_test',
      type: 'message_batch',
      processing_status: 'ended',
      created_at: '2026-08-04T00:00:00Z',
      expires_at: '2026-08-05T00:00:00Z',
      ended_at: '2026-08-04T00:10:00Z',
      archived_at: null,
      cancel_initiated_at: null,
      results_url: null,
      request_counts: { canceled: 0, errored: 1, expired: 0, processing: 0, succeeded: 1 },
    }

    const client = {
      messages: {
        create(): Promise<Message> {
          throw new Error('Le chemin unitaire ne doit pas être emprunté ici.')
        },
        batches: {
          create: () => Promise.resolve(lot),
          retrieve: () => Promise.resolve(lot),
          results: () =>
            Promise.resolve(
              (async function* () {
                yield {
                  custom_id: 'r0',
                  result: { type: 'succeeded' as const, message: reponse(analyseValide()) },
                }
                yield { custom_id: 'r1', result: { type: 'expired' as const } }
              })(),
            ),
        },
      },
    }

    const p = createAnthropicTextAnalysisProvider({ client: client as never })
    const issues = await p.analyzeBatch([demande(), demande()])

    expect(issues[0]?.response).not.toBeNull()
    expect(issues[1]?.response).toBeNull()
    expect(issues[1]?.error).toBeInstanceOf(ProviderError)
  })

  it('classe une copie vierge sans inventer de preuve', async () => {
    const vide = {
      presentCriteria: [],
      partialCriteria: [],
      missingCriteria: [C1, C2],
      contradictions: [],
      factualErrors: [],
      unexpectedElements: [],
      uncertainSpans: [],
      needsHumanReview: true,
      matchClarity: 1,
    }
    const p = fournisseur([reponse(vide)])

    const { result } = await p.analyze(demande({ transcription: '' }))
    expect(result.missingCriteria).toEqual([C1, C2])
  })
})
