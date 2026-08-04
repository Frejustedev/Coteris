'use server'

/**
 * Actions de validation humaine — enveloppe fine.
 *
 * La logique vit dans `~/lib/services/review` : une action serveur ne s'appelle
 * qu'à travers le protocole de Next.js, donc ne se teste pas directement. Ici on
 * ne fait que valider l'entrée, récupérer la session, et déléguer.
 */

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { z } from 'zod'

import { créerCorrigéAnnoté } from '~/lib/services/corrige-annote'
import {
  appliquerDécision,
  demanderRéanalyse,
  validerQuestionEnLot,
  type RésultatRevue,
} from '~/lib/services/review'
import { requireUser } from '~/lib/session'

const schémaValidation = z.object({
  decisionId: z.string().uuid(),
  points: z.number().int().min(0),
  reason: z.string().max(500).optional(),
  comment: z.string().max(2000).optional(),
})

const schémaGroupée = z.object({
  submissionId: z.string().uuid(),
  questionId: z.string().uuid(),
})

function auditSecret(): string {
  const secret = process.env['AUDIT_HASH_SECRET']
  if (!secret || secret.length < 32) {
    throw new Error('AUDIT_HASH_SECRET est absent ou trop court.')
  }
  return secret
}

export async function validerDécision(entrée: unknown): Promise<RésultatRevue> {
  const analyse = schémaValidation.safeParse(entrée)
  if (!analyse.success) return { ok: false, message: 'Requête invalide.' }

  const { userId, principal } = await requireUser()
  const requestId = (await headers()).get('x-request-id')

  const résultat = await appliquerDécision(principal, userId, {
    ...analyse.data,
    requestId,
    now: new Date(),
    auditSecret: auditSecret(),
  })

  if (résultat.ok) revalidatePath('/copies')
  return résultat
}

/**
 * Demande une nouvelle analyse d'une réponse.
 *
 * Typiquement après correction d'une transcription. Le traitement est
 * asynchrone : le résultat apparaît quand le worker l'a produit.
 */
export async function relancerAnalyse(entrée: unknown): Promise<RésultatRevue> {
  const analyse = schémaGroupée.safeParse(entrée)
  if (!analyse.success) return { ok: false, message: 'Requête invalide.' }

  const { userId, principal } = await requireUser()
  const requestId = (await headers()).get('x-request-id')

  const résultat = await demanderRéanalyse(principal, userId, {
    ...analyse.data,
    requestId,
    now: new Date(),
    auditSecret: auditSecret(),
  })

  if (résultat.ok) revalidatePath('/copies')
  return résultat
}

/**
 * Produit le corrigé annoté remis à l'étudiant.
 *
 * Le service refuse si la copie n'est pas entièrement validée, et dit pourquoi.
 * Ce refus est la fonctionnalité : un corrigé partiel présenté comme définitif
 * partirait chez l'étudiant.
 */
export async function demanderCorrigéAnnoté(entrée: unknown): Promise<RésultatRevue> {
  const analyse = z.object({ submissionId: z.string().uuid() }).safeParse(entrée)
  if (!analyse.success) return { ok: false, message: 'Requête invalide.' }

  const { userId, principal } = await requireUser()
  const requestId = (await headers()).get('x-request-id')

  const résultat = await créerCorrigéAnnoté(principal, userId, {
    submissionId: analyse.data.submissionId,
    requestId,
    now: new Date(),
    auditSecret: auditSecret(),
  })

  if (!résultat.ok) return { ok: false, message: résultat.message ?? 'Production impossible.' }

  revalidatePath('/copies')
  return {
    ok: true,
    message:
      `Corrigé annoté produit${
        résultat.substitutions ? `, ${résultat.substitutions} caractère(s) substitué(s)` : ''
      }. Téléchargement : /api/exports/${résultat.exportId ?? ''}`,
  }
}

export async function validerQuestion(entrée: unknown): Promise<RésultatRevue> {
  const analyse = schémaGroupée.safeParse(entrée)
  if (!analyse.success) return { ok: false, message: 'Requête invalide.' }

  const { userId, principal } = await requireUser()
  const requestId = (await headers()).get('x-request-id')

  const résultat = await validerQuestionEnLot(principal, userId, {
    ...analyse.data,
    requestId,
    now: new Date(),
    auditSecret: auditSecret(),
  })

  if (résultat.ok) revalidatePath('/copies')
  return résultat
}
