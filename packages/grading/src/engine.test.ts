import { describe, expect, it } from 'vitest'
import {
  ZERO,
  asId,
  millipoints,
  STEP,
  type Millipoints,
  type QuestionId,
  type RubricCriterionId,
} from '@coteris/shared'

import { gradeQuestion, hasUnjustifiedCriteria, totalForSubmission } from './engine'
import { GradingError, type CriterionAssessment, type QuestionGradingRules, type RubricCriterion } from './types'

// --- Aides de test -----------------------------------------------------------

const QUESTION = asId<'Question'>('11111111-1111-4111-8111-111111111111') as QuestionId

const critId = (n: number): RubricCriterionId =>
  asId<'RubricCriterion'>(`2222222${n}-2222-4222-8222-222222222222`) as RubricCriterionId

function critère(overrides: Partial<RubricCriterion> & { id: RubricCriterionId }): RubricCriterion {
  return {
    questionId: QUESTION,
    label: 'Critère',
    attribution: 'all_or_nothing',
    pointsMax: millipoints(1),
    order: 1,
    required: false,
    partialRatioPercent: 50,
    expectedElementCount: 0,
    pointsPerElement: null,
    cap: null,
    contradictionPolicy: { kind: 'ignore' },
    factualErrorPenalty: null,
    excludedBy: [],
    ...overrides,
  }
}

function état(
  overrides: Partial<CriterionAssessment> & { criterionId: RubricCriterionId },
): CriterionAssessment {
  return {
    status: 'absent',
    contradicted: false,
    factuallyWrong: false,
    matchedElementCount: 0,
    manualPoints: null,
    evidence: [],
    ...overrides,
  }
}

function règles(overrides: Partial<QuestionGradingRules> = {}): QuestionGradingRules {
  return {
    questionId: QUESTION,
    pointsMax: millipoints(1),
    allowNegative: false,
    roundingStep: null,
    missingRequiredPolicy: { kind: 'none' },
    allowBonusOverflow: false,
    ...overrides,
  }
}

const présent = (id: RubricCriterionId, evidence: string[]): CriterionAssessment =>
  état({ criterionId: id, status: 'present', evidence })

// --- Le scénario du cahier des charges ---------------------------------------

describe('scénario iode stable / MIBG', () => {
  // Question : « Pourquoi administre-t-on de l'iode stable avant certaines
  // explorations à la MIBG ? »
  const iodeStable = critère({
    id: critId(1),
    label: 'Mention de l’iode stable',
    attribution: 'all_or_nothing',
    pointsMax: millipoints(0.25),
    order: 1,
  })
  const thyroïde = critère({
    id: critId(2),
    label: 'Protection ou blocage de la thyroïde',
    attribution: 'all_or_nothing',
    pointsMax: millipoints(0.25),
    order: 2,
  })
  const captation = critère({
    id: critId(3),
    label: 'Réduction de la captation d’iode radioactif libre',
    attribution: 'all_or_nothing',
    pointsMax: millipoints(0.5),
    order: 3,
  })

  const barème = [iodeStable, thyroïde, captation]
  const règlesQuestion = règles({ pointsMax: millipoints(1) })

  it('note la réponse étudiante du cahier des charges', () => {
    // « Il faut donner de l'iode non radioactif pour protéger la thyroïde
    //   avant l'injection. »
    const analyse: CriterionAssessment[] = [
      présent(iodeStable.id, ['donner de l’iode non radioactif']),
      présent(thyroïde.id, ['pour protéger la thyroïde']),
      état({ criterionId: captation.id, status: 'absent' }),
    ]

    const résultat = gradeQuestion(règlesQuestion, barème, analyse)

    expect(résultat.total).toBe(millipoints(0.5))
    expect(résultat.pointsMax).toBe(millipoints(1))

    const [c1, c2, c3] = résultat.criteria
    expect(c1?.pointsComputed).toBe(millipoints(0.25))
    expect(c2?.pointsComputed).toBe(millipoints(0.25))
    expect(c3?.pointsComputed).toBe(ZERO)
  })

  it('attribue le point entier à une réponse complète', () => {
    const analyse = [
      présent(iodeStable.id, ['iode stable']),
      présent(thyroïde.id, ['bloquer la thyroïde']),
      présent(captation.id, ['réduire la captation d’iode 131 libre']),
    ]
    expect(gradeQuestion(règlesQuestion, barème, analyse).total).toBe(millipoints(1))
  })

  it('donne zéro à une copie blanche', () => {
    const résultat = gradeQuestion(règlesQuestion, barème, [])
    expect(résultat.total).toBe(ZERO)
    expect(résultat.criteria).toHaveLength(3)
  })

  it('conserve la trace de chaque décision', () => {
    const analyse = [présent(iodeStable.id, ['iode non radioactif'])]
    const résultat = gradeQuestion(règlesQuestion, barème, analyse)
    const premier = résultat.criteria[0]
    expect(premier?.appliedRules.some((r) => r.rule === 'all_or_nothing.full')).toBe(true)
  })
})

