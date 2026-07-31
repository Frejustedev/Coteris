import { describe, expect, it } from 'vitest'

import {
  buildAuditCsv,
  buildResultsCsv,
  escapeCsvValue,
  exportFileName,
  formatDateCsv,
  formatPointsCsv,
  toCsv,
  type LigneRésultat,
  type QuestionColonne,
} from './index'

// --- Échappement -----------------------------------------------------------------

describe('échappement CSV', () => {
  it('laisse une valeur simple intacte', () => {
    expect(escapeCsvValue('ANON-001', ';')).toBe('ANON-001')
  })

  it('cite une valeur contenant le séparateur', () => {
    expect(escapeCsvValue('Dupont; Jean', ';')).toBe('"Dupont; Jean"')
  })

  it('double les guillemets internes', () => {
    expect(escapeCsvValue('réponse "correcte"', ';')).toBe('"réponse ""correcte"""')
  })

  it('cite une valeur contenant un saut de ligne', () => {
    expect(escapeCsvValue('ligne 1\nligne 2', ';')).toBe('"ligne 1\nligne 2"')
  })

  it('rend une valeur nulle par une cellule vide', () => {
    expect(escapeCsvValue(null, ';')).toBe('')
    expect(escapeCsvValue(undefined, ';')).toBe('')
  })
})

describe('injection de formule', () => {
  /**
   * Une cellule commençant par =, +, - ou @ est interprétée comme une formule à
   * l'ouverture du fichier. Une valeur venue d'un import s'exécuterait alors sur
   * le poste de l'enseignant.
   */
  it('neutralise les valeurs commençant par un caractère de formule', () => {
    expect(escapeCsvValue('=1+1', ';')).toBe("'=1+1")
    expect(escapeCsvValue('+33612345678', ';')).toBe("'+33612345678")
    expect(escapeCsvValue('-5', ';')).toBe("'-5")
    expect(escapeCsvValue('@import', ';')).toBe("'@import")
  })

  it('neutralise une formule vraiment dangereuse', () => {
    const attaque = '=HYPERLINK("http://exemple.invalide","Cliquez")'
    const échappé = escapeCsvValue(attaque, ';')

    // La valeur contient des guillemets : elle est donc citée par la syntaxe CSV,
    // et l'apostrophe protectrice se trouve à l'intérieur des guillemets. C'est
    // bien elle qu'Excel lit en tête de cellule.
    expect(échappé.startsWith('"')).toBe(true)
    expect(échappé).toContain("'=HYPERLINK")

    // Le contenu reste lisible : on neutralise, on ne censure pas.
    expect(échappé).toContain('HYPERLINK')
  })

  it('neutralise aussi la tabulation et le retour chariot en tête', () => {
    expect(escapeCsvValue('\t=1+1', ';').startsWith("'")).toBe(true)
  })

  it('ne neutralise pas une valeur légitime', () => {
    expect(escapeCsvValue('0,25', ';')).toBe('0,25')
    expect(escapeCsvValue('Q1', ';')).toBe('Q1')
  })
})

// --- Format francophone -----------------------------------------------------------

describe('format attendu par Excel francophone', () => {
  it('sépare les colonnes par un point-virgule', () => {
    const csv = toCsv(['a', 'b'], [[1, 2]])
    expect(csv).toContain('a;b')
    expect(csv).toContain('1;2')
  })

  it('place une marque d’ordre des octets', () => {
    // Sans elle, Excel lit le fichier dans l'encodage local et les accents
    // deviennent illisibles.
    expect(toCsv(['é'], []).charCodeAt(0)).toBe(0xfeff)
  })

  it('permet de s’en passer', () => {
    expect(toCsv(['é'], [], { bom: false }).charCodeAt(0)).not.toBe(0xfeff)
  })

  it('termine les lignes par CRLF', () => {
    expect(toCsv(['a'], [['x']])).toBe('﻿a\r\nx\r\n')
  })

  it('formate les points avec une virgule décimale', () => {
    expect(formatPointsCsv(250)).toBe('0,25')
    expect(formatPointsCsv(1000)).toBe('1')
    expect(formatPointsCsv(4700)).toBe('4,7')
    expect(formatPointsCsv(20000)).toBe('20')
  })

  it('rend une cellule vide pour une note absente', () => {
    expect(formatPointsCsv(null)).toBe('')
  })

  it('formate les dates de façon triable', () => {
    expect(formatDateCsv(new Date('2026-08-01T09:05:00Z'))).toBe('2026-08-01 09:05')
    expect(formatDateCsv(null)).toBe('')
  })
})

