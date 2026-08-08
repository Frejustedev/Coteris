/**
 * Proposition de barème à partir d'un corrigé rédigé en prose.
 *
 * Saisir un barème critère par critère est le premier frein à l'adoption : un
 * enseignant qui a déjà écrit son corrigé doit le ressaisir sous forme de
 * grille. Ce module décrit ce qu'un modèle a le droit de proposer — et surtout
 * ce qu'il n'a pas le droit de décider.
 *
 * DEUX CHOSES QUE LE MODÈLE NE PRODUIT PAS
 *
 * **Les identifiants.** Ils sont attribués à l'enregistrement. Un modèle qui les
 * produirait pourrait en inventer un déjà pris, ou en réutiliser un d'une autre
 * question.
 *
 * **Les points.** Le barème d'une question est fixé par l'enseignant, et la
 * somme des critères doit tomber juste — c'est un contrôle du verrouillage. Le
 * modèle propose un DÉCOUPAGE ; la répartition des points est arithmétique, donc
 * faite ici, exactement, en millièmes entiers.
 *
 * LA RÈGLE QUI CALQUE « AUCUNE NOTE SANS PREUVE »
 *
 * Chaque critère proposé doit citer le passage du corrigé dont il est tiré, et
 * ce passage doit s'y retrouver littéralement. Un modèle peut parfaitement
 * inventer un critère plausible qui ne figure nulle part dans le corrigé de
 * l'enseignant : ce serait un critère hors sujet présenté comme fidèle. La
 * citation rend la proposition vérifiable d'un coup d'œil.
 */

import { z } from 'zod'
import { distribute, fromMillipoints, type Millipoints } from '@coteris/shared'

/**
 * Ce qu'un modèle rend : un découpage, sans identifiants ni points.
 *
 * Les bornes de longueur ne sont pas transmissibles par les sorties structurées
 * — elles sont rappelées dans l'invite et réimposées ici, comme pour l'analyse.
 */
export const critèreProposéSchema = z.object({
  /** Intitulé court, tel qu'il figurera dans la grille. */
  label: z.string().min(1).max(200),
  /**
   * Passage du corrigé dont ce critère est tiré, recopié littéralement.
   *
   * Vérifié contre le texte réel : c'est la barrière contre le critère inventé.
   */
  citation: z.string().min(1).max(1000),
  /** Formulations qu'une copie peut employer pour satisfaire ce critère. */
  acceptableAnswers: z.array(z.string().min(1).max(200)).max(20),
  /**
   * Poids relatif, entre 1 et 5.
   *
   * Le modèle dit qu'un critère compte davantage qu'un autre ; il ne dit pas
   * combien de points il vaut. La conversion en millièmes est arithmétique.
   */
  poids: z.number().int().min(1).max(5),
})

export const barèmeProposéSchema = z.object({
  critères: z.array(critèreProposéSchema).min(1).max(30),
  /**
   * Ce que le modèle n'a pas su rattacher à un critère.
   *
   * Signalé plutôt que silencieusement omis : un corrigé dont la moitié n'entre
   * dans aucun critère doit alerter l'enseignant.
   */
  passagesNonCouverts: z.array(z.string().min(1).max(500)).max(20),
})

export type CritèreProposé = z.infer<typeof critèreProposéSchema>
export type BarèmeProposé = z.infer<typeof barèmeProposéSchema>

export interface RubricDraftRequest {
  readonly questionPrompt: string
  /** Corrigé rédigé, tel que l'enseignant l'a saisi. */
  readonly answerKeyText: string
  readonly maxPoints: Millipoints
  readonly language: string
}

/** Critère prêt à enregistrer : le découpage du modèle, plus les points. */
export interface CritèreÀEnregistrer extends CritèreProposé {
  readonly maxPoints: Millipoints
}

export class RubricDraftError extends Error {
  readonly problems: readonly string[]

  constructor(problems: readonly string[]) {
    super(`Proposition de barème invalide :\n${problems.map((p) => `  · ${p}`).join('\n')}`)
    this.name = 'RubricDraftError'
    this.problems = problems
  }
}

/** Normalise pour la comparaison : espaces, casse, apostrophes. */
function normaliser(texte: string): string {
  return texte
    .normalize('NFC')
    .replace(/[‘’ʼ]/gu, "'")
    .replace(/[“”]/gu, '"')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase('fr-FR')
}

/**
 * Vérifie que chaque critère cite un passage réel du corrigé.
 *
 * Même barrière que `validateEvidence` pour les copies, et pour la même raison :
 * une citation inventée est indiscernable d'une vraie à l'œil nu. Ici l'enjeu
 * n'est pas une note mais un barème — dont toutes les notes découleront.
 */
export function validateDraftCitations(barème: BarèmeProposé, corrigé: string): void {
  const foin = normaliser(corrigé)
  const problèmes: string[] = []

  for (const critère of barème.critères) {
    if (!foin.includes(normaliser(critère.citation))) {
      problèmes.push(
        `critère « ${critère.label.slice(0, 60)} » : le passage cité ne figure pas dans le ` +
          `corrigé. Un critère qui ne s'y rattache pas ne peut pas être proposé.`,
      )
    }
  }

  if (problèmes.length > 0) throw new RubricDraftError(problèmes)
}

/**
 * Répartit le barème de la question entre les critères, selon leurs poids.
 *
 * Arithmétique exacte en millièmes : la somme des critères égale le barème au
 * millième près, sans reste perdu. Le contrôle de cohérence du verrouillage
 * l'exige, et un écart d'un millième bloquerait le verrouillage sans que
 * l'enseignant comprenne pourquoi.
 */
export function repartirPoints(
  critères: readonly CritèreProposé[],
  maxPoints: Millipoints,
): CritèreÀEnregistrer[] {
  if (critères.length === 0) return []

  const poidsTotal = critères.reduce((s, c) => s + c.poids, 0)

  // Part entière selon le poids, puis distribution exacte du reste. Donner tout
  // le reste au dernier critère le gonflerait arbitrairement ; `distribute`
  // l'étale un millième à la fois, et garantit que la somme retombe juste.
  const parts = critères.map((c) => Math.trunc((maxPoints * c.poids) / poidsTotal))
  const attribué = parts.reduce((s, p) => s + p, 0)
  const reste = distribute(fromMillipoints(maxPoints - attribué), critères.length)

  return critères.map((critère, index) => ({
    ...critère,
    maxPoints: fromMillipoints((parts[index] ?? 0) + (reste[index] ?? 0)),
  }))
}
