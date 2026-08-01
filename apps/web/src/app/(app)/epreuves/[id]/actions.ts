'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { z } from 'zod'

import {
  ajouterQuestion,
  verrouillerBarème,
  type Résultat as RésultatPréparation,
} from '~/lib/services/assessment'
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

const schémaQuestion = z.object({
  assessmentId: z.string().uuid(),
  number: z.string().min(1).max(16),
  prompt: z.string().min(3).max(4000),
  type: z.enum(['mcq', 'true_false', 'short_answer', 'short_essay', 'clinical_case']),
  /** Points décimaux, convertis en millièmes à cette frontière (ADR 0006). */
  maxPoints: z.number().min(0.001).max(100),
  answerKey: z.string().max(4000),
  critères: z
    .array(
      z.object({
        label: z.string().min(1).max(200),
        maxPoints: z.number().min(0.001).max(100),
        acceptableAnswers: z.array(z.string().min(1).max(200)).default([]),
      }),
    )
    .min(1),
})

export async function ajouter(entrée: unknown): Promise<RésultatPréparation> {
  const analyse = schémaQuestion.safeParse(entrée)
  if (!analyse.success) {
    return {
      ok: false,
      message: 'Requête invalide.',
      problèmes: analyse.error.issues.map((i) => `${i.path.join('.')} : ${i.message}`),
    }
  }

  const { userId, principal } = await requireUser()
  const requestId = (await headers()).get('x-request-id')

  const résultat = await ajouterQuestion(principal, userId, {
    ...analyse.data,
    maxPoints: Math.round(analyse.data.maxPoints * 1000),
    critères: analyse.data.critères.map((c) => ({
      ...c,
      maxPoints: Math.round(c.maxPoints * 1000),
    })),
    requestId,
    now: new Date(),
    auditSecret: auditSecret(),
  })

  if (résultat.ok) revalidatePath(`/epreuves/${analyse.data.assessmentId}`)
  return résultat
}

export async function verrouiller(entrée: unknown): Promise<RésultatPréparation> {
  const analyse = z.object({ assessmentId: z.string().uuid() }).safeParse(entrée)
  if (!analyse.success) return { ok: false, message: 'Requête invalide.' }

  const { userId, principal } = await requireUser()
  const requestId = (await headers()).get('x-request-id')

  const résultat = await verrouillerBarème(principal, userId, {
    assessmentId: analyse.data.assessmentId,
    requestId,
    now: new Date(),
    auditSecret: auditSecret(),
  })

  if (résultat.ok) revalidatePath(`/epreuves/${analyse.data.assessmentId}`)
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