// --- Export des résultats -----------------------------------------------------------

describe('export des résultats', () => {
  const questions: QuestionColonne[] = [
    { questionId: 'q1', number: '1', maxPoints: 1000 },
    { questionId: 'q2', number: '2', maxPoints: 1000 },
  ]

  const lignes: LigneRésultat[] = [
    {
      identifiant: 'ANON-001',
      pointsParQuestion: { q1: 1000, q2: 500 },
      total: 1500,
      totalMax: 2000,
      entièrementValidée: true,
      validateur: 'A. Coordinateur',
      validéeLe: new Date('2026-08-01T09:00:00Z'),
    },
    {
      identifiant: 'ANON-002',
      pointsParQuestion: { q1: 250, q2: null },
      total: 250,
      totalMax: 2000,
      entièrementValidée: false,
      validateur: null,
      validéeLe: null,
    },
  ]

  const csv = buildResultsCsv(questions, lignes, {
    titreÉpreuve: 'Médecine nucléaire',
    anonymisé: true,
  })

  it('titre les colonnes de questions avec leur barème', () => {
    expect(csv).toContain('Q1 (/1);Q2 (/1)')
  })

  it('nomme la première colonne selon l’anonymisation', () => {
    expect(csv).toContain('Code anonyme')
    const nominatif = buildResultsCsv(questions, lignes, {
      titreÉpreuve: 'x',
      anonymisé: false,
    })
    expect(nominatif).toContain('Étudiant')
  })

  it('reporte les notes par question et le total', () => {
    expect(csv).toContain('ANON-001;1;0,5;1,5;2')
  })

  it('distingue explicitement une note validée d’une note proposée', () => {
    // Un relevé qui mélangerait les deux sans le dire serait trompeur — et c'est
    // le genre de document qu'on transmet à un jury.
    expect(csv).toContain('Validée')
    expect(csv).toContain('Proposée — non validée')
  })

  it('laisse vides le validateur et la date tant que rien n’est validé', () => {
    const ligne = csv.split('\r\n').find((l) => l.startsWith('ANON-002'))
    expect(ligne?.endsWith(';;')).toBe(true)
  })

  it('produit une ligne d’en-tête et une ligne par copie', () => {
    const lignesNonVides = csv.split('\r\n').filter((l) => l.trim() !== '')
    expect(lignesNonVides).toHaveLength(3)
  })
})

// --- Rapport d'audit --------------------------------------------------------------

describe('rapport d’audit', () => {
  const csv = buildAuditCsv(
    [
      {
        sequence: 1,
        occurredAt: new Date('2026-08-01T08:00:00Z'),
        action: 'rubric.lock',
        objectType: 'rubric_version',
        acteur: 'A. Coordinateur',
        rôle: 'coordinator',
        motif: 'Barème validé en commission',
        hash: 'abc123',
      },
      {
        sequence: 2,
        occurredAt: new Date('2026-08-01T08:05:00Z'),
        action: 'grade.propose',
        objectType: 'grading_run',
        acteur: null,
        rôle: null,
        motif: null,
        hash: 'def456',
      },
    ],
    { titreÉpreuve: 'Médecine nucléaire' },
  )

  it('traduit les codes d’action en français', () => {
    expect(csv).toContain('Verrouillage du barème')
    expect(csv).toContain('Proposition de note')
  })

  it('inclut l’empreinte de chaque événement', () => {
    // Elle permet de confronter le document remis à un jury avec la chaîne
    // restée en base. Sans elle, le rapport n'est qu'une liste d'affirmations.
    expect(csv).toContain('abc123')
    expect(csv).toContain('def456')
  })

  it('nomme « système » les actions sans acteur', () => {
    expect(csv).toContain('système')
  })
})

// --- Nom de fichier -----------------------------------------------------------------

describe('nom de fichier', () => {
  it('translittère et assainit le titre', () => {
    const nom = exportFileName('Médecine nucléaire — épreuve', 'resultats', new Date('2026-08-01'))
    expect(nom).toBe('coteris-resultats-medecine-nucleaire-epreuve-2026-08-01.csv')
  })

  it('ne produit jamais de séparateur de chemin', () => {
    const nom = exportFileName('../../etc/passwd', 'resultats', new Date('2026-08-01'))
    expect(nom).not.toContain('/')
    expect(nom).not.toContain('..')
  })

  it('reste correct sur un titre vide', () => {
    expect(exportFileName('', 'audit', new Date('2026-08-01'))).toBe(
      'coteris-audit-epreuve-2026-08-01.csv',
    )
  })
})
