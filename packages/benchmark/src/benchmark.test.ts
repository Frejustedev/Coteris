import { describe, expect, it } from 'vitest'

import {
  DatasetError,
  EFFECTIF_MINIMAL_SIGNIFICATIF,
  accordParCritère,
  assertAnonymisé,
  coûts,
  détectionCritères,
  erreurNote,
  estSignificatif,
  fiabilitéVerts,
  parseDataset,
  répartitionConfiance,
  évaluer,
  type ObservationCritère,
  type ObservationRéponse,
} from './index'

// --- Aides ------------------------------------------------------------------------

const critère = (
  proposé: ObservationCritère['proposé'],
  référence: ObservationCritère['référence'],
  over: Partial<ObservationCritère> = {},
): ObservationCritère => ({
  criterionId: 'c1',
  proposé,
  référence,
  pointsProposés: proposé === 'absent' ? 0 : 1000,
  pointsRéférence: référence === 'absent' ? 0 : 1000,
  niveauConfiance: 'green',
  ...over,
})

const réponse = (over: Partial<ObservationRéponse> = {}): ObservationRéponse => ({
  submissionId: 's1',
  questionId: 'q1',
  critères: [],
  totalProposé: 1000,
  totalRéférence: 1000,
  pointsMax: 1000,
  niveauConfiance: 'green',
  aDemandéValidation: false,
  duréeMs: 100,
  coûtMicroEur: 1000,
  pages: 1,
  ...over,
})

// --- Accord ------------------------------------------------------------------------

describe('accord IA-humain par critère', () => {
  it('compte les états identiques', () => {
    const a = accordParCritère([
      critère('present', 'present'),
      critère('absent', 'absent'),
      critère('present', 'absent'),
    ])
    expect(a.total).toBe(3)
    expect(a.enAccord).toBe(2)
    expect(a.taux).toBeCloseTo(2 / 3)
  })

  it('distingue « partiel » de « présent »', () => {
    // Accorder la moitié des points là où l'humain les accorde tous n'est pas un
    // accord : c'est une erreur de degré, qui compte comme telle.
    expect(accordParCritère([critère('partial', 'present')]).taux).toBe(0)
  })

  it('rend zéro sur un ensemble vide plutôt que NaN', () => {
    expect(accordParCritère([]).taux).toBe(0)
  })
})

// --- Détection ---------------------------------------------------------------------

describe('détection des critères', () => {
  it('calcule précision et rappel', () => {
    const d = détectionCritères([
      critère('present', 'present'), // vrai positif
      critère('partial', 'present'), // vrai positif : des points sont accordés
      critère('present', 'absent'), // faux positif
      critère('absent', 'present'), // faux négatif
      critère('absent', 'absent'), // vrai négatif
    ])

    expect(d.vraisPositifs).toBe(2)
    expect(d.fauxPositifs).toBe(1)
    expect(d.fauxNégatifs).toBe(1)
    expect(d.précision).toBeCloseTo(2 / 3)
    expect(d.rappel).toBeCloseTo(2 / 3)
    expect(d.f1).toBeCloseTo(2 / 3)
  })

  it('sépare les deux types d’erreur, qui n’ont pas la même gravité', () => {
    // Un faux positif accorde des points indus — l'erreur la plus grave sur un
    // examen. Un faux négatif est rattrapé à la relecture.
    const tropGénéreux = détectionCritères([
      critère('present', 'absent'),
      critère('present', 'absent'),
      critère('present', 'present'),
    ])
    expect(tropGénéreux.fauxPositifs).toBe(2)
    expect(tropGénéreux.fauxNégatifs).toBe(0)
    expect(tropGénéreux.précision).toBeLessThan(tropGénéreux.rappel)
  })

  it('rend zéro plutôt que NaN quand rien n’est détecté', () => {
    const d = détectionCritères([critère('absent', 'absent')])
    expect(d.précision).toBe(0)
    expect(d.rappel).toBe(0)
    expect(d.f1).toBe(0)
  })
})

// --- Erreur de note ------------------------------------------------------------------

