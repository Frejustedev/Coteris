'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { z } from 'zod'

import { créerExport, type RésultatExport } from '~/lib/services/exports'
import { requireUser } from '~/lib/session'

const schéma = z.object({
  assessmentId: z.string().uuid(),
  genre: z.enum(['resultats', 'audit']),
})

function auditSecret(): string {
  const secret = process.env['AUDIT_HASH_SECRET']
  if (!secret || secret.length < 32) {
    throw new Error('AUDIT_HASH_SECRET est absent ou trop court.')
  }
  return secret
}

export async function lancerExport(entrée: unknown): Promise<RésultatExport> {
  const analyse = schéma.safeParse(entrée)
  if (!analyse.success) return { ok: false, message: 'Requête invalide.' }

  const { userId, principal } = await requireUser()
  const requestId = (await headers()).get('x-request-id')

  const résultat = await créerExport(principal, userId, {
    ...analyse.data,
    requestId,
    now: new Date(),
    auditSecret: auditSecret(),
  })

  if (résultat.ok) revalidatePath(`/epreuves/${analyse.data.assessmentId}`)
  return résultat
}
