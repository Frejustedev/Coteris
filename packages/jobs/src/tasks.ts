/**
 * Catalogue des travaux asynchrones.
 *
 * Chaque tâche déclare son nom **et le schéma de sa charge utile**. Un job est
 * une donnée qui survit à un redéploiement : il peut être écrit par une version
 * de l'application et exécuté par la suivante. Valider la charge à la lecture
 * n'est donc pas de la paranoïa, c'est la seule façon de ne pas planter sur un
 * champ renommé entre-temps.
 */

import { z } from 'zod'

export const TASKS = {
  /** Contrôle qualité d'une copie fraîchement importée. */
  QUALITY_CHECK: 'controle-qualite',
  /** Lecture d'une zone de réponse et analyse selon le barème verrouillé. */
  ANALYZE_REGION: 'analyser-reponse',
  /** Seconde vérification, sélective. */
  SECOND_PASS: 'seconde-verification',
  /** Recorrection après création d'une nouvelle version de barème. */
  REGRADE: 'recorriger',
  /** Génération d'un export. */
  EXPORT: 'exporter',
} as const

export type TaskName = (typeof TASKS)[keyof typeof TASKS]

const uuid = z.string().uuid()

export const analyzeRegionPayload = z.object({
  organizationId: uuid,
  submissionId: uuid,
  answerRegionId: uuid,
  questionId: uuid,
  /**
   * Force une seconde vérification même sur un cas vert.
   *
   * C'est par ici que passe l'échantillonnage aléatoire de contrôle qualité : le
   * tirage a lieu à la mise en file, pour que le pipeline reste déterministe.
   */
  forceSecondPass: z.boolean().default(false),
  /** Auteur de la demande. Nul si le traitement est déclenché par le système. */
  requestedBy: uuid.nullable().default(null),
})

export const qualityCheckPayload = z.object({
  organizationId: uuid,
  submissionId: uuid,
})

export const exportPayload = z.object({
  organizationId: uuid,
  exportId: uuid,
  assessmentId: uuid,
})

export const regradePayload = z.object({
  organizationId: uuid,
  assessmentId: uuid,
  rubricVersionId: uuid,
  reason: z.string().min(1).max(500),
})

export type AnalyzeRegionPayload = z.infer<typeof analyzeRegionPayload>
export type QualityCheckPayload = z.infer<typeof qualityCheckPayload>
export type ExportPayload = z.infer<typeof exportPayload>
export type RegradePayload = z.infer<typeof regradePayload>

/** Schémas indexés par nom de tâche, pour la validation à l'exécution. */
export const PAYLOAD_SCHEMAS = {
  [TASKS.ANALYZE_REGION]: analyzeRegionPayload,
  [TASKS.QUALITY_CHECK]: qualityCheckPayload,
  [TASKS.SECOND_PASS]: analyzeRegionPayload,
  [TASKS.REGRADE]: regradePayload,
  [TASKS.EXPORT]: exportPayload,
} as const

/**
 * Politique de reprise.
 *
 * Un appel d'IA échoue parfois pour une raison passagère — limite de débit,
 * coupure réseau. Il échoue aussi parfois définitivement : quota dépassé, barème
 * non verrouillé. Réessayer douze fois un job voué à échouer coûte cher et
 * masque le vrai problème, d'où un nombre de tentatives volontairement modeste.
 */
export const RETRY_POLICY: Record<TaskName, { maxAttempts: number }> = {
  [TASKS.ANALYZE_REGION]: { maxAttempts: 3 },
  [TASKS.SECOND_PASS]: { maxAttempts: 3 },
  [TASKS.QUALITY_CHECK]: { maxAttempts: 3 },
  [TASKS.REGRADE]: { maxAttempts: 2 },
  [TASKS.EXPORT]: { maxAttempts: 2 },
}
