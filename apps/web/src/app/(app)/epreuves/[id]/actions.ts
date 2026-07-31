'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { z } from 'zod'

import { créerExport, type RésultatExport } from '~/lib/services/exports'
import { importerCopie, type RésultatImport } from '~/lib/services/import'
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

/**
 * Import d'une copie.
 *
 * Reçoit un `FormData` : les octets ne transitent pas par une sérialisation JSON.
 */
export async function importer(formulaire: FormData): Promise<RésultatImport> {
  const assessmentId = String(formulaire.get('assessmentId') ?? '')
  const fichier = formulaire.get('fichier')

  if (!z.string().uuid().safeParse(assessmentId).success) {
    return { ok: false, message: 'Requête invalide.' }
  }
  if (!(fichier instanceof File) || fichier.size === 0) {
    return { ok: false, message: 'Aucun fichier reçu.' }
  }

  const { userId, principal } = await requireUser()
  const requestId = (await headers()).get('x-request-id')

  const résultat = await importerCopie(principal, userId, {
    assessmentId,
    fileName: fichier.name,
    bytes: new Uint8Array(await fichier.arrayBuffer()),
    requestId,
    now: new Date(),
    auditSecret: auditSecret(),
  })

  if (résultat.ok) revalidatePath(`/epreuves/${assessmentId}`)
  return résultat
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
