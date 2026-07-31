/**
 * Le test qui prouve que la chaîne complète fonctionne.
 *
 * OCR → analyse → validation des preuves → moteur déterministe → confiance,
 * sur le scénario iode stable / MIBG de la section 39.
 */

import { describe, expect, it } from 'vitest'
import { ZERO, asId, millipoints, type QuestionId, type RubricCriterionId } from '@coteris/shared'
import {
  createMockOcrProvider,
  createMockTextAnalysisProvider,
  type OcrResult,
  type RegionImage,
} from '@coteris/ai'
import type { QuestionGradingRules, RubricCriterion } from '@coteris/grading'

import { RubricNotLockedError, gradeAnswer, type GradeAnswerInput } from './grade-answer'

const QUESTION = asId<'Question'>('11111111-1111-4111-8111-111111111111') as QuestionId
const C_IODE = asId<'RubricCriterion'>('aaaaaaaa-1111-4111-8111-111111111111') as RubricCriterionId
const C_THYRO = asId<'RubricCriterion'>('bbbbbbbb-2222-4222-8222-222222222222') as RubricCriterionId
const C_CAPT = asId<'RubricCriterion'>('cccccccc-3333-4333-8333-333333333333') as RubricCriterionId

const RÉPONSE_ÉTUDIANT =
  "Il faut donner de l'iode non radioactif pour protéger la thyroïde avant l'injection."

const image: RegionImage = {
  key: 'copie-1/q1',
  bytes: new Uint8Array([0]),
  mimeType: 'image/png',
  widthPx: 800,
  heightPx: 200,
}

function critère(
  id: RubricCriterionId,
  label: string,
  points: number,
  order: number,
): RubricCriterion {
  return {
    id,
    questionId: QUESTION,
    label,
    attribution: 'all_or_nothing',
    pointsMax: millipoints(points),
    order,
    required: false,
    partialRatioPercent: 50,
    expectedElementCount: 1,
    pointsPerElement: null,
    cap: null,
    contradictionPolicy: { kind: 'ignore' },
    factualErrorPenalty: null,
    excludedBy: [],
  }
}

const BARÈME: RubricCriterion[] = [
  critère(C_IODE, "Mention de l'iode stable", 0.25, 1),
  critère(C_THYRO, 'Protection ou blocage de la thyroïde', 0.25, 2),
  critère(C_CAPT, "Réduction de la captation d'iode radioactif libre", 0.5, 3),
]

const RÈGLES: QuestionGradingRules = {
  questionId: QUESTION,
  pointsMax: millipoints(1),
  allowNegative: false,
  roundingStep: null,
  missingRequiredPolicy: { kind: 'none' },
  allowBonusOverflow: false,
}

const FORMULATIONS = {
  [C_IODE as string]: ['iode stable', 'iode non radioactif'],
  [C_THYRO as string]: ['protéger la thyroïde', 'bloquer la thyroïde', 'saturer la thyroïde'],
  [C_CAPT as string]: ['réduire la captation', "captation d'iode radioactif libre"],
}

async function lire(transcription: string, options: Parameters<typeof createMockOcrProvider>[0] = {}) {
  const ocr = createMockOcrProvider({ fixtures: { 'copie-1/q1': transcription }, ...options })
  const { result } = await ocr.transcribe(image)
  return result
}

function entrée(ocr: OcrResult, over: Partial<GradeAnswerInput> = {}): GradeAnswerInput {
  return {
    questionPrompt:
      "Pourquoi administre-t-on de l'iode stable avant certaines explorations à la MIBG ?",
    answerKeyText:
      "L'iode stable permet de saturer ou bloquer la thyroïde afin de réduire sa captation d'iode radioactif libre.",
    language: 'fr',
    rubricLocked: true,
    criteria: BARÈME,
    acceptableAnswersByCriterion: FORMULATIONS,
    questionRules: RÈGLES,
    ocr,
    ...over,
  }
}

