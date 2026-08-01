import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, asc, eq } from 'drizzle-orm'

import { can } from '@coteris/auth'

import { Vide } from '~/components/ui'
import { db, schema } from '~/lib/db'
import { getSubmission } from '~/lib/repositories'
import { requireUser } from '~/lib/session'
import { signedFileUrl, storage } from '~/lib/storage'
import { ÉditeurZones } from './editeur'

export const metadata: Metadata = { title: 'Zones de réponse' }

export default async function ZonesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { principal } = await requireUser()

  const copie = await getSubmission(principal.organizationId, id)
  if (!copie) notFound()

  if (!can(principal, 'submissionContent', 'read')) notFound()

  const zones = await db
    .select({
      id: schema.answerRegions.id,
      questionId: schema.answerRegions.questionId,
      x: schema.answerRegions.x,
      y: schema.answerRegions.y,
      width: schema.answerRegions.width,
      height: schema.answerRegions.height,
      origin: schema.answerRegions.origin,
      sortOrder: schema.answerRegions.sortOrder,
      number: schema.questions.number,
      prompt: schema.questions.prompt,
    })
    .from(schema.answerRegions)
    .innerJoin(schema.questions, eq(schema.questions.id, schema.answerRegions.questionId))
    .where(
      and(
        eq(schema.answerRegions.submissionId, id),
        eq(schema.answerRegions.organizationId, principal.organizationId),
      ),
    )
    .orderBy(asc(schema.answerRegions.sortOrder))

  if (zones.length === 0) {
    return <Vide>Cette copie ne comporte aucune zone de réponse.</Vide>
  }

  const [page] = await db
    .select({ imageKey: schema.submissionPages.imageKey })
    .from(schema.submissionPages)
    .where(eq(schema.submissionPages.submissionId, id))
    .orderBy(asc(schema.submissionPages.pageNumber))
    .limit(1)

  // L'URL n'est signée qu'après la vérification de permission ci-dessus.
  const imageUrl =
    page?.imageKey && (await storage().exists(page.imageKey))
      ? signedFileUrl(page.imageKey, principal.organizationId)
      : null

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/copies/${id}`} className="text-sm text-anthracite-400 hover:text-marine-600">
          ← Retour à la correction
        </Link>
        <h1 className="tabulaire mt-2 font-titre text-xl font-semibold text-marine-700">
          {copie.anonymousCode} — zones de réponse
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-anthracite-600">
          À l’import, les zones sont placées selon une hypothèse de mise en page — une zone
          par question, dans l’ordre. Corrigez-les ici : chaque zone déplacée verra son
          analyse relancée, puisque le fragment analysé aura changé.
        </p>
      </div>

      <ÉditeurZones
        submissionId={id}
        imageUrl={imageUrl}
        zones={zones.map((z) => ({
          id: z.id,
          number: z.number,
          prompt: z.prompt,
          x: z.x,
          y: z.y,
          width: z.width,
          height: z.height,
          origin: z.origin,
        }))}
        peutCorriger={can(principal, 'grading', 'propose')}
      />
    </div>
  )
}
