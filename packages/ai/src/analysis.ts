/**
 * Schéma de sortie de l'analyse, et validation des preuves.
 *
 * Le modèle produit un JSON strict décrivant des **états de critères**. Il ne
 * produit jamais de points — c'est le rôle du moteur déterministe
 * (`@coteris/grading`).
 *
 * La fonction la plus importante de ce fichier est `validateEvidence`. Un modèle
 * de langage peut parfaitement citer un extrait qui n'existe pas dans la copie :
 * c'est le mode d'erreur le plus dangereux du produit, parce qu'une preuve
 * inventée est indiscernable d'une vraie preuve à l'œil nu. On vérifie donc que
 * chaque extrait figure **littéralement** dans la transcription.
 */

import { z } from 'zod'

const excerpt = z.string().min(1).max(2000)

const detection = z.object({
  criterionId: z.string().uuid(),
  /** Extraits exacts de la réponse justifiant cet état. Au moins un. */
  excerpts: z.array(excerpt).min(1),
  /** Pour les critères en points par élément. */
  matchedElementCount: z.number().int().min(0).optional(),
})

const problem = z.object({
  criterionId: z.string().uuid(),
  excerpt,
  explanation: z.string().min(1).max(500),
})

export const analysisResultSchema = z.object({
  presentCriteria: z.array(detection),
  partialCriteria: z.array(detection),
  /** Identifiants seuls : un critère absent n'a, par définition, pas d'extrait. */
  missingCriteria: z.array(z.string().uuid()),
  contradictions: z.array(problem),
  factualErrors: z.array(problem),
  /** Éléments corrects repérés mais absents du corrigé. Déclenche une alerte. */
  unexpectedElements: z.array(
    z.object({
      excerpt,
      explanation: z.string().min(1).max(500),
      nearestCriterionId: z.string().uuid().nullable(),
    }),
  ),
  /** Passages que le modèle déclare ne pas lire avec certitude. */
  uncertainSpans: z.array(
    z.object({ excerpt, reason: z.string().min(1).max(300) }),
  ),
  needsHumanReview: z.boolean(),
  /** Netteté de la correspondance, entre 0 et 1. Entre dans le calcul de confiance. */
  matchClarity: z.number().min(0).max(1),
})

export type AnalysisResult = z.infer<typeof analysisResultSchema>
export type CriterionDetection = z.infer<typeof detection>

export class AnalysisValidationError extends Error {
  readonly problems: readonly string[]

  constructor(problems: readonly string[]) {
    super(`Analyse invalide :\n${problems.map((p) => `  · ${p}`).join('\n')}`)
    this.name = 'AnalysisValidationError'
    this.problems = problems
  }
}

/** Normalise pour la comparaison : espaces et casse, sans toucher au contenu. */
function normalize(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('fr-FR')
}

/**
 * Vérifie que chaque extrait cité figure réellement dans la transcription.
 *
 * C'est la barrière contre la preuve inventée. Un extrait qui n'existe pas dans
 * la copie invalide l'analyse : mieux vaut demander une validation humaine que
 * proposer des points appuyés sur une citation fabriquée.
 *
 * La comparaison tolère les différences d'espacement, de casse et de type
 * d'apostrophe — un modèle qui restitue « l'iode » là où l'OCR a produit
 * « l’iode » ne ment pas, il normalise.
 */
export function validateEvidence(analysis: AnalysisResult, transcription: string): void {
  const haystack = normalize(transcription)
  const problems: string[] = []

  const check = (text: string, contexte: string): void => {
    if (!haystack.includes(normalize(text))) {
      problems.push(
        `${contexte} : l'extrait « ${text.slice(0, 80)} » ne figure pas dans la ` +
          `transcription. Une preuve inventée ne peut pas justifier des points.`,
      )
    }
  }

  for (const d of analysis.presentCriteria) {
    d.excerpts.forEach((e) => check(e, `critère présent ${d.criterionId}`))
  }
  for (const d of analysis.partialCriteria) {
    d.excerpts.forEach((e) => check(e, `critère partiel ${d.criterionId}`))
  }
  for (const c of analysis.contradictions) check(c.excerpt, `contradiction ${c.criterionId}`)
  for (const f of analysis.factualErrors) check(f.excerpt, `erreur factuelle ${f.criterionId}`)
  for (const u of analysis.unexpectedElements) check(u.excerpt, 'élément inattendu')

  if (problems.length > 0) throw new AnalysisValidationError(problems)
}

/**
 * Vérifie que l'analyse ne porte que sur des critères du barème verrouillé.
 *
 * Un modèle peut inventer un identifiant. Corriger hors du barème validé
 * contredirait le principe « aucune correction sans barème validé ».
 */
export function validateCriteriaScope(
  analysis: AnalysisResult,
  knownCriterionIds: readonly string[],
): void {
  const known = new Set(knownCriterionIds)
  const problems: string[] = []
  const seen = new Set<string>()

  const visit = (id: string, contexte: string): void => {
    if (!known.has(id)) {
      problems.push(`${contexte} : le critère ${id} n'appartient pas au barème verrouillé.`)
    }
    if (seen.has(id)) {
      problems.push(`${contexte} : le critère ${id} apparaît dans plusieurs catégories.`)
    }
    seen.add(id)
  }

  analysis.presentCriteria.forEach((d) => visit(d.criterionId, 'critère présent'))
  analysis.partialCriteria.forEach((d) => visit(d.criterionId, 'critère partiel'))
  analysis.missingCriteria.forEach((id) => visit(id, 'critère absent'))

  // Contradictions et erreurs factuelles sont orthogonales à l'état : elles
  // peuvent porter sur un critère déjà classé présent. On vérifie seulement
  // qu'elles restent dans le barème.
  for (const c of analysis.contradictions) {
    if (!known.has(c.criterionId)) {
      problems.push(`contradiction : le critère ${c.criterionId} n'appartient pas au barème.`)
    }
  }
  for (const f of analysis.factualErrors) {
    if (!known.has(f.criterionId)) {
      problems.push(`erreur factuelle : le critère ${f.criterionId} n'appartient pas au barème.`)
    }
  }

  const manquants = knownCriterionIds.filter((id) => !seen.has(id))
  if (manquants.length > 0) {
    problems.push(
      `${manquants.length} critère(s) du barème ne sont classés dans aucune catégorie : ` +
        `l'analyse est incomplète.`,
    )
  }

  if (problems.length > 0) throw new AnalysisValidationError(problems)
}

/** Analyse vide, utilisée quand la lecture est trop incertaine pour conclure. */
export function inconclusiveAnalysis(allCriterionIds: readonly string[]): AnalysisResult {
  return {
    presentCriteria: [],
    partialCriteria: [],
    missingCriteria: [...allCriterionIds],
    contradictions: [],
    factualErrors: [],
    unexpectedElements: [],
    uncertainSpans: [],
    needsHumanReview: true,
    matchClarity: 0,
  }
}