describe('chaîne complète — scénario iode stable / MIBG', () => {
  it('propose 0,5 point sur 1, avec les preuves tirées de la copie', async () => {
    const ocr = await lire(RÉPONSE_ÉTUDIANT)
    const résultat = await gradeAnswer(entrée(ocr), createMockTextAnalysisProvider())

    // Le résultat attendu par le cahier des charges.
    expect(résultat.outcome.total).toBe(millipoints(0.5))
    expect(résultat.outcome.pointsMax).toBe(millipoints(1))

    // Chaque point proposé est adossé à un extrait de la copie.
    const iode = résultat.outcome.criteria.find((c) => c.criterionId === C_IODE)
    const thyro = résultat.outcome.criteria.find((c) => c.criterionId === C_THYRO)
    const capt = résultat.outcome.criteria.find((c) => c.criterionId === C_CAPT)

    expect(iode?.pointsComputed).toBe(millipoints(0.25))
    expect(thyro?.pointsComputed).toBe(millipoints(0.25))
    expect(capt?.pointsComputed).toBe(ZERO)
    expect(capt?.status).toBe('absent')
  })

  it('cite la copie et non le corrigé', async () => {
    const ocr = await lire(RÉPONSE_ÉTUDIANT)
    const résultat = await gradeAnswer(entrée(ocr), createMockTextAnalysisProvider())

    const preuves = résultat.analysis.presentCriteria.flatMap((d) => d.excerpts)
    expect(preuves).toContain('iode non radioactif')
    expect(preuves).toContain('protéger la thyroïde')
    for (const preuve of preuves) {
      expect(RÉPONSE_ÉTUDIANT).toContain(preuve)
    }
  })

  it('classe le cas en vert et n’ordonne pas de seconde analyse coûteuse', async () => {
    const ocr = await lire(RÉPONSE_ÉTUDIANT)
    const résultat = await gradeAnswer(entrée(ocr), createMockTextAnalysisProvider())
    expect(résultat.confidenceLevel).toBe('green')
    // Une double analyse systématique doublerait le coût pour un gain nul.
    expect(résultat.needsSecondPass).toBe(false)
  })

  it('produit une trace de chaque étape du pipeline', async () => {
    const ocr = await lire(RÉPONSE_ÉTUDIANT)
    const résultat = await gradeAnswer(entrée(ocr), createMockTextAnalysisProvider())
    expect(résultat.steps.map((s) => s.step)).toEqual([
      'preparation',
      'readability',
      'analysis',
      'scoring',
      'confidence',
      'second_pass',
    ])
  })

  it('donne le point entier à une réponse complète', async () => {
    const complète =
      "L'iode stable permet de bloquer la thyroïde et de réduire la captation d'iode radioactif libre."
    const ocr = await lire(complète)
    const résultat = await gradeAnswer(entrée(ocr), createMockTextAnalysisProvider())
    expect(résultat.outcome.total).toBe(millipoints(1))
  })

  it('est déterministe', async () => {
    const ocr = await lire(RÉPONSE_ÉTUDIANT)
    const a = await gradeAnswer(entrée(ocr), createMockTextAnalysisProvider())
    const b = await gradeAnswer(entrée(ocr), createMockTextAnalysisProvider())
    expect(a.outcome.total).toBe(b.outcome.total)
    expect(a.confidence).toBe(b.confidence)
  })
})

describe('aucune correction sans barème validé', () => {
  it('refuse de s’exécuter si le barème n’est pas verrouillé', async () => {
    const ocr = await lire(RÉPONSE_ÉTUDIANT)
    await expect(
      gradeAnswer(entrée(ocr, { rubricLocked: false }), createMockTextAnalysisProvider()),
    ).rejects.toThrow(RubricNotLockedError)
  })
})

describe('contrôle de lisibilité — on n’invente jamais', () => {
  it('ne propose rien sur une copie blanche', async () => {
    const ocr = await lire('')
    const résultat = await gradeAnswer(entrée(ocr), createMockTextAnalysisProvider())

    expect(résultat.outcome.total).toBe(ZERO)
    expect(résultat.confidenceLevel).toBe('red')
    expect(résultat.needsCarefulReview).toBe(true)
    expect(résultat.warnings[0]).toContain('aucun texte lisible')
  })

  it('n’analyse même pas une transcription trop douteuse', async () => {
    // Économie réelle : inutile de payer une analyse sur du texte illisible.
    const ocr = await lire(RÉPONSE_ÉTUDIANT, { confidence: 0.25 })
    const résultat = await gradeAnswer(entrée(ocr), createMockTextAnalysisProvider())

    expect(résultat.confidenceLevel).toBe('red')
    expect(résultat.outcome.total).toBe(ZERO)
    expect(résultat.steps.map((s) => s.step)).not.toContain('analysis')
    expect(résultat.warnings[0]).toContain('trop incertaine')
  })

  it('signale les mots incertains sans bloquer la proposition', async () => {
    const ocr = await lire(RÉPONSE_ÉTUDIANT, { uncertainWords: ['thyroïde'] })
    const résultat = await gradeAnswer(entrée(ocr), createMockTextAnalysisProvider())

    expect(résultat.warnings.some((w) => w.includes('confiance faible'))).toBe(true)
    // La proposition existe, mais elle sort du vert : un humain doit regarder.
    expect(résultat.confidenceLevel).not.toBe('green')
    expect(résultat.needsSecondPass).toBe(true)
  })
})

describe('réponse correcte non prévue', () => {
  it('alerte et déclasse le cas hors du vert', async () => {
    const ocr = await lire(RÉPONSE_ÉTUDIANT)
    const résultat = await gradeAnswer(
      entrée(ocr),
      createMockTextAnalysisProvider({ unexpectedExcerpts: ["avant l'injection"] }),
    )

    expect(résultat.analysis.unexpectedElements).toHaveLength(1)
    expect(résultat.warnings.some((w) => w.includes('absent'))).toBe(true)
    // C'est exactement le cas où l'enseignant doit trancher.
    expect(résultat.needsCarefulReview).toBe(true)
    expect(résultat.needsSecondPass).toBe(true)
  })
})

describe('toute proposition reste soumise à un humain', () => {
  it('n’attribue jamais de points définitifs', async () => {
    const ocr = await lire(RÉPONSE_ÉTUDIANT)
    const résultat = await gradeAnswer(entrée(ocr), createMockTextAnalysisProvider())
    // Le pipeline produit `pointsComputed` — une proposition. `pointsAwarded`
    // n'existe qu'après validation humaine, et vit en base.
    expect(résultat.analysis.needsHumanReview).toBe(true)
  })
})
