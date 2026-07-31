import { describe, expect, it } from 'vitest'
import {
  CONFIDENCE_LABELS,
  ConfidenceError,
  DEFAULT_THRESHOLDS,
  assertValidThresholds,
  computeConfidence,
  confidenceScore,
  levelFor,
  requiresCarefulReview,
  type ConfidenceFactors,
  type ConfidencePenalties,
} from './confidence'

const sansPénalité: ConfidencePenalties = {
  hasUncertainSpans: false,
  hasContradiction: false,
  hasUnexpectedElement: false,
  analysesDisagree: false,
}

const analyseNette: ConfidenceFactors = {
  ocr: 0.98,
  criteriaMatch: 0.95,
  evidenceCoverage: 1,
}

describe('confidence — score', () => {
  it('accepte les scores dans [0, 1]', () => {
    expect(confidenceScore(0)).toBe(0)
    expect(confidenceScore(1)).toBe(1)
    expect(confidenceScore(0.73)).toBe(0.73)
  })

  it('rejette les scores hors bornes', () => {
    expect(() => confidenceScore(-0.1)).toThrow(ConfidenceError)
    expect(() => confidenceScore(1.1)).toThrow(ConfidenceError)
    expect(() => confidenceScore(Number.NaN)).toThrow(ConfidenceError)
  })
})

describe('confidence — niveaux', () => {
  it('applique les seuils du cahier des charges', () => {
    expect(levelFor(confidenceScore(0.95))).toBe('green')
    expect(levelFor(confidenceScore(0.9))).toBe('green')
    expect(levelFor(confidenceScore(0.89))).toBe('orange')
    expect(levelFor(confidenceScore(0.65))).toBe('orange')
    expect(levelFor(confidenceScore(0.64))).toBe('red')
    expect(levelFor(confidenceScore(0))).toBe('red')
  })

  it('respecte des seuils personnalisés', () => {
    const strict = { greenMin: 97, orangeMin: 80 }
    expect(levelFor(confidenceScore(0.95), strict)).toBe('orange')
    expect(levelFor(confidenceScore(0.98), strict)).toBe('green')
    expect(levelFor(confidenceScore(0.75), strict)).toBe('red')
  })

  it('refuse des seuils qui videraient la bande orange', () => {
    expect(() => assertValidThresholds({ greenMin: 80, orangeMin: 80 })).toThrow(ConfidenceError)
    expect(() => assertValidThresholds({ greenMin: 70, orangeMin: 90 })).toThrow(ConfidenceError)
  })

  it('nomme chaque niveau en français', () => {
    expect(CONFIDENCE_LABELS.green).toBe('Confiance élevée')
    expect(CONFIDENCE_LABELS.red).toBe('Validation humaine requise')
  })
})

describe('confidence — calcul', () => {
  it('classe une analyse nette en vert', () => {
    const score = computeConfidence(analyseNette, sansPénalité)
    expect(levelFor(score, DEFAULT_THRESHOLDS)).toBe('green')
  })

  it('fait chuter la confiance quand l’OCR est mauvais', () => {
    const ocrFaible = computeConfidence({ ...analyseNette, ocr: 0.4 }, sansPénalité)
    expect(levelFor(ocrFaible)).toBe('red')
  })

  it('pénalise les passages incertains', () => {
    const avec = computeConfidence(analyseNette, { ...sansPénalité, hasUncertainSpans: true })
    const sans = computeConfidence(analyseNette, sansPénalité)
    expect(avec).toBeLessThan(sans)
  })

  it('fait du désaccord entre analyses la pénalité la plus lourde', () => {
    const désaccord = computeConfidence(analyseNette, { ...sansPénalité, analysesDisagree: true })
    const contradiction = computeConfidence(analyseNette, {
      ...sansPénalité,
      hasContradiction: true,
    })
    expect(désaccord).toBeLessThan(contradiction)
  })

  it('déclasse une réponse correcte non prévue', () => {
    // Une réponse juste absente du corrigé ne doit jamais passer en vert :
    // c'est précisément le cas où l'enseignant doit trancher.
    const score = computeConfidence(analyseNette, {
      ...sansPénalité,
      hasUnexpectedElement: true,
    })
    expect(levelFor(score)).not.toBe('green')
  })

  it('ne descend jamais sous zéro ni au-dessus de un', () => {
    const pire = computeConfidence(
      { ocr: 0, criteriaMatch: 0, evidenceCoverage: 0 },
      {
        hasUncertainSpans: true,
        hasContradiction: true,
        hasUnexpectedElement: true,
        analysesDisagree: true,
      },
    )
    expect(pire).toBe(0)

    const meilleur = computeConfidence(
      { ocr: 1, criteriaMatch: 1, evidenceCoverage: 1 },
      sansPénalité,
    )
    expect(meilleur).toBe(1)
  })

  it('rejette un facteur hors bornes', () => {
    expect(() => computeConfidence({ ...analyseNette, ocr: 1.5 }, sansPénalité)).toThrow(
      ConfidenceError,
    )
  })
})

describe('confidence — validation humaine attentive', () => {
  it('exige un examen attentif pour tout ce qui n’est pas vert', () => {
    expect(requiresCarefulReview('red', sansPénalité)).toBe(true)
    expect(requiresCarefulReview('orange', sansPénalité)).toBe(true)
    expect(requiresCarefulReview('green', sansPénalité)).toBe(false)
  })

  it('exige un examen attentif même en vert si la réponse est inattendue', () => {
    expect(requiresCarefulReview('green', { ...sansPénalité, hasUnexpectedElement: true })).toBe(
      true,
    )
    expect(requiresCarefulReview('green', { ...sansPénalité, analysesDisagree: true })).toBe(true)
  })
})
