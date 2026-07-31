/**
 * Identifiants typés.
 *
 * Tous les identifiants sont des UUID en base. Les marquer nominalement empêche
 * la faute la plus banale et la plus coûteuse de ce produit : passer un
 * identifiant de copie là où un identifiant de question est attendu. Les deux
 * sont des chaînes ; seul le typage les distingue.
 */

declare const brand: unique symbol

type Id<Name extends string> = string & { readonly [brand]: Name }

export type OrganizationId = Id<'Organization'>
export type UserId = Id<'User'>
export type MemberId = Id<'Member'>
export type AssessmentId = Id<'Assessment'>
export type AssessmentVersionId = Id<'AssessmentVersion'>
export type QuestionId = Id<'Question'>
export type AnswerKeyId = Id<'AnswerKey'>
export type AnswerKeyVersionId = Id<'AnswerKeyVersion'>
export type RubricId = Id<'Rubric'>
export type RubricVersionId = Id<'RubricVersion'>
export type RubricCriterionId = Id<'RubricCriterion'>
export type StudentId = Id<'Student'>
export type SubmissionId = Id<'Submission'>
export type SubmissionPageId = Id<'SubmissionPage'>
export type AnswerRegionId = Id<'AnswerRegion'>
export type OcrRunId = Id<'OcrRun'>
export type OcrSpanId = Id<'OcrSpan'>
export type TranscriptionVersionId = Id<'TranscriptionVersion'>
export type GradingRunId = Id<'GradingRun'>
export type GradingDecisionId = Id<'GradingDecision'>
export type HumanReviewId = Id<'HumanReview'>
export type GradeId = Id<'Grade'>
export type AiRunId = Id<'AiRun'>
export type AuditEventId = Id<'AuditEvent'>
export type ExportId = Id<'Export'>

/**
 * Marque une chaîne comme identifiant d'un type donné.
 *
 * À n'utiliser qu'aux frontières du système : lecture depuis la base, analyse
 * d'un paramètre d'URL, désérialisation. Jamais au milieu du métier.
 */
export function asId<T extends string>(value: string): Id<T> {
  return value as Id<T>
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value)
}

/**
 * Valide qu'une chaîne issue de l'extérieur est bien un UUID avant de la traiter
 * comme un identifiant. À utiliser sur tout paramètre d'URL.
 */
export function parseId<T extends string>(value: string, label: string): Id<T> {
  if (!isUuid(value)) {
    throw new TypeError(`Identifiant ${label} invalide.`)
  }
  return value as Id<T>
}
