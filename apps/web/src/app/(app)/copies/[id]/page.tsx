import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { can } from '@coteris/auth'

import { getAssessment, getSubmission, getSubmissionReview } from '~/lib/repositories'
import { requireUser } from '~/lib/session'
import { signedFileUrl, storage } from '~/lib/storage'
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

  // Les URL sont signées ici, après la vérification de permission ci-dessus.
  // Le jeton évite de refaire ce contrôle à chaque image chargée ; il ne le
  // remplace pas — la route le vérifie aussi.
  const questionsAvecImage = await Promise.all(
    questions.map(async (q) => {
      if (!q.regionImageKey) return { ...q, imageUrl: null }
      const présente = await storage().exists(q.regionImageKey)
      return {
        ...q,
        imageUrl: présente
          ? signedFileUrl(q.regionImageKey, principal.organizationId)
          : null,
      }
    }),
  )

  return (
    <ÉcranCorrection
      copie={{
        id: copie.id,
        anonymousCode: copie.anonymousCode,
        quality: copie.quality,
        assessmentId: copie.assessmentId,
        assessmentTitle: épreuve.title,
      }}
      questions={questionsAvecImage}
      peutValider={can(principal, 'grading', 'review')}
      peutFinaliser={can(principal, 'grading', 'finalize')}
    />
  )
}
