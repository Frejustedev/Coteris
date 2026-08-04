import { describe, expect, it } from 'vitest'

import { construireCorrigéAnnoté, type CorrigéAnnoté } from './corrige-annote'
import { assainirPourWinAnsi } from './winansi'
import { contentTypeForFileName, exportFileName } from './results'

function corrigé(surcharge: Partial<CorrigéAnnoté> = {}): CorrigéAnnoté {
  return {
    titreÉpreuve: 'Gestion d’un service de santé — EC1',
    codeCopie: 'C-0042',
    datePublication: new Date('2026-08-04T10:00:00Z'),
    total: 13_500,
    totalMax: 20_000,
    questions: [
      {
        numéro: '1',
        énoncé: 'Quelle précaution prendre avant une injection de produit iodé ?',
        pointsObtenus: 1_500,
        pointsMax: 2_000,
        critères: [
          {
            intitulé: 'Iode non radioactif',
            pointsObtenus: 1_500,
            pointsPossibles: 1_500,
            extraits: ["donner de l’iode non radioactif pour protéger la thyroïde"],
            refuséFauteDePreuve: false,
            exclu: false,
          },
          {
            intitulé: 'Délai avant injection',
            pointsObtenus: 0,
            pointsPossibles: 500,
            extraits: [],
            refuséFauteDePreuve: false,
            exclu: false,
          },
        ],
      },
    ],
    ...surcharge,
  }
}

describe('assainirPourWinAnsi', () => {
  it('laisse le français intact', () => {
    const source = "L’élève a écrit « à cœur ouvert », 15 °C, œuf, Ÿ, €."
    const { texte, substitutions } = assainirPourWinAnsi(source)
    expect(texte).toBe(source)
    expect(substitutions).toBe(0)
  })

  it('recompose les accents décomposés plutôt que de les perdre', () => {
    // « e » suivi d'un accent aigu combinant : la forme décomposée n'est pas
    // encodable, la forme composée l'est. Sans NFC, un texte parfaitement
    // français échouerait selon la façon dont il a été saisi.
    const décomposé = 'étude'
    const { texte, substitutions } = assainirPourWinAnsi(décomposé)
    expect(texte).toBe('étude')
    expect(substitutions).toBe(0)
  })

  it('rend lisibles les symboles scientifiques courants', () => {
    const { texte } = assainirPourWinAnsi('si α ≥ 5 → β ≈ 2')
    expect(texte).toBe('si alpha >= 5 -> beta ~ 2')
  })

  it('compte ce qu’il remplace, sans jamais le taire', () => {
    const { texte, substitutions } = assainirPourWinAnsi('note 😀 finale 漢')
    expect(texte).toContain('?')
    expect(substitutions).toBeGreaterThanOrEqual(2)
  })
})

describe('construireCorrigéAnnoté', () => {
  it('produit un PDF valide', async () => {
    const { pdf } = await construireCorrigéAnnoté(corrigé())
    expect(pdf.length).toBeGreaterThan(500)
    // En-tête d'un fichier PDF : « %PDF- ».
    expect(Array.from(pdf.slice(0, 5)).map((o) => String.fromCharCode(o)).join('')).toBe('%PDF-')
  })

  it('ne lève pas sur des caractères hors CP1252', async () => {
    // Le mode d'échec que ce chantier devait empêcher : la bibliothèque LÈVE sur
    // tout caractère qu'elle ne sait pas encoder. Une copie de sciences suffit.
    const avecSymboles = corrigé({
      questions: [
        {
          numéro: '1',
          énoncé: 'Exprimer la condition α ≥ 5 → β.',
          pointsObtenus: 1_000,
          pointsMax: 1_000,
          critères: [
            {
              intitulé: 'Condition α ≥ 5',
              pointsObtenus: 1_000,
              pointsPossibles: 1_000,
              extraits: ['on a α ≥ 5 donc β ≈ 2 😀 漢字'],
              refuséFauteDePreuve: false,
              exclu: false,
            },
          ],
        },
      ],
    })

    const { pdf, substitutions } = await construireCorrigéAnnoté(avecSymboles)
    expect(pdf.length).toBeGreaterThan(500)
    expect(substitutions).toBeGreaterThan(0)
  })

  it('tient sur plusieurs pages sans déborder', async () => {
    const questions = Array.from({ length: 40 }, (_, i) => ({
      numéro: String(i + 1),
      énoncé: 'Énoncé de la question, suffisamment long pour occuper une ligne entière. '.repeat(2),
      pointsObtenus: 500,
      pointsMax: 500,
      critères: [
        {
          intitulé: `Critère ${i + 1}`,
          pointsObtenus: 500,
          pointsPossibles: 500,
          extraits: ['un extrait de la copie de l’étudiant, cité mot pour mot'],
          refuséFauteDePreuve: false,
          exclu: false,
        },
      ],
    }))

    const { pdf } = await construireCorrigéAnnoté(corrigé({ questions }))
    expect(pdf.length).toBeGreaterThan(2000)
  })

  it('coupe un mot plus long que la page plutôt que de déborder', async () => {
    const { pdf } = await construireCorrigéAnnoté(
      corrigé({
        questions: [
          {
            numéro: '1',
            énoncé: 'a'.repeat(400),
            pointsObtenus: 0,
            pointsMax: 1_000,
            critères: [],
          },
        ],
      }),
    )
    expect(pdf.length).toBeGreaterThan(500)
  })
})

describe('nom de fichier et type MIME', () => {
  it('porte l’extension demandée', () => {
    const date = new Date('2026-08-04T10:00:00Z')
    expect(exportFileName('Épreuve de santé', 'corrige', date, 'pdf')).toMatch(/\.pdf$/)
    expect(exportFileName('Épreuve de santé', 'resultats', date)).toMatch(/\.csv$/)
  })

  it('déduit le type MIME du nom, jamais d’un défaut', () => {
    // La route servait tout en text/csv avec nosniff : un corrigé se serait
    // ouvert dans un tableur, un classeur en texte brut.
    expect(contentTypeForFileName('coteris-corrige-x-2026-08-04.pdf')).toBe('application/pdf')
    expect(contentTypeForFileName('coteris-resultats-x.csv')).toContain('text/csv')
    expect(contentTypeForFileName('sans-extension')).toBe('application/octet-stream')
  })
})