// --- Déterminisme ------------------------------------------------------------

describe('déterminisme', () => {
  const barème = [
    critère({ id: critId(1), pointsMax: millipoints(0.25), order: 1 }),
    critère({ id: critId(2), pointsMax: millipoints(0.5), order: 2 }),
    critère({ id: critId(3), pointsMax: millipoints(0.25), order: 3 }),
  ]

  it('ignore l’ordre du tableau de critères reçu', () => {
    const analyse = barème.map((c) => présent(c.id, ['extrait']))
    const direct = gradeQuestion(règles(), barème, analyse)
    const inversé = gradeQuestion(règles(), [...barème].reverse(), analyse)
    expect(inversé.total).toBe(direct.total)
    expect(inversé.criteria.map((c) => c.criterionId)).toEqual(
      direct.criteria.map((c) => c.criterionId),
    )
  })

  it('ignore l’ordre des évaluations reçues', () => {
    const analyse = barème.map((c) => présent(c.id, ['extrait']))
    const direct = gradeQuestion(règles(), barème, analyse)
    const inversé = gradeQuestion(règles(), barème, [...analyse].reverse())
    expect(inversé.total).toBe(direct.total)
  })

  it('donne le même résultat sur mille exécutions', () => {
    const analyse = barème.map((c) => présent(c.id, ['extrait']))
    const attendu = gradeQuestion(règles(), barème, analyse).total
    for (let i = 0; i < 1000; i++) {
      expect(gradeQuestion(règles(), barème, analyse).total).toBe(attendu)
    }
  })
})

// --- Aucune note sans preuve -------------------------------------------------

describe('aucune note sans preuve', () => {
  const c = critère({ id: critId(1), pointsMax: millipoints(1) })

  it('refuse les points d’un critère présent sans extrait justificatif', () => {
    const résultat = gradeQuestion(règles(), [c], [état({ criterionId: c.id, status: 'present' })])
    expect(résultat.total).toBe(ZERO)
    expect(résultat.criteria[0]?.deniedForMissingEvidence).toBe(true)
    expect(hasUnjustifiedCriteria(résultat)).toBe(true)
  })

  it('refuse aussi une pénalité non justifiée', () => {
    // Une pénalité sans preuve est aussi contestable qu'un point non justifié.
    const pénalité = critère({
      id: critId(2),
      attribution: 'penalty',
      pointsMax: millipoints(0.5),
      order: 2,
    })
    const résultat = gradeQuestion(
      règles(),
      [pénalité],
      [état({ criterionId: pénalité.id, status: 'present' })],
    )
    expect(résultat.criteria[0]?.pointsComputed).toBe(ZERO)
    expect(résultat.criteria[0]?.deniedForMissingEvidence).toBe(true)
  })

  it('n’exige aucun extrait pour un critère absent', () => {
    const résultat = gradeQuestion(règles(), [c], [état({ criterionId: c.id, status: 'absent' })])
    expect(résultat.criteria[0]?.deniedForMissingEvidence).toBe(false)
  })

  it('dispense la notation manuelle, où l’humain décide', () => {
    const manuel = critère({ id: critId(3), attribution: 'manual', pointsMax: millipoints(1) })
    const résultat = gradeQuestion(
      règles(),
      [manuel],
      [état({ criterionId: manuel.id, status: 'present', manualPoints: millipoints(0.75) })],
    )
    expect(résultat.total).toBe(millipoints(0.75))
    expect(résultat.criteria[0]?.deniedForMissingEvidence).toBe(false)
  })
})

