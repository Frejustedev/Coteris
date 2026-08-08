import { describe, expect, it } from 'vitest'
import { fromMillipoints } from '@coteris/shared'

import {
  RubricDraftError,
  repartirPoints,
  validateDraftCitations,
  type BarèmeProposé,
  type CritèreProposé,
} from './rubric-draft'

const CORRIGÉ =
  "Administrer de l'iode stable pour saturer la thyroïde. " +
  "Respecter un délai de deux heures avant l'injection. " +
  'Vérifier la fonction rénale du patient.'

function critère(surcharge: Partial<CritèreProposé> = {}): CritèreProposé {
  return {
    label: 'Iode stable',
    citation: "Administrer de l'iode stable",
    acceptableAnswers: ['iode stable'],
    poids: 1,
    ...surcharge,
  }
}

describe('validateDraftCitations', () => {
  it('accepte un critère tiré du corrigé', () => {
    const barème: BarèmeProposé = { critères: [critère()], passagesNonCouverts: [] }
    expect(() => {
      validateDraftCitations(barème, CORRIGÉ)
    }).not.toThrow()
  })

  it('tolère les écarts d’espaces, de casse et d’apostrophe', () => {
    const barème: BarèmeProposé = {
      critères: [critère({ citation: "ADMINISTRER   DE L’IODE STABLE" })],
      passagesNonCouverts: [],
    }
    expect(() => {
      validateDraftCitations(barème, CORRIGÉ)
    }).not.toThrow()
  })

  it('refuse un critère plausible mais absent du corrigé', () => {
    // Le mode d'échec que cette barrière existe pour attraper : un critère
    // parfaitement crédible en médecine, mais que l'enseignant n'a pas écrit.
    // Sans contrôle, il deviendrait un critère du barème, donc une note.
    const barème: BarèmeProposé = {
      critères: [
        critère({
          label: 'Consentement éclairé',
          citation: 'Recueillir le consentement éclairé du patient',
        }),
      ],
      passagesNonCouverts: [],
    }
    expect(() => {
      validateDraftCitations(barème, CORRIGÉ)
    }).toThrow(RubricDraftError)
  })
})

describe('repartirPoints', () => {
  it('répartit exactement, sans reste perdu', () => {
    // Le contrôle de cohérence du verrouillage exige que la somme tombe juste.
    // Un millième perdu bloquerait le verrouillage sans explication lisible.
    const critères = [critère({ poids: 1 }), critère({ poids: 1 }), critère({ poids: 1 })]
    const répartis = repartirPoints(critères, fromMillipoints(1000))
    expect(répartis.reduce((s, c) => s + c.maxPoints, 0)).toBe(1000)
  })

  it('respecte les poids relatifs', () => {
    const critères = [critère({ poids: 3 }), critère({ poids: 1 })]
    const répartis = repartirPoints(critères, fromMillipoints(4000))
    expect(répartis[0]?.maxPoints).toBe(3000)
    expect(répartis[1]?.maxPoints).toBe(1000)
  })

  it('étale le reste plutôt que de le donner au dernier', () => {
    // 1000 en trois parts égales : 333 + 333 + 333 laisse un millième. Le donner
    // entièrement au dernier critère le gonflerait sans raison pédagogique.
    const critères = [critère({ poids: 1 }), critère({ poids: 1 }), critère({ poids: 1 })]
    const répartis = repartirPoints(critères, fromMillipoints(1000))
    const valeurs = répartis.map((c) => c.maxPoints).sort((a, b) => a - b)
    expect(valeurs[2]! - valeurs[0]!).toBeLessThanOrEqual(1)
  })

  it('rend une liste vide sans lever', () => {
    expect(repartirPoints([], fromMillipoints(1000))).toEqual([])
  })
})
