/**
 * Export des résultats d'une épreuve.
 *
 * Colonnes exigées par le cahier des charges : identifiant de l'étudiant ou code
 * anonyme, note par question, note totale, statut, validateur, date de validation.
 *
 * Une colonne supplémentaire a été ajoutée : **« proposée / validée »**. Un relevé
 * qui mélangerait des notes encore proposées et des notes validées sans les
 * distinguer serait trompeur — et c'est exactement le genre de document qu'on
 * transmet à un jury.
 */

import { formatDateCsv, formatPointsCsv, toCsv, type CsvOptions } from './csv'

export interface QuestionColonne {
  readonly questionId: string
  readonly number: string
  /** En millièmes. */
  readonly maxPoints: number
}

export interface LigneRésultat {
  /** Code anonyme, ou identifiant de l'étudiant si l'anonymat est levé. */
  readonly identifiant: string
  /** Points par question, en millièmes, indexés par identifiant de question. */
  readonly pointsParQuestion: Readonly<Record<string, number | null>>
  readonly total: number | null
  readonly totalMax: number
  /** Vrai si toutes les décisions de la copie ont été validées par un humain. */
  readonly entièrementValidée: boolean
  readonly validateur: string | null
  readonly validéeLe: Date | null
}

export interface OptionsExportRésultats extends CsvOptions {
  readonly titreÉpreuve: string
  readonly anonymisé: boolean
}

export function buildResultsCsv(
  questions: readonly QuestionColonne[],
  lignes: readonly LigneRésultat[],
  options: OptionsExportRésultats,
): string {
  const entêtes = [
    options.anonymisé ? 'Code anonyme' : 'Étudiant',
    ...questions.map((q) => `Q${q.number} (/${formatPointsCsv(q.maxPoints)})`),
    'Total',
    'Barème',
    'Statut',
    'Validateur',
    'Date de validation',
  ]

  const corps = lignes.map((ligne) => [
    ligne.identifiant,
    ...questions.map((q) => formatPointsCsv(ligne.pointsParQuestion[q.questionId] ?? null)),
    formatPointsCsv(ligne.total),
    formatPointsCsv(ligne.totalMax),
    // La distinction est explicite, jamais implicite.
    ligne.entièrementValidée ? 'Validée' : 'Proposée — non validée',
    ligne.validateur ?? '',
    formatDateCsv(ligne.validéeLe),
  ])

  return toCsv(entêtes, corps, options)
}

// --- Rapport d'audit -------------------------------------------------------------

export interface LigneAudit {
  readonly sequence: number
  readonly occurredAt: Date
  readonly action: string
  readonly objectType: string
  readonly acteur: string | null
  readonly rôle: string | null
  readonly motif: string | null
  readonly hash: string
}

/**
 * Rapport d'audit.
 *
 * L'empreinte de chaque événement figure dans l'export : elle permet de
 * confronter le document remis à un jury avec la chaîne restée en base. Sans
 * elle, le rapport ne serait qu'une liste d'affirmations.
 */
export function buildAuditCsv(
  lignes: readonly LigneAudit[],
  options: CsvOptions & { readonly titreÉpreuve: string },
): string {
  const entêtes = [
    'Séquence',
    'Horodatage (UTC)',
    'Action',
    "Type d'objet",
    'Acteur',
    'Rôle',
    'Motif',
    'Empreinte',
  ]

  const corps = lignes.map((l) => [
    l.sequence,
    formatDateCsv(l.occurredAt),
    ACTIONS_LISIBLES[l.action] ?? l.action,
    l.objectType,
    l.acteur ?? 'système',
    l.rôle ?? '',
    l.motif ?? '',
    l.hash,
  ])

  return toCsv(entêtes, corps, options)
}

export const ACTIONS_LISIBLES: Record<string, string> = {
  'auth.login': 'Connexion',
  'assessment.create': 'Création d’épreuve',
  'assessment.status_change': 'Changement d’état',
  'subject.import': 'Import du sujet',
  'question.update': 'Modification de question',
  'answer_key.create': 'Création du corrigé',
  'answer_key.validate': 'Validation du corrigé',
  'rubric.create': 'Création du barème',
  'rubric.validate': 'Validation du barème',
  'rubric.lock': 'Verrouillage du barème',
  'submission.import': 'Import d’une copie',
  'ocr.run': 'Lecture de la copie',
  'transcription.edit': 'Correction de transcription',
  'grade.propose': 'Proposition de note',
  'grade.review': 'Validation d’une décision',
  'grade.modify': 'Modification d’une note',
  'grade.finalize': 'Finalisation de la note',
  'grade.publish': 'Publication',
  'export.create': 'Export',
  'identity.reveal': 'Levée d’anonymat',
  'permission.change': 'Changement de permission',
  'assignment.change': 'Attribution de copie',
}

/** Nom de fichier proposé, sans caractère problématique. */
export function exportFileName(titreÉpreuve: string, genre: string, date: Date): string {
  const base = titreÉpreuve
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .toLowerCase()

  const jour = formatDateCsv(date).slice(0, 10)
  return `coteris-${genre}-${base || 'epreuve'}-${jour}.csv`
}
