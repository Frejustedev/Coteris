/**
 * @coteris/pipeline — orchestration de la correction d'une réponse.
 *
 * Relie le fournisseur d'IA (qui identifie des états), la validation des preuves
 * et le moteur déterministe (qui calcule les points). Sans base de données ni
 * réseau : les entrées sont des paramètres, la sortie une structure de données.
 */

export {
  analysisRequestFor,
  gradeAnswer,
  RubricNotLockedError,
  type GradeAnswerInput,
  type GradeAnswerOutcome,
  type PipelineStep,
} from './grade-answer'
