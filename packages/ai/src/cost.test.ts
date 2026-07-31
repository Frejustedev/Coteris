import { describe, expect, it } from 'vitest'
import {
  QuotaExceededError,
  checkQuota,
  computeCost,
  eurToMicro,
  formatEur,
  microEur,
  microToEur,
  type QuotaState,
} from './cost'

describe('montants en millionièmes d’euro', () => {
  it('convertit depuis les euros', () => {
    expect(eurToMicro(1)).toBe(1_000_000)
    expect(eurToMicro(0.0003)).toBe(300)
    expect(eurToMicro(50)).toBe(50_000_000)
  })

  it('reste exact là où la virgule flottante dérive', () => {
    // Dix mille appels à 0,0003 € font exactement 3 €.
    let total = 0
    for (let i = 0; i < 10_000; i++) total += eurToMicro(0.0003)
    expect(total).toBe(3_000_000)
    expect(microToEur(microEur(total))).toBe(3)
  })

  it('formate en euros pour un lecteur francophone', () => {
    expect(formatEur(eurToMicro(1.5))).toContain('1,50')
    expect(formatEur(eurToMicro(1.5))).toContain('€')
  })
})

describe('calcul du coût', () => {
  it('calcule un appel du fournisseur simulé à zéro', () => {
    const cost = computeCost({
      provider: 'mock',
      model: 'mock-analysis',
      inputTokens: 1500,
      outputTokens: 300,
      pageCount: null,
    })
    expect(cost).toBe(0)
  })

  it('refuse de calculer un tarif inconnu', () => {
    // Compter un appel à zéro parce que son tarif manque produirait un modèle de
    // coût faux, donc un prix de vente faux.
    expect(() =>
      computeCost({
        provider: 'un-fournisseur',
        model: 'un-modele',
        inputTokens: 100,
        outputTokens: 100,
        pageCount: null,
      }),
    ).toThrow(/Tarif inconnu/)
  })
})

describe('coupe-circuit', () => {
  const état = (over: Partial<QuotaState> = {}): QuotaState => ({
    organizationId: 'org',
    spentThisMonth: eurToMicro(10),
    monthlyBudget: eurToMicro(50),
    spentOnAssessment: eurToMicro(2),
    perAssessmentBudget: eurToMicro(10),
    suspended: false,
    suspensionReason: null,
    ...over,
  })

  it('autorise un appel dans les limites', () => {
    const d = checkQuota(état(), eurToMicro(0.5))
    expect(d.allowed).toBe(true)
    if (d.allowed) expect(microToEur(d.remainingThisMonth)).toBeCloseTo(39.5)
  })

  it('refuse quand l’organisation est suspendue', () => {
    const d = checkQuota(état({ suspended: true, suspensionReason: 'Impayé' }), eurToMicro(0.1))
    expect(d.allowed).toBe(false)
    if (!d.allowed) {
      expect(d.code).toBe('suspended')
      expect(d.reason).toBe('Impayé')
    }
  })

  it('refuse quand le budget mensuel est atteint', () => {
    const d = checkQuota(état({ spentThisMonth: eurToMicro(50) }), eurToMicro(0.1))
    expect(d.allowed).toBe(false)
    if (!d.allowed) expect(d.code).toBe('monthly_budget_exhausted')
  })

  it('refuse un appel qui ferait DÉPASSER le budget, avant qu’il soit émis', () => {
    // C'est tout l'intérêt : compter après ne ferait que constater la facture.
    const d = checkQuota(état({ spentThisMonth: eurToMicro(49.9) }), eurToMicro(0.5))
    expect(d.allowed).toBe(false)
    if (!d.allowed) expect(d.code).toBe('would_exceed_monthly_budget')
  })

  it('applique aussi un budget par épreuve', () => {
    const d = checkQuota(état({ spentOnAssessment: eurToMicro(9.9) }), eurToMicro(0.5))
    expect(d.allowed).toBe(false)
    if (!d.allowed) expect(d.code).toBe('would_exceed_assessment_budget')
  })

  it('donne un motif lisible par un enseignant', () => {
    const d = checkQuota(état({ spentThisMonth: eurToMicro(50) }), eurToMicro(0.1))
    if (!d.allowed) {
      expect(d.reason).toContain('50,00')
      expect(new QuotaExceededError(d).message).toBe(d.reason)
    }
  })

  it('n’admet aucune notion de budget illimité', () => {
    // Une offre illimitée adossée à un coût variable est un risque non borné.
    const d = checkQuota(état({ monthlyBudget: eurToMicro(0) }), eurToMicro(0.001))
    expect(d.allowed).toBe(false)
  })
})
