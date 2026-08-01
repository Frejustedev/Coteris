/**
 * Importateur du jeu d'évaluation.
 *
 * Le jeu attendu — 150 à 200 copies anonymisées, 1 000 à 2 000 réponses courtes,
 * barèmes validés et décisions humaines de référence — n'est pas dans le dépôt et
 * ne doit jamais y entrer.
 *
 * Cet importateur lit un fichier JSON depuis un chemin fourni à l'exécution,
 * valide sa structure, **et refuse tout ce qui ressemble à une donnée
 * personnelle**. Ce dernier point n'est pas de la précaution rituelle : un jeu
 * d'évaluation circule entre postes, se copie dans des rapports, et finit par
 * traîner. Mieux vaut qu'il ne contienne rien d'identifiant dès le départ.
 */

import { z } from 'zod'

const état = z.enum(['present', 'partial', 'absent'])

const critèreRéférence = z.object({
  criterionId: z.string().min(1),
  /** Décision du correcteur, qui fait référence. */
  référence: état,
  /** Points retenus par le correcteur, en millièmes. */
  pointsRéférence: z.number().int(),
})

export const réponseÉvaluationSchema = z.object({
  /** Identifiant interne au jeu d'évaluation. Jamais un nom, jamais un matricule. */
  id: z.string().min(1).max(64),
  submissionId: z.string().min(1).max(64),
  questionId: z.string().min(1).max(64),
  /** Énoncé de la question. */
  question: z.string().min(1),
  /** Corrigé officiel. */
  corrigé: z.string(),
  /** Transcription de référence, établie par un humain. */
  transcriptionRéférence: z.string(),
  /** Critères du barème, avec leurs formulations acceptables. */
  critères: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        maxPoints: z.number().int().min(0),
        acceptableAnswers: z.array(z.string()).default([]),
      }),
    )
    .min(1),
  décisionsRéférence: z.array(critèreRéférence).min(1),
  totalRéférence: z.number().int(),
  pointsMax: z.number().int().min(1),
  /** Qualité du scan, pour ventiler les résultats. */
  qualitéScan: z.enum(['bonne', 'moyenne', 'mauvaise']).default('bonne'),
  /** Style d'écriture, pour la même raison. */
  styleÉcriture: z.enum(['lisible', 'moyen', 'difficile']).default('lisible'),
  /**
   * D'où vient la transcription de référence.
   *
   * `manuscrit` : la réponse a été écrite à la main puis transcrite. C'est le cas
   * réel, et le seul qui permette de mesurer la chaîne complète.
   *
   * `saisie` : la réponse a été tapée. La transcription est parfaite par
   * construction, ce qui **isole l'étape d'analyse** et donne une borne haute.
   * Utile — mais un résultat obtenu ainsi ne dit rien de ce que la lecture
   * manuscrite fera perdre.
   */
  origineTranscription: z.enum(['manuscrit', 'saisie']).default('manuscrit'),
  /** Chemin de l'image de la zone, relatif au jeu. Facultatif. */
  image: z.string().optional(),
})

export const jeuÉvaluationSchema = z.object({
  version: z.literal(1),
  description: z.string(),
  réponses: z.array(réponseÉvaluationSchema),
})

export type RéponseÉvaluation = z.infer<typeof réponseÉvaluationSchema>
export type JeuÉvaluation = z.infer<typeof jeuÉvaluationSchema>

export class DatasetError extends Error {
  readonly problèmes: readonly string[]

  constructor(problèmes: readonly string[]) {
    super(`Jeu d'évaluation invalide :\n${problèmes.map((p) => `  · ${p}`).join('\n')}`)
    this.name = 'DatasetError'
    this.problèmes = problèmes
  }
}

/**
 * Champs dont la présence trahit un jeu non anonymisé.
 *
 * La liste est volontairement large : un faux positif coûte une renommée de
 * champ, un faux négatif coûte une fuite de données d'étudiants.
 */
