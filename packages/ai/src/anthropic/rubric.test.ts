import { describe, expect, it } from 'vitest'
import type { Message } from '@anthropic-ai/sdk/resources/messages'

import { createAnthropicRubricDraftProvider, type DiagnosticBarème } from './rubric'
import { createMockRubricDraftProvider } from '../mock/rubric'
import { ProviderError } from '../providers'
import { fromMillipoints } from '@coteris/shared'
import type { RubricDraftRequest } from '../rubric-draft'

const CORRIGÉ =
  "Administrer de l'iode stable pour saturer la thyroïde. " +
  "Respecter un délai de deux heures avant l'injection. " +
  'Vérifier la fonction rénale du patient.'

function demande(): RubricDraftRequest {
  return {
    questionPrompt: 'Quelles précautions avant une injection de produit iodé ?',
    answerKeyText: CORRIGÉ,
    maxPoints: fromMillipoints(3000),
    language: 'fr',
  }
}

function reponse(charge: unknown): Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    container: null,
    stop_reason: 'end_turn',
    stop_details: null,
    stop_sequence: null,
    content: [{ type: 'text', text: JSON.stringify(charge), citations: null }],
    usage: {
      input_tokens: 800,
      output_tokens: 400,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      cache_creation: null,
      inference_geo: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: null,
    },
  }
}

function client(...file: Message[]): { messages: { create(): Promise<Message> } } {
  let i = 0
  return {
    messages: {
      create(): Promise<Message> {
        const m = file[i]
        i += 1
        if (m === undefined) throw new Error('Appel inattendu au modèle.')
        return Promise.resolve(m)
      },
    },
  }
}

const VALIDE = {
  critères: [
    {
      label: 'Iode stable',
      citation: "Administrer de l'iode stable",
      acceptableAnswers: ['iode stable', 'iode non radioactif'],
      poids: 2,
    },
    {
      label: 'Délai de deux heures',
      citation: 'Respecter un délai de deux heures',
      acceptableAnswers: ['deux heures'],
      poids: 1,
    },
  ],
  passagesNonCouverts: ['Vérifier la fonction rénale du patient.'],
}

describe('createAnthropicRubricDraftProvider', () => {
  it('rend une proposition conforme', async () => {
    const diagnostics: DiagnosticBarème[] = []
    const p = createAnthropicRubricDraftProvider({
      client: client(reponse(VALIDE)) as never,
      onDiagnostic: (d) => diagnostics.push(d),
    })

    const { result, usage } = await p.proposeRubric(demande())
    expect(result.critères).toHaveLength(2)
    expect(result.passagesNonCouverts).toHaveLength(1)
    expect(usage.provider).toBe('anthropic')
    expect(diagnostics).toHaveLength(0)
  })

  it('refuse un critère absent du corrigé, même pédagogiquement juste', async () => {
    // Le mode d'échec central de ce chantier. « Recueillir le consentement
    // éclairé » est cliniquement irréprochable et totalement absent du corrigé.
    // Accepté, il noterait tous les étudiants sur un attendu que leur enseignant
    // n'a jamais formulé.
    const inventé = {
      critères: [
        {
          label: 'Consentement éclairé',
          citation: 'Recueillir le consentement éclairé du patient',
          acceptableAnswers: ['consentement'],
          poids: 1,
        },
      ],
      passagesNonCouverts: [],
    }

    const p = createAnthropicRubricDraftProvider({
      client: client(reponse(inventé), reponse(inventé)) as never,
    })

    await expect(p.proposeRubric(demande())).rejects.toBeInstanceOf(ProviderError)
  })

  it('accepte à la reprise ce qu’il a refusé au premier tour', async () => {
    const diagnostics: DiagnosticBarème[] = []
    const inventé = {
      critères: [
        { label: 'Hors sujet', citation: 'Phrase absente du corrigé', acceptableAnswers: [], poids: 1 },
      ],
      passagesNonCouverts: [],
    }

    const p = createAnthropicRubricDraftProvider({
      client: client(reponse(inventé), reponse(VALIDE)) as never,
      onDiagnostic: (d) => diagnostics.push(d),
    })

    const { result, usage } = await p.proposeRubric(demande())
    expect(result.critères).toHaveLength(2)
    expect(diagnostics.some((d) => d.type === 'reprise')).toBe(true)
    // Les deux appels sont facturés : la reprise ne doit pas être invisible.
    expect(usage.outputTokens).toBe(800)
  })

  it('écarte un critère sans citation plutôt que de le compléter', async () => {
    const diagnostics: DiagnosticBarème[] = []
    const bancal = {
      critères: [
        { label: 'Sans citation', citation: '   ', acceptableAnswers: [], poids: 1 },
        VALIDE.critères[0],
      ],
      passagesNonCouverts: [],
    }

    const p = createAnthropicRubricDraftProvider({
      client: client(reponse(bancal)) as never,
      onDiagnostic: (d) => diagnostics.push(d),
    })

    const { result } = await p.proposeRubric(demande())
    expect(result.critères).toHaveLength(1)
    expect(diagnostics.some((d) => d.type === 'critere_ecarte')).toBe(true)
  })

  it('borne un poids hors intervalle sans rejeter la proposition', async () => {
    const p = createAnthropicRubricDraftProvider({
      client: client(
        reponse({
          critères: [{ ...VALIDE.critères[0], poids: 99 }],
          passagesNonCouverts: [],
        }),
      ) as never,
    })

    const { result } = await p.proposeRubric(demande())
    expect(result.critères[0]?.poids).toBe(5)
  })

  it('traite un refus du modèle comme une erreur définitive', async () => {
    const refus: Message = {
      ...reponse({}),
      stop_reason: 'refusal',
      stop_details: { type: 'refusal', category: 'bio', explanation: null },
    }
    const p = createAnthropicRubricDraftProvider({ client: client(refus) as never })
    await expect(p.proposeRubric(demande())).rejects.toMatchObject({ retryable: false })
  })
})

describe('createMockRubricDraftProvider', () => {
  it('produit des citations réellement tirées du corrigé', async () => {
    // Le simulateur doit franchir la même barrière qu'un vrai fournisseur, sans
    // quoi il ne prouverait rien de la mécanique en aval.
    const { result } = await createMockRubricDraftProvider().proposeRubric(demande())
    expect(result.critères.length).toBeGreaterThan(0)
    for (const critère of result.critères) {
      expect(CORRIGÉ).toContain(critère.citation)
    }
  })

  it('signale ce qu’il n’a pas couvert', async () => {
    const { result } = await createMockRubricDraftProvider({ maxCritères: 1 }).proposeRubric(
      demande(),
    )
    expect(result.critères).toHaveLength(1)
    expect(result.passagesNonCouverts.length).toBeGreaterThan(0)
  })
})