// --- Types d'attribution -----------------------------------------------------

describe('attribution — tout ou rien', () => {
  const c = critère({ id: critId(1), attribution: 'all_or_nothing', pointsMax: millipoints(1) })

  it('ne donne rien pour une réponse partielle', () => {
    const résultat = gradeQuestion(
      règles(),
      [c],
      [état({ criterionId: c.id, status: 'partial', evidence: ['à moitié'] })],
    )
    expect(résultat.total).toBe(ZERO)
    expect(résultat.criteria[0]?.appliedRules.some((r) => r.rule === 'all_or_nothing.partial_denied')).toBe(true)
  })
})

describe('attribution — partielle', () => {
  it('applique le taux configuré', () => {
    const c = critère({
      id: critId(1),
      attribution: 'partial',
      pointsMax: millipoints(1),
      partialRatioPercent: 50,
    })
    const résultat = gradeQuestion(
      règles(),
      [c],
      [état({ criterionId: c.id, status: 'partial', evidence: ['mécanisme incomplet'] })],
    )
    expect(résultat.total).toBe(millipoints(0.5))
  })

  it('couvre le cas « 1 point si complet, 0,5 si partiel »', () => {
    const c = critère({
      id: critId(1),
      label: 'Mécanisme',
      attribution: 'partial',
      pointsMax: millipoints(1),
      partialRatioPercent: 50,
    })
    expect(
      gradeQuestion(règles(), [c], [présent(c.id, ['mécanisme complet'])]).total,
    ).toBe(millipoints(1))
  })
})

describe('attribution — points par élément', () => {
  it('applique le cas « 0,5 point par indication, maximum 1 point »', () => {
    const c = critère({
      id: critId(1),
      label: 'Indications',
      attribution: 'per_element',
      pointsMax: millipoints(1),
      pointsPerElement: millipoints(0.5),
      expectedElementCount: 4,
      cap: millipoints(1),
    })
    const règlesQ = règles({ pointsMax: millipoints(1) })

    const deux = gradeQuestion(
      règlesQ,
      [c],
      [état({ criterionId: c.id, status: 'present', matchedElementCount: 2, evidence: ['a', 'b'] })],
    )
    expect(deux.total).toBe(millipoints(1))

    const quatre = gradeQuestion(
      règlesQ,
      [c],
      [
        état({
          criterionId: c.id,
          status: 'present',
          matchedElementCount: 4,
          evidence: ['a', 'b', 'c', 'd'],
        }),
      ],
    )
    // Plafonné à 1 point malgré 4 × 0,5 = 2 points.
    expect(quatre.total).toBe(millipoints(1))
  })

  it('répartit exactement le critère quand aucun taux n’est fixé', () => {
    const c = critère({
      id: critId(1),
      attribution: 'per_element',
      pointsMax: millipoints(1),
      pointsPerElement: null,
      expectedElementCount: 3,
    })
    const règlesQ = règles({ pointsMax: millipoints(1) })

    // Citer les trois éléments donne le point entier, pas 0,999.
    const tous = gradeQuestion(
      règlesQ,
      [c],
      [
        état({
          criterionId: c.id,
          status: 'present',
          matchedElementCount: 3,
          evidence: ['a', 'b', 'c'],
        }),
      ],
    )
    expect(tous.total).toBe(millipoints(1))

    const un = gradeQuestion(
      règlesQ,
      [c],
      [état({ criterionId: c.id, status: 'present', matchedElementCount: 1, evidence: ['a'] })],
    )
    expect(un.total).toBe(334 as Millipoints)
  })

  it('ignore les éléments excédentaires', () => {
    const c = critère({
      id: critId(1),
      attribution: 'per_element',
      pointsMax: millipoints(1),
      pointsPerElement: millipoints(0.25),
      expectedElementCount: 2,
    })
    const résultat = gradeQuestion(
      règles(),
      [c],
      [état({ criterionId: c.id, status: 'present', matchedElementCount: 9, evidence: ['a'] })],
    )
    expect(résultat.total).toBe(millipoints(0.5))
  })

  it('refuse un nombre d’éléments négatif', () => {
    const c = critère({
      id: critId(1),
      attribution: 'per_element',
      pointsMax: millipoints(1),
      expectedElementCount: 2,
    })
    expect(() =>
      gradeQuestion(
        règles(),
        [c],
        [état({ criterionId: c.id, status: 'present', matchedElementCount: -1, evidence: ['a'] })],
      ),
    ).toThrow(GradingError)
  })
})

