import { describe, expect, it } from 'vitest'

import { computeCost, microToEur } from './cost'
import { estimateUsageFor } from './estimate'
import type { AnalysisRequest } from './providers'

function demande(surcharge: Partial<AnalysisRequest> = {}): AnalysisRequest {
  return {
    questionPrompt: 'Quelle précaution prendre avant une injection de produit iodé ?',
    answerKeyText: "Administrer de l'iode stable pour saturer la thyroïde.",
    criteria: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        label: 'Iode non radioactif',
        description: null,
        acceptableAnswers: ['iode stable'],
        expectedElementCount: 1,
      },
    ],
    transcription: "Il faut donner de l'iode non radioactif.",
    language: 'fr',
    ...surcharge,
  }
}

describe('estimateUsageFor', () => {
  it('surestime plutôt que de sous-estimer', () => {
    // Un garde-fou qui sous-estime laisse passer exactement ce qu'il devait
    // arrêter. Le rapport caractères/jetons retenu est plus pessimiste que le
    // rapport réel du français, et la sortie supposée dépasse la moyenne mesurée.
    const usage = estimateUsageFor(demande(), 'anthropic', 'claude-opus-5')
    const caracteres = 200 // ordre de grandeur de la demande ci-dessus

    expect(usage.inputTokens).toBeGreaterThan(caracteres / 4)
    expect(usage.outputTokens).toBeGreaterThan(1300) // moyenne mesurée sur 208 réponses
  })

  it('croît avec la taille de la copie', () => {
    const courte = estimateUsageFor(demande(), 'anthropic', 'claude-opus-5')
    const longue = estimateUsageFor(
      demande({ transcription: 'mot '.repeat(500) }),
      'anthropic',
      'claude-opus-5',
    )
    expect(longue.inputTokens ?? 0).toBeGreaterThan(courte.inputTokens ?? 0)
  })

  it('produit une estimation exploitable par computeCost', () => {
    // C'est tout l'objet du fichier : rendre applicable le principe « le quota
    // est vérifié AVANT l'appel », que l'interface du fournisseur ne permettait pas.
    const cout = computeCost(estimateUsageFor(demande(), 'anthropic', 'claude-opus-5'))
    expect(microToEur(cout)).toBeGreaterThan(0)
    expect(microToEur(cout)).toBeLessThan(0.5)
  })

  it('reste à zéro pour le simulateur', () => {
    const cout = computeCost(estimateUsageFor(demande(), 'mock', 'mock-analysis'))
    expect(cout).toBe(0)
  })
})
