'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { z } from 'zod'

import { corrigerZones, type RésultatSegmentation } from '~/lib/services/segmentation'
import { requireUser } from '~/lib/session'

const schéma = z.object({
  submissionId: z.string().uuid(),
  zones: z
    .array(
      z.object({
        answerRegionId: z.string().uuid(),
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        width: z.number().min(0).max(1),
        height: z.number().min(0).max(1),
      }),
    )
    .min(1),
})

function auditSecret(): string {
  const secret = process.env['AUDIT_HASH_SECRET']
  if (!secret || secret.length < 32) throw new Error('AUDIT_HASH_SECRET est absent ou trop court.')
  return secret
}

export async function enregistrerZones(entrée: unknown): Promise<RésultatSegmentation> {
  const analyse = schéma.safeParse(entrée)
  if (!analyse.success) return { ok: false, message: 'Requête invalide.' }

  const { userId, principal } = await requireUser()
  const requestId = (await headers()).get('x-request-id')

  const résultat = await corrigerZones(principal, userId, {
    ...analyse.data,
    requestId,
    now: new Date(),
    auditSecret: auditSecret(),
  })

  if (résultat.ok) {
    revalidatePath(`/copies/${analyse.data.submissionId}`)
    revalidatePath(`/copies/${analyse.data.submissionId}/zones`)
  }
  return résultat
}