describe('attribution — bonus et pénalité', () => {
  it('ajoute un bonus sans dépasser le barème par défaut', () => {
    const base = critère({ id: critId(1), pointsMax: millipoints(1), order: 1 })
    const bonus = critère({
      id: critId(2),
      attribution: 'bonus',
      pointsMax: millipoints(0.5),
      order: 2,
    })
    const résultat = gradeQuestion(
      règles({ pointsMax: millipoints(1) }),
      [base, bonus],
      [présent(base.id, ['ok']), présent(bonus.id, ['précision remarquable'])],
    )
    expect(résultat.rawTotal).toBe(millipoints(1.5))
    expect(résultat.total).toBe(millipoints(1))
  })

  it('laisse dépasser quand le barème l’autorise', () => {
    const base = critère({ id: critId(1), pointsMax: millipoints(1), order: 1 })
    const bonus = critère({
      id: critId(2),
      attribution: 'bonus',
      pointsMax: millipoints(0.5),
      order: 2,
    })
    const résultat = gradeQuestion(
      règles({ pointsMax: millipoints(1), allowBonusOverflow: true }),
      [base, bonus],
      [présent(base.id, ['ok']), présent(bonus.id, ['précision'])],
    )
    expect(résultat.total).toBe(millipoints(1.5))
  })

  it('retranche une pénalité sans faire descendre la question sous zéro', () => {
    const pénalité = critère({
      id: critId(1),
      attribution: 'penalty',
      pointsMax: millipoints(0.5),
    })
    const résultat = gradeQuestion(
      règles({ pointsMax: millipoints(1) }),
      [pénalité],
      [présent(pénalité.id, ['confusion entre iode 123 et iode 131'])],
    )
    expect(résultat.rawTotal).toBe(millipoints(-0.5))
    expect(résultat.total).toBe(ZERO)
  })

  it('autorise une note négative si le barème le prévoit', () => {
    const pénalité = critère({
      id: critId(1),
      attribution: 'penalty',
      pointsMax: millipoints(0.5),
    })
    const résultat = gradeQuestion(
      règles({ pointsMax: millipoints(1), allowNegative: true }),
      [pénalité],
      [présent(pénalité.id, ['erreur grave'])],
    )
    expect(résultat.total).toBe(millipoints(-0.5))
  })
})

// --- Contradictions et erreurs factuelles ------------------------------------

describe('contradictions', () => {
  it('plafonne le critère à 50 %, comme le prévoit le cahier des charges', () => {
    const c = critère({
      id: critId(1),
      pointsMax: millipoints(1),
      contradictionPolicy: { kind: 'cap_percent', percent: 50 },
    })
    const résultat = gradeQuestion(
      règles(),
      [c],
      [
        état({
          criterionId: c.id,
          status: 'present',
          contradicted: true,
          evidence: ['bloque la thyroïde', 'mais la thyroïde n’est pas concernée'],
        }),
      ],
    )
    expect(résultat.total).toBe(millipoints(0.5))
    expect(
      résultat.criteria[0]?.appliedRules.some((r) => r.rule === 'contradiction.cap_percent'),
    ).toBe(true)
  })

  it('annule le critère quand le barème l’exige', () => {
    const c = critère({
      id: critId(1),
      pointsMax: millipoints(1),
      contradictionPolicy: { kind: 'zero' },
    })
    const résultat = gradeQuestion(
      règles(),
      [c],
      [état({ criterionId: c.id, status: 'present', contradicted: true, evidence: ['x', 'y'] })],
    )
    expect(résultat.total).toBe(ZERO)
  })

  it('ignore la contradiction si le barème le prévoit', () => {
    const c = critère({
      id: critId(1),
      pointsMax: millipoints(1),
      contradictionPolicy: { kind: 'ignore' },
    })
    const résultat = gradeQuestion(
      règles(),
      [c],
      [état({ criterionId: c.id, status: 'present', contradicted: true, evidence: ['x'] })],
    )
    expect(résultat.total).toBe(millipoints(1))
  })

  it('retranche une pénalité pour erreur factuelle', () => {
    const c = critère({
      id: critId(1),
      pointsMax: millipoints(1),
      factualErrorPenalty: millipoints(0.25),
    })
    const résultat = gradeQuestion(
      règles(),
      [c],
      [état({ criterionId: c.id, status: 'present', factuallyWrong: true, evidence: ['x'] })],
    )
    expect(résultat.total).toBe(millipoints(0.75))
  })
})

