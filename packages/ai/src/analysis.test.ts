import { describe, expect, it } from 'vitest'
import {
  AnalysisValidationError,
  analysisResultSchema,
  inconclusiveAnalysis,
  validateCriteriaScope,
  validateEvidence,
  type AnalysisResult,
} from './analysis'

const C1 = '11111111-1111-4111-8111-111111111111'
const C2 = '22222222-2222-4222-8222-222222222222'
const C3 = '33333333-3333-4333-8333-333333333333'

const TRANSCRIPTION =
  "Il faut donner de l'iode non radioactif pour protéger la thyroïde avant l'injection."

const base = (over: Partial<AnalysisResult> = {}): AnalysisResult => ({
  presentCriteria: [],
  partialCriteria: [],
  missingCriteria: [],
  contradictions: [],
  factualErrors: [],
  unexpectedElements: [],
  uncertainSpans: [],
  needsHumanReview: true,
  matchClarity: 0.9,
  ...over,
})

describe('schéma de sortie', () => {
  it('accepte une analyse bien formée', () => {
    const r = analysisResultSchema.safeParse(
      base({ presentCriteria: [{ criterionId: C1, excerpts: ["l'iode non radioactif"] }] }),
    )
    expect(r.success).toBe(true)
  })

  it('refuse un critère détecté sans aucun extrait', () => {
    // « Aucune note sans preuve » commence ici : le schéma lui-même l'impose.
    const r = analysisResultSchema.safeParse(
      base({ presentCriteria: [{ criterionId: C1, excerpts: [] }] }),
    )
    expect(r.success).toBe(false)
  })

  it('refuse un identifiant de critère qui n’est pas un UUID', () => {
    const r = analysisResultSchema.safeParse(
      base({ presentCriteria: [{ criterionId: 'critère-1', excerpts: ['x'] }] }),
    )
    expect(r.success).toBe(false)
  })

  it('refuse une clarté de correspondance hors de [0, 1]', () => {
    expect(analysisResultSchema.safeParse(base({ matchClarity: 1.5 })).success).toBe(false)
  })
})

describe('validation des preuves — la barrière contre la citation inventée', () => {
  it('accepte des extraits présents dans la transcription', () => {
    const analyse = base({
      presentCriteria: [
        { criterionId: C1, excerpts: ["l'iode non radioactif"] },
        { criterionId: C2, excerpts: ['protéger la thyroïde'] },
      ],
    })
    expect(() => validateEvidence(analyse, TRANSCRIPTION)).not.toThrow()
  })

  it('refuse un extrait absent de la transcription', () => {
    // Le mode d'erreur le plus dangereux : une citation fabriquée est
    // indiscernable d'une vraie à l'œil nu.
    const analyse = base({
      presentCriteria: [
        { criterionId: C1, excerpts: ['réduire la captation d’iode radioactif libre'] },
      ],
    })
    expect(() => validateEvidence(analyse, TRANSCRIPTION)).toThrow(AnalysisValidationError)
  })

  it('tolère les différences d’espacement, de casse et d’apostrophe', () => {
    // Un modèle qui restitue « l'iode » là où l'OCR a produit « l’iode » ne ment
    // pas, il normalise.
    const analyse = base({
      presentCriteria: [{ criterionId: C1, excerpts: ["L'IODE   NON RADIOACTIF"] }],
    })
    expect(() => validateEvidence(analyse, TRANSCRIPTION)).not.toThrow()
  })

  it('vérifie aussi les extraits des contradictions et des erreurs factuelles', () => {
    // Une pénalité sans preuve est aussi contestable qu'un point non justifié.
    const contradiction = base({
      contradictions: [{ criterionId: C1, excerpt: 'phrase inexistante', explanation: 'x' }],
    })
    expect(() => validateEvidence(contradiction, TRANSCRIPTION)).toThrow(AnalysisValidationError)

    const erreur = base({
      factualErrors: [{ criterionId: C1, excerpt: 'autre invention', explanation: 'x' }],
    })
    expect(() => validateEvidence(erreur, TRANSCRIPTION)).toThrow(AnalysisValidationError)
  })

  it('vérifie les éléments inattendus', () => {
    const analyse = base({
      unexpectedElements: [
        { excerpt: 'jamais écrit par l’étudiant', explanation: 'x', nearestCriterionId: null },
      ],
    })
    expect(() => validateEvidence(analyse, TRANSCRIPTION)).toThrow(AnalysisValidationError)
  })

  it('signale tous les extraits fautifs d’un coup', () => {
    const analyse = base({
      presentCriteria: [{ criterionId: C1, excerpts: ['invention un', 'invention deux'] }],
    })
    try {
      validateEvidence(analyse, TRANSCRIPTION)
      expect.unreachable()
    } catch (error) {
      expect((error as AnalysisValidationError).problems).toHaveLength(2)
    }
  })
})

describe('périmètre du barème', () => {
  const connus = [C1, C2, C3]

  it('accepte une analyse couvrant tous les critères', () => {
    const analyse = base({
      presentCriteria: [{ criterionId: C1, excerpts: ['x'] }],
      partialCriteria: [{ criterionId: C2, excerpts: ['y'] }],
      missingCriteria: [C3],
    })
    expect(() => validateCriteriaScope(analyse, connus)).not.toThrow()
  })

  it('refuse un critère inventé par le modèle', () => {
    // Corriger hors du barème validé contredirait « aucune correction sans
    // barème validé ».
    const analyse = base({
      presentCriteria: [{ criterionId: '99999999-9999-4999-8999-999999999999', excerpts: ['x'] }],
      missingCriteria: connus,
    })
    expect(() => validateCriteriaScope(analyse, connus)).toThrow(/n'appartient pas au barème/)
  })

  it('refuse un critère classé dans deux catégories', () => {
    const analyse = base({
      presentCriteria: [{ criterionId: C1, excerpts: ['x'] }],
      partialCriteria: [{ criterionId: C1, excerpts: ['y'] }],
      missingCriteria: [C2, C3],
    })
    expect(() => validateCriteriaScope(analyse, connus)).toThrow(/plusieurs catégories/)
  })

  it('refuse une analyse incomplète', () => {
    // Un critère oublié serait silencieusement noté zéro : il faut que le modèle
    // se prononce sur chacun.
    const analyse = base({ presentCriteria: [{ criterionId: C1, excerpts: ['x'] }] })
    expect(() => validateCriteriaScope(analyse, connus)).toThrow(/incomplète/)
  })

  it('autorise une contradiction sur un critère déjà classé présent', () => {
    const analyse = base({
      presentCriteria: [{ criterionId: C1, excerpts: ['x'] }],
      missingCriteria: [C2, C3],
      contradictions: [{ criterionId: C1, excerpt: 'y', explanation: 'z' }],
    })
    expect(() => validateCriteriaScope(analyse, connus)).not.toThrow()
  })
})

describe('analyse non concluante', () => {
  it('classe tout en absent et exige une validation humaine', () => {
    // Quand la lecture est trop incertaine, on n'invente rien.
    const analyse = inconclusiveAnalysis([C1, C2])
    expect(analyse.missingCriteria).toEqual([C1, C2])
    expect(analyse.needsHumanReview).toBe(true)
    expect(analyse.matchClarity).toBe(0)
    expect(analysisResultSchema.safeParse(analyse).success).toBe(true)
  })
})
