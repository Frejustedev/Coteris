import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { can } from '@coteris/auth'

import { getAssessment, getSubmission, getSubmissionReview } from '~/lib/repositories'
import { requireUser } from '~/lib/session'
import { ÉcranCorrection } from './ecran'

export const metadata: Metadata = { title: 'Correction' }

export default async function CopiePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { principal } = await requireUser()

  const copie = await getSubmission(principal.organizationId, id)
  if (!copie) notFound()

  // Vérification côté serveur, indépendamment de ce que l'interface affiche.
  if (!can(principal, 'submissionContent', 'read')) {
    // Un administrateur technique n'a pas accès au contenu des copies.
    notFound()
  }

  const [épreuve, questions] = await Promise.all([
    getAssessment(principal.organizationId, copie.assessmentId),
    getSubmissionReview(principal.organizationId, id),
  ])

  if (!épreuve) notFound()

  return (
    <ÉcranCorrection
      copie={{
        id: copie.id,
        anonymousCode: copie.anonymousCode,
        quality: copie.quality,
        assessmentId: copie.assessmentId,
        assessmentTitle: épreuve.title,
      }}
      questions={questions}
      peutValider={can(principal, 'grading', 'review')}
      peutFinaliser={can(principal, 'grading', 'finalize')}
    />
  )
}