describe('erreur sur la note', () => {
  it('calcule l’écart absolu moyen et le maximum', () => {
    const e = erreurNote([
      réponse({ totalProposé: 1000, totalRéférence: 1000 }),
      réponse({ totalProposé: 1000, totalRéférence: 500 }),
      réponse({ totalProposé: 250, totalRéférence: 1000 }),
    ])
    expect(e.erreurAbsolueMoyenne).toBeCloseTo((0 + 500 + 750) / 3)
    expect(e.erreurMax).toBe(750)
    expect(e.tauxExact).toBeCloseTo(1 / 3)
  })

  it('mesure le biais, qui est signé', () => {
    // Un système systématiquement trop généreux est un problème différent d'un
    // système imprécis dans les deux sens : le signe le révèle.
    const généreux = erreurNote([
      réponse({ totalProposé: 1000, totalRéférence: 500 }),
      réponse({ totalProposé: 1000, totalRéférence: 750 }),
    ])
    expect(généreux.biais).toBeGreaterThan(0)

    const symétrique = erreurNote([
      réponse({ totalProposé: 1000, totalRéférence: 500 }),
      réponse({ totalProposé: 0, totalRéférence: 500 }),
    ])
    expect(symétrique.biais).toBe(0)
    // Le biais nul ne signifie pas que le système est juste : l'écart absolu
    // reste élevé. Les deux chiffres doivent être lus ensemble.
    expect(symétrique.erreurAbsolueMoyenne).toBe(500)
  })

  it('rend zéro sur un ensemble vide', () => {
    expect(erreurNote([]).erreurAbsolueMoyenne).toBe(0)
  })
})

// --- Fiabilité des verts -----------------------------------------------------------

describe('fiabilité des décisions vertes', () => {
  it('mesure la part de cas verts validés sans modification', () => {
    const f = fiabilitéVerts([
      réponse({ niveauConfiance: 'green', totalProposé: 1000, totalRéférence: 1000 }),
      réponse({ niveauConfiance: 'green', totalProposé: 1000, totalRéférence: 1000 }),
      réponse({ niveauConfiance: 'green', totalProposé: 1000, totalRéférence: 500 }),
      réponse({ niveauConfiance: 'red', totalProposé: 0, totalRéférence: 1000 }),
    ])
    expect(f.effectif).toBe(3)
    expect(f.modifiés).toBe(1)
    expect(f.tauxSansModification).toBeCloseTo(2 / 3)
  })

  it('ignore les cas orange et rouges', () => {
    const f = fiabilitéVerts([
      réponse({ niveauConfiance: 'orange', totalProposé: 0, totalRéférence: 1000 }),
      réponse({ niveauConfiance: 'red', totalProposé: 0, totalRéférence: 1000 }),
    ])
    expect(f.effectif).toBe(0)
  })
})

// --- Confiance et coûts --------------------------------------------------------------

describe('répartition de la confiance', () => {
  it('compte chaque niveau et le recours à l’humain', () => {
    const r = répartitionConfiance([
      réponse({ niveauConfiance: 'green', aDemandéValidation: false }),
      réponse({ niveauConfiance: 'orange', aDemandéValidation: true }),
      réponse({ niveauConfiance: 'red', aDemandéValidation: true }),
      réponse({ niveauConfiance: 'red', aDemandéValidation: true }),
    ])
    expect(r).toMatchObject({ vert: 1, orange: 1, rouge: 2 })
    expect(r.tauxValidationRequise).toBe(0.75)
  })
})

describe('coûts et durées', () => {
  it('ventile le coût par réponse, par page et par copie', () => {
    const c = coûts([
      réponse({ submissionId: 's1', coûtMicroEur: 1000, pages: 1, duréeMs: 100 }),
      réponse({ submissionId: 's1', coûtMicroEur: 3000, pages: 1, duréeMs: 300 }),
      réponse({ submissionId: 's2', coûtMicroEur: 2000, pages: 2, duréeMs: 200 }),
    ])
    expect(c.total).toBe(6000)
    expect(c.parRéponse).toBe(2000)
    expect(c.parPage).toBe(1500)
    // Deux copies distinctes, pas trois réponses.
    expect(c.parCopie).toBe(3000)
    expect(c.duréeMoyenneMs).toBe(200)
  })

  it('rend zéro sur un ensemble vide', () => {
    expect(coûts([]).parCopie).toBe(0)
  })
})

// --- Rapport et significativité --------------------------------------------------------

