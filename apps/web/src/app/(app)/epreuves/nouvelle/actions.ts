'use server'

import { headers } from 'next/headers'
import { z } from 'zod'

import { créerÉpreuve, type Résultat } from '~/lib/services/assessment'
import { requireUser } from '~/lib/session'

/**
 * Les points sont saisis en points décimaux par l'enseignant, et convertis en
 * millièmes ici — à la frontière. Au-delà, tout est entier (ADR 0006).
 */
const schéma = z.object({
  title: z.string().min(3).max(200),
  subject: z.string().max(120).nullable(),
  level: z.string().max(120).nullable(),
  cohort: z.string().max(120).nullable(),
  language: z.string().min(2).max(8).default('fr'),
  maxPoints: z.number().min(0.001).max(1000),
  durationMinutes: z.number().int().min(1).max(1440).nullable(),
  anonymizationEnabled: z.boolean(),
  description: z.string().max(2000).nullable(),
})

function auditSecret(): string {
  const secret = process.env['AUDIT_HASH_SECRET']
  if (!secret || secret.length < 32) throw new Error('AUDIT_HASH_SECRET est absent ou trop court.')
  return secret
}

export async function créer(entrée: unknown): Promise<Résultat> {
  const analyse = schéma.safeParse(entrée)
  if (!analyse.success) {
    return {
      ok: false,
      message: 'Requête invalide.',
      problèmes: analyse.error.issues.map((i) => `${i.path.join('.')} : ${i.message}`),
    }
  }

  const { userId, principal } = await requireUser()
  const requestId = (await headers()).get('x-request-id')

  return créerÉpreuve(principal, userId, {
    ...analyse.data,
    maxPoints: Math.round(analyse.data.maxPoints * 1000),
    requestId,
    now: new Date(),
    auditSecret: auditSecret(),
  })
}