// --- Exclusions --------------------------------------------------------------

describe('exclusions entre critères', () => {
  const complet = critère({
    id: critId(1),
    label: 'Mécanisme complet',
    pointsMax: millipoints(1),
    order: 1,
  })
  const partiel = critère({
    id: critId(2),
    label: 'Mécanisme partiel',
    pointsMax: millipoints(0.5),
    order: 2,
    excludedBy: [critId(1)],
  })

  it('n’ajoute pas le critère partiel quand le complet est attribué', () => {
    const résultat = gradeQuestion(
      règles({ pointsMax: millipoints(1) }),
      [complet, partiel],
      [présent(complet.id, ['mécanisme entier']), présent(partiel.id, ['mécanisme'])],
    )
    expect(résultat.total).toBe(millipoints(1))
    expect(résultat.criteria[1]?.excluded).toBe(true)
  })

  it('attribue le critère partiel quand le complet ne l’est pas', () => {
    const résultat = gradeQuestion(
      règles({ pointsMax: millipoints(1) }),
      [complet, partiel],
      [état({ criterionId: complet.id, status: 'absent' }), présent(partiel.id, ['amorce'])],
    )
    expect(résultat.total).toBe(millipoints(0.5))
    expect(résultat.criteria[1]?.excluded).toBe(false)
  })

  it('refuse une exclusion qui ne respecte pas l’ordre, pour rester acyclique', () => {
    const a = critère({ id: critId(1), order: 2, excludedBy: [critId(2)] })
    const b = critère({ id: critId(2), order: 1, excludedBy: [critId(1)] })
    expect(() => gradeQuestion(règles(), [a, b], [])).toThrow(GradingError)
  })
})

// --- Critères obligatoires ---------------------------------------------------

describe('critères obligatoires', () => {
  const obligatoire = critère({
    id: critId(1),
    label: 'Diagnostic',
    pointsMax: millipoints(0.5),
    order: 1,
    required: true,
  })
  const secondaire = critère({
    id: critId(2),
    label: 'Justification',
    pointsMax: millipoints(0.5),
    order: 2,
  })

  it('annule la question quand le barème l’exige', () => {
    const résultat = gradeQuestion(
      règles({ pointsMax: millipoints(1), missingRequiredPolicy: { kind: 'zero_question' } }),
      [obligatoire, secondaire],
      [présent(secondaire.id, ['justification correcte'])],
    )
    expect(résultat.rawTotal).toBe(millipoints(0.5))
    expect(résultat.total).toBe(ZERO)
    expect(résultat.appliedRules.some((r) => r.rule === 'required.zero_question')).toBe(true)
  })

  it('plafonne la question à un pourcentage', () => {
    const résultat = gradeQuestion(
      règles({
        pointsMax: millipoints(1),
        missingRequiredPolicy: { kind: 'cap_percent', percent: 50 },
      }),
      [obligatoire, secondaire],
      [présent(secondaire.id, ['justification'])],
    )
    expect(résultat.total).toBe(millipoints(0.5))
  })

  it('n’a aucune conséquence supplémentaire par défaut', () => {
    const résultat = gradeQuestion(
      règles({ pointsMax: millipoints(1) }),
      [obligatoire, secondaire],
      [présent(secondaire.id, ['justification'])],
    )
    expect(résultat.total).toBe(millipoints(0.5))
  })
})

// --- Arrondi -----------------------------------------------------------------