const CHAMPS_INTERDITS = [
  'nom',
  'prenom',
  'prénom',
  'name',
  'firstname',
  'lastname',
  'email',
  'mail',
  'telephone',
  'téléphone',
  'phone',
  'matricule',
  'numeroetudiant',
  'numéroétudiant',
  'studentid',
  'ine',
  'birthdate',
  'datenaissance',
  'adresse',
  'address',
]

const MOTIF_EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/
const MOTIF_TÉLÉPHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\d[\s.-]?){9,}\d/

/**
 * Vérifie qu'aucune donnée personnelle n'a été laissée dans le jeu.
 *
 * Contrôle deux choses : les **noms de champs** ajoutés hors schéma, et le
 * **contenu** des textes libres, où une adresse électronique ou un numéro se
 * glisse facilement au moment de l'extraction.
 */
export function assertAnonymisé(brut: unknown): void {
  const problèmes: string[] = []

  const visiter = (valeur: unknown, chemin: string): void => {
    if (valeur === null || valeur === undefined) return

    if (typeof valeur === 'string') {
      if (MOTIF_EMAIL.test(valeur)) {
        problèmes.push(`${chemin} : une adresse électronique apparaît dans le texte.`)
      }
      if (MOTIF_TÉLÉPHONE.test(valeur)) {
        problèmes.push(`${chemin} : une suite de chiffres ressemblant à un numéro apparaît.`)
      }
      return
    }

    if (Array.isArray(valeur)) {
      valeur.forEach((v, i) => visiter(v, `${chemin}[${i}]`))
      return
    }

    if (typeof valeur === 'object') {
      for (const [clé, v] of Object.entries(valeur as Record<string, unknown>)) {
        const normalisée = clé.toLowerCase().replace(/[^a-zà-ÿ]/g, '')
        if (CHAMPS_INTERDITS.includes(normalisée)) {
          problèmes.push(
            `${chemin}.${clé} : ce champ ne doit pas figurer dans un jeu d'évaluation.`,
          )
        }
        visiter(v, `${chemin}.${clé}`)
      }
    }
  }

  visiter(brut, 'jeu')

  if (problèmes.length > 0) throw new DatasetError(problèmes)
}

/** Analyse et valide un jeu d'évaluation. */
export function parseDataset(brut: unknown): JeuÉvaluation {
  assertAnonymisé(brut)

  const analyse = jeuÉvaluationSchema.safeParse(brut)
  if (!analyse.success) {
    throw new DatasetError(
      analyse.error.issues.map((i) => `${i.path.join('.') || '(racine)'} : ${i.message}`),
    )
  }

  const problèmes: string[] = []

  for (const réponse of analyse.data.réponses) {
    const connus = new Set(réponse.critères.map((c) => c.id))

    for (const d of réponse.décisionsRéférence) {
      if (!connus.has(d.criterionId)) {
        problèmes.push(
          `réponse ${réponse.id} : la décision porte sur le critère ${d.criterionId}, ` +
            `absent du barème.`,
        )
      }
    }

    const manquants = [...connus].filter(
      (id) => !réponse.décisionsRéférence.some((d) => d.criterionId === id),
    )
    if (manquants.length > 0) {
      problèmes.push(
        `réponse ${réponse.id} : ${manquants.length} critère(s) sans décision de référence. ` +
          `Une référence incomplète fausserait le rappel.`,
      )
    }

    const somme = réponse.décisionsRéférence.reduce((s, d) => s + d.pointsRéférence, 0)
    if (somme !== réponse.totalRéférence) {
      problèmes.push(
        `réponse ${réponse.id} : le total de référence (${réponse.totalRéférence}) ne ` +
          `correspond pas à la somme des critères (${somme}).`,
      )
    }

    if (réponse.totalRéférence > réponse.pointsMax) {
      problèmes.push(`réponse ${réponse.id} : le total de référence dépasse le barème.`)
    }
  }

  if (problèmes.length > 0) throw new DatasetError(problèmes)

  return analyse.data
}
