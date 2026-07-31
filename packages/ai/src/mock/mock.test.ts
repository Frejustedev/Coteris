import { describe, expect, it } from 'vitest'
import { createMockOcrProvider, createMockTextAnalysisProvider } from './index'
import { validateCriteriaScope, validateEvidence } from '../analysis'
import type { AnalysisRequest, RegionImage } from '../providers'

const image: RegionImage = {
  key: 'copie-1/q1',
  bytes: new Uint8Array([1, 2, 3]),
  mimeType: 'image/png',
  widthPx: 800,
  heightPx: 200,
}

const TRANSCRIPTION =
  "Il faut donner de l'iode non radioactif pour protéger la thyroïde avant l'injection."

const C_IODE = '11111111-1111-4111-8111-111111111111'
const C_THYROIDE = '22222222-2222-4222-8222-222222222222'
const C_CAPTATION = '33333333-3333-4333-8333-333333333333'

/** Le barème du scénario iode stable / MIBG de la section 39. */
const requête: AnalysisRequest = {
  questionPrompt:
    "Pourquoi administre-t-on de l'iode stable avant certaines explorations à la MIBG ?",
  answerKeyText:
    "L'iode stable permet de saturer ou bloquer la thyroïde afin de réduire sa captation " +
    "d'iode radioactif libre.",
  criteria: [
    {
      id: C_IODE,
      label: "Mention de l'iode stable",
      description: null,
      acceptableAnswers: ["iode stable", "iode non radioactif"],
      expectedElementCount: 1,
    },
    {
      id: C_THYROIDE,
      label: 'Protection ou blocage de la thyroïde',
      description: null,
      acceptableAnswers: ['protéger la thyroïde', 'bloquer la thyroïde', 'saturer la thyroïde'],
      expectedElementCount: 1,
    },
    {
      id: C_CAPTATION,
      label: "Réduction de la captation d'iode radioactif libre",
      description: null,
      acceptableAnswers: ['réduire la captation', "captation d'iode radioactif libre"],
      expectedElementCount: 1,
    },
  ],
  transcription: TRANSCRIPTION,
  language: 'fr',
}

describe('OCR simulé', () => {
  it('retourne la transcription de la fixture', async () => {
    const ocr = createMockOcrProvider({ fixtures: { 'copie-1/q1': TRANSCRIPTION } })
    const { result } = await ocr.transcribe(image)
    expect(result.fullText).toBe(TRANSCRIPTION)
    expect(result.confidence).toBe(0.97)
  })

  it('produit des décalages exacts pour chaque mot', async () => {
    // Les décalages permettront de remonter d'un extrait au pixel de la copie.
    const ocr = createMockOcrProvider({ fixtures: { 'copie-1/q1': TRANSCRIPTION } })
    const { result } = await ocr.transcribe(image)

    for (const mot of result.words) {
      expect(TRANSCRIPTION.slice(mot.startOffset, mot.endOffset)).toBe(mot.text)
    }
    expect(result.words.length).toBe(TRANSCRIPTION.trim().split(/\s+/).length)
  })

  it('est déterministe', async () => {
    const ocr = createMockOcrProvider({ fixtures: { 'copie-1/q1': TRANSCRIPTION } })
    const a = await ocr.transcribe(image)
    const b = await ocr.transcribe(image)
    expect(a.result).toEqual(b.result)
    expect(a.usage.durationMs).toBe(b.usage.durationMs)
  })

  it('permet de simuler une lecture douteuse', async () => {
    const ocr = createMockOcrProvider({
      fixtures: { 'copie-1/q1': TRANSCRIPTION },
      confidence: 0.55,
      uncertainWords: ['thyroïde'],
    })
    const { result } = await ocr.transcribe(image)
    expect(result.confidence).toBe(0.55)
    const douteux = result.words.find((m) => m.text.includes('thyroïde'))
    expect(douteux?.confidence).toBe(0.45)
    expect(douteux?.alternatives.length).toBeGreaterThan(0)
  })

  it('ne coûte rien', async () => {
    const ocr = createMockOcrProvider()
    const { usage } = await ocr.transcribe(image)
    expect(usage.provider).toBe('mock')
  })
})

describe('analyse simulée — scénario iode stable / MIBG', () => {
  it('détecte les deux critères présents et signale le troisième absent', async () => {
    const analyse = createMockTextAnalysisProvider()
    const { result } = await analyse.analyze(requête)

    expect(result.presentCriteria.map((d) => d.criterionId).sort()).toEqual(
      [C_IODE, C_THYROIDE].sort(),
    )
    expect(result.missingCriteria).toEqual([C_CAPTATION])
  })

  it('cite la copie, pas le corrigé', async () => {
    // La preuve doit venir du texte de l'étudiant. Ici « iode non radioactif »
    // est ce qu'il a écrit ; « iode stable » est la formulation du barème.
    const analyse = createMockTextAnalysisProvider()
    const { result } = await analyse.analyze(requête)

    const iode = result.presentCriteria.find((d) => d.criterionId === C_IODE)
    expect(iode?.excerpts).toContain('iode non radioactif')
    expect(iode?.excerpts).not.toContain('iode stable')
  })

  it('produit des extraits qui passent la validation des preuves', async () => {
    const analyse = createMockTextAnalysisProvider()
    const { result } = await analyse.analyze(requête)

    expect(() => validateEvidence(result, TRANSCRIPTION)).not.toThrow()
    expect(() =>
      validateCriteriaScope(result, [C_IODE, C_THYROIDE, C_CAPTATION]),
    ).not.toThrow()
  })

  it('restitue l’extrait avec ses accents intacts', async () => {
    // Le piège de la normalisation : « protéger » ne doit pas revenir
    // « proteger », ni décalé de deux caractères.
    const analyse = createMockTextAnalysisProvider()
    const { result } = await analyse.analyze(requête)

    const thyroïde = result.presentCriteria.find((d) => d.criterionId === C_THYROIDE)
    expect(thyroïde?.excerpts[0]).toBe('protéger la thyroïde')
    expect(TRANSCRIPTION).toContain(thyroïde?.excerpts[0] as string)
  })

  it('exige toujours une validation humaine', async () => {
    const analyse = createMockTextAnalysisProvider()
    const { result } = await analyse.analyze(requête)
    expect(result.needsHumanReview).toBe(true)
  })

  it('est déterministe', async () => {
    const analyse = createMockTextAnalysisProvider()
    const a = await analyse.analyze(requête)
    const b = await analyse.analyze(requête)
    expect(a.result).toEqual(b.result)
  })

  it('permet de simuler un cas partiel', async () => {
    const analyse = createMockTextAnalysisProvider({ partialCriterionIds: [C_THYROIDE] })
    const { result } = await analyse.analyze(requête)
    expect(result.partialCriteria.map((d) => d.criterionId)).toEqual([C_THYROIDE])
    expect(result.presentCriteria.map((d) => d.criterionId)).toEqual([C_IODE])
  })

  it('permet de simuler une réponse correcte non prévue', async () => {
    const analyse = createMockTextAnalysisProvider({
      unexpectedExcerpts: ["avant l'injection"],
    })
    const { result } = await analyse.analyze(requête)
    expect(result.unexpectedElements).toHaveLength(1)
    expect(() => validateEvidence(result, TRANSCRIPTION)).not.toThrow()
  })

  it('classe tout en absent sur une copie blanche', async () => {
    const analyse = createMockTextAnalysisProvider()
    const { result } = await analyse.analyze({ ...requête, transcription: '' })
    expect(result.missingCriteria).toHaveLength(3)
    expect(result.presentCriteria).toHaveLength(0)
  })
})