describe('arrondi de la note', () => {
  it('arrondit au quart de point sans perdre la valeur exacte', () => {
    const c = critère({
      id: critId(1),
      attribution: 'per_element',
      pointsMax: millipoints(1),
      pointsPerElement: null,
      expectedElementCount: 3,
    })
    const résultat = gradeQuestion(
      règles({ pointsMax: millipoints(1), roundingStep: STEP.QUARTER }),
      [c],
      [état({ criterionId: c.id, status: 'present', matchedElementCount: 1, evidence: ['a'] })],
    )
    expect(résultat.cappedTotal).toBe(334 as Millipoints) // valeur exacte conservée
    expect(résultat.total).toBe(millipoints(0.25)) // valeur arrondie proposée
  })

  it('n’arrondit jamais au-delà du barème', () => {
    const c = critère({ id: critId(1), pointsMax: millipoints(1) })
    const résultat = gradeQuestion(
      règles({ pointsMax: millipoints(1), roundingStep: STEP.WHOLE }),
      [c],
      [présent(c.id, ['ok'])],
    )
    expect(résultat.total).toBe(millipoints(1))
  })
})

// --- Validation des entrées --------------------------------------------------

describe('validation des entrées', () => {
  it('refuse une analyse portant sur un critère absent du barème verrouillé', () => {
    const c = critère({ id: critId(1) })
    expect(() =>
      gradeQuestion(règles(), [c], [présent(critId(9), ['hors barème'])]),
    ).toThrow(/hors du barème validé/)
  })

  it('refuse deux évaluations du même critère', () => {
    const c = critère({ id: critId(1) })
    expect(() =>
      gradeQuestion(règles(), [c], [présent(c.id, ['a']), présent(c.id, ['b'])]),
    ).toThrow(GradingError)
  })

  it('refuse un critère appartenant à une autre question', () => {
    const autre = asId<'Question'>('99999999-9999-4999-8999-999999999999') as QuestionId
    const c = critère({ id: critId(1), questionId: autre })
    expect(() => gradeQuestion(règles(), [c], [])).toThrow(GradingError)
  })

  it('refuse une notation manuelle sans valeur fournie', () => {
    const c = critère({ id: critId(1), attribution: 'manual' })
    expect(() =>
      gradeQuestion(règles(), [c], [état({ criterionId: c.id, status: 'present', evidence: ['x'] })]),
    ).toThrow(/ne devine pas une note/)
  })
})

// --- Propriétés --------------------------------------------------------------

describe('propriétés invariantes', () => {
  const barème = [
    critère({ id: critId(1), pointsMax: millipoints(0.25), order: 1 }),
    critère({
      id: critId(2),
      attribution: 'partial',
      pointsMax: millipoints(0.5),
      order: 2,
      partialRatioPercent: 40,
    }),
    critère({
      id: critId(3),
      attribution: 'per_element',
      pointsMax: millipoints(0.25),
      expectedElementCount: 3,
      order: 3,
    }),
  ]
  const statuts = ['present', 'partial', 'absent'] as const

  it('la note reste toujours dans [0, barème]', () => {
    const max = millipoints(1)
    for (const s1 of statuts) {
      for (const s2 of statuts) {
        for (const s3 of statuts) {
          for (const contradicted of [false, true]) {
            const analyse = [
              état({ criterionId: critId(1), status: s1, contradicted, evidence: ['x'] }),
              état({ criterionId: critId(2), status: s2, evidence: ['y'] }),
              état({
                criterionId: critId(3),
                status: s3,
                matchedElementCount: 2,
                evidence: ['z'],
              }),
            ]
            const total = gradeQuestion(règles({ pointsMax: max }), barème, analyse).total
            expect(total).toBeGreaterThanOrEqual(0)
            expect(total).toBeLessThanOrEqual(max)
          }
        }
      }
    }
  })
})

// --- Total d'une copie -------------------------------------------------------

describe('total d’une copie', () => {
  it('additionne les questions sans erreur d’arrondi', () => {
    const c = critère({ id: critId(1), pointsMax: millipoints(0.1) })
    const questions = Array.from({ length: 30 }, () =>
      gradeQuestion(règles({ pointsMax: millipoints(0.1) }), [c], [présent(c.id, ['ok'])]),
    )
    expect(totalForSubmission(questions)).toBe(millipoints(3))
  })
})