describe('rapport et significativité', () => {
  it('assemble toutes les métriques', () => {
    const r = évaluer('pipeline-A', [
      réponse({ critères: [critère('present', 'present')] }),
    ])
    expect(r.pipeline).toBe('pipeline-A')
    expect(r.effectifRéponses).toBe(1)
    expect(r.effectifCritères).toBe(1)
  })

  it('refuse de considérer un effectif trop faible comme significatif', () => {
    // Annoncer « 94 % d'accord » sur douze réponses serait trompeur.
    const petit = évaluer('A', [réponse({ critères: [critère('present', 'present')] })])
    expect(estSignificatif(petit)).toBe(false)

    const grand = évaluer(
      'A',
      Array.from({ length: EFFECTIF_MINIMAL_SIGNIFICATIF }, () =>
        réponse({ critères: [critère('present', 'present')] }),
      ),
    )
    expect(estSignificatif(grand)).toBe(true)
  })
})

// --- Jeu d'évaluation ------------------------------------------------------------------

describe('importateur du jeu d’évaluation', () => {
  const jeuValide = {
    version: 1,
    description: 'Jeu synthétique',
    réponses: [
      {
        id: 'r1',
        submissionId: 'c1',
        questionId: 'q1',
        question: 'Pourquoi administre-t-on de l’iode stable ?',
        corrigé: 'Pour bloquer la thyroïde.',
        transcriptionRéférence: 'Pour protéger la thyroïde.',
        critères: [{ id: 'k1', label: 'Thyroïde', maxPoints: 1000, acceptableAnswers: [] }],
        décisionsRéférence: [{ criterionId: 'k1', référence: 'present', pointsRéférence: 1000 }],
        totalRéférence: 1000,
        pointsMax: 1000,
      },
    ],
  }

  it('accepte un jeu bien formé', () => {
    expect(() => parseDataset(jeuValide)).not.toThrow()
  })

  it('refuse un champ d’identité', () => {
    const avecNom = structuredClone(jeuValide) as Record<string, unknown>
    ;(avecNom['réponses'] as Record<string, unknown>[])[0]!['nom'] = 'Quelqu’un'
    expect(() => parseDataset(avecNom)).toThrow(DatasetError)
  })

  it('refuse une adresse électronique glissée dans un texte libre', () => {
    const avecMail = structuredClone(jeuValide)
    avecMail.réponses[0]!.transcriptionRéférence = 'Voir contact@exemple.invalide'
    expect(() => parseDataset(avecMail)).toThrow(/adresse électronique/)
  })

  it('refuse une suite de chiffres ressemblant à un numéro', () => {
    const avecNum = structuredClone(jeuValide)
    avecNum.réponses[0]!.corrigé = 'Appeler le 06 12 34 56 78'
    expect(() => parseDataset(avecNum)).toThrow(/numéro/)
  })

  it('refuse une décision portant sur un critère absent du barème', () => {
    const incohérent = structuredClone(jeuValide)
    incohérent.réponses[0]!.décisionsRéférence[0]!.criterionId = 'inconnu'
    expect(() => parseDataset(incohérent)).toThrow(/absent du barème/)
  })

  it('refuse une référence incomplète', () => {
    // Un critère sans décision de référence fausserait le rappel.
    const incomplet = structuredClone(jeuValide)
    incomplet.réponses[0]!.critères.push({
      id: 'k2',
      label: 'Captation',
      maxPoints: 1000,
      acceptableAnswers: [],
    })
    expect(() => parseDataset(incomplet)).toThrow(/sans décision de référence/)
  })

  it('refuse un total de référence incohérent', () => {
    const faux = structuredClone(jeuValide)
    faux.réponses[0]!.totalRéférence = 500
    expect(() => parseDataset(faux)).toThrow(/ne correspond pas/)
  })

  it('refuse un total supérieur au barème', () => {
    const dépassement = structuredClone(jeuValide)
    dépassement.réponses[0]!.décisionsRéférence[0]!.pointsRéférence = 2000
    dépassement.réponses[0]!.totalRéférence = 2000
    expect(() => parseDataset(dépassement)).toThrow(/dépasse le barème/)
  })

  it('signale tous les problèmes d’anonymat d’un coup', () => {
    const sale = structuredClone(jeuValide) as Record<string, unknown>
    const r = (sale['réponses'] as Record<string, unknown>[])[0]!
    r['email'] = 'x@y.invalide'
    r['prenom'] = 'Quelqu’un'
    try {
      assertAnonymisé(sale)
      expect.unreachable()
    } catch (error) {
      expect((error as DatasetError).problèmes.length).toBeGreaterThanOrEqual(2)
    }
  })
})
