/**
 * Correction manuelle des zones de réponse.
 *
 * L'import place les zones selon une **hypothèse de mise en page** — une zone par
 * question, dans l'ordre. Ce service permet à l'enseignant de la corriger, ce qui
 * transforme une supposition en fait établi.
 *
 * Deux conséquences de cette correction, et elles comptent autant que la
 * correction elle-même :
 *
 * 1. la zone passe en `origin: 'manual'` avec une confiance de 1 — le pipeline
 *    cesse de la traiter comme douteuse ;
 * 2. l'analyse est **remise en file**, puisqu'elle portait sur le mauvais
 *    fragment de copie. Corriger la zone sans relancer l'analyse laisserait une
 *    proposition fondée sur autre chose que ce qui est désormais affiché.
 */

import { and, eq, sql } from 'drizzle-orm'

import { AUDIT_ACTIONS } from '@coteris/database'
import { ForbiddenError, authorize, type Principal } from '@coteris/auth'
import { appendAuditEvent, type AuditTransaction } from '@coteris/audit'
import { TASKS, addJob, type JobTransaction } from '@coteris/jobs'

import { db, schema } from '../db'
import { assertServerOnly } from '../server-guard'

assertServerOnly('services/segmentation')

export interface ZoneCorrigée {
  readonly answerRegionId: string
  /** Coordonnées relatives à la page, entre 0 et 1. */
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface EntréeSegmentation {
  readonly submissionId: string
  readonly zones: readonly ZoneCorrigée[]
  readonly now: Date
  readonly auditSecret: string
  readonly requestId?: string | null | undefined
}

export interface RésultatSegmentation {
  readonly ok: boolean
  readonly message?: string
  readonly problèmes?: readonly string[]
  /** Nombre d'analyses remises en file. */
  readonly relancées?: number
}

const ÉPAISSEUR_MINIMALE = 0.01

/**
 * Enregistre les zones corrigées et relance les analyses concernées.
 *
 * Seules les zones **réellement déplacées** sont relancées : relancer les autres
 * coûterait des appels d'IA sans rien changer au résultat.
 */
export async function corrigerZones(
  principal: Principal,
  userId: string,
  entrée: EntréeSegmentation,
): Promise<RésultatSegmentation> {
  try {
    authorize(principal, 'submission', 'read')
    authorize(principal, 'grading', 'propose')
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, message: 'Votre rôle ne permet pas de corriger la segmentation.' }
    }
    throw error
  }

  if (entrée.zones.length === 0) {
    return { ok: false, message: 'Aucune zone à enregistrer.' }
  }

  const problèmes = contrôlerGéométrie(entrée.zones)
  if (problèmes.length > 0) {
    return { ok: false, message: 'Certaines zones sont invalides.', problèmes }
  }

  // Les zones sont chargées avec leur copie : une zone d'une autre organisation,
  // ou d'une autre copie que celle annoncée, est simplement introuvable.
  const existantes = await db
    .select({
      id: schema.answerRegions.id,
      questionId: schema.answerRegions.questionId,
      x: schema.answerRegions.x,
      y: schema.answerRegions.y,
      width: schema.answerRegions.width,
      height: schema.answerRegions.height,
    })
    .from(schema.answerRegions)
    .where(
      and(
        eq(schema.answerRegions.submissionId, entrée.submissionId),
        eq(schema.answerRegions.organizationId, principal.organizationId),
      ),
    )

  const parId = new Map(existantes.map((z) => [z.id, z]))

  for (const zone of entrée.zones) {
    if (!parId.has(zone.answerRegionId)) {
      return { ok: false, message: 'Une des zones est introuvable sur cette copie.' }
    }
  }

  // Une note finalisée ne se recalcule pas discrètement.
  const [note] = await db
    .select({ finalizedAt: schema.grades.finalizedAt })
    .from(schema.grades)
    .where(
      and(
        eq(schema.grades.submissionId, entrée.submissionId),
        sql`${schema.grades.questionId} IS NULL`,
        sql`${schema.grades.supersededAt} IS NULL`,
      ),
    )
    .limit(1)

  if (note?.finalizedAt) {
    return {
      ok: false,
      message:
        'Cette copie est finalisée. Modifier sa segmentation exigerait une nouvelle version ' +
        'de la note, non encore implémentée.',
    }
  }

  const déplacées = entrée.zones.filter((z) => aBougé(z, parId.get(z.answerRegionId)))

  await db.transaction(async (tx) => {
    for (const zone of entrée.zones) {
      await tx
        .update(schema.answerRegions)
        .set({
          x: zone.x,
          y: zone.y,
          width: zone.width,
          height: zone.height,
          // Ce n'est plus une hypothèse : un humain l'a tracée.
          origin: 'manual',
          confidence: 1,
          updatedAt: entrée.now,
        })
        .where(eq(schema.answerRegions.id, zone.answerRegionId))
    }

    for (const zone of déplacées) {
      const existante = parId.get(zone.answerRegionId)
      await addJob(
        tx as unknown as JobTransaction,
        TASKS.ANALYZE_REGION,
        {
          organizationId: principal.organizationId,
          submissionId: entrée.submissionId,
          answerRegionId: zone.answerRegionId,
          questionId: String(existante?.questionId),
          forceSecondPass: false,
          requestedBy: userId,
        },
        // La clé inclut l'horodatage : contrairement à une simple demande de
        // ré-analyse, on veut bien une nouvelle exécution après chaque
        // déplacement, puisque le fragment analysé a changé.
        { jobKey: `segmentation:${zone.answerRegionId}:${entrée.now.getTime()}` },
      )
    }

    // La copie repasse en qualité acceptable : la réserve portait sur la
    // segmentation, qui vient d'être validée par un humain.
    await tx
      .update(schema.submissions)
      .set({ quality: 'acceptable', qualityIssues: [], updatedAt: entrée.now })
      .where(eq(schema.submissions.id, entrée.submissionId))

    await appendAuditEvent(
      tx as unknown as AuditTransaction,
      {
        organizationId: principal.organizationId,
        actorId: userId,
        actorRole: principal.roles[0] ?? null,
        action: AUDIT_ACTIONS.ASSIGNMENT_CHANGE,
        objectType: 'submission',
        objectId: entrée.submissionId,
        previousValue: {
          zones: [...parId.values()].map((z) => ({
            id: z.id,
            x: z.x,
            y: z.y,
            w: z.width,
            h: z.height,
          })),
        },
        newValue: {
          zones: entrée.zones.map((z) => ({
            id: z.answerRegionId,
            x: z.x,
            y: z.y,
            w: z.width,
            h: z.height,
          })),
          déplacées: déplacées.length,
        },
        reason: 'Segmentation corrigée manuellement',
        requestId: entrée.requestId ?? null,
        occurredAt: entrée.now,
      },
      entrée.auditSecret,
    )
  })

  return {
    ok: true,
    relancées: déplacées.length,
    message:
      déplacées.length === 0
        ? 'Segmentation confirmée. Aucune zone n’a bougé, aucune analyse relancée.'
        : `Segmentation enregistrée. ${déplacées.length} analyse(s) relancée(s), ` +
          `car le fragment analysé a changé.`,
  }
}

/** Contrôles géométriques. Tous les problèmes sont rendus d'un coup. */
function contrôlerGéométrie(zones: readonly ZoneCorrigée[]): string[] {
  const problèmes: string[] = []

  for (const [index, z] of zones.entries()) {
    const nom = `zone ${index + 1}`

    for (const [clé, valeur] of Object.entries({ x: z.x, y: z.y, largeur: z.width, hauteur: z.height })) {
      if (!Number.isFinite(valeur)) {
        problèmes.push(`${nom} : ${clé} n'est pas un nombre.`)
      }
    }

    if (z.width < ÉPAISSEUR_MINIMALE || z.height < ÉPAISSEUR_MINIMALE) {
      problèmes.push(
        `${nom} : trop petite pour contenir une réponse. Une zone réduite à un trait ` +
          `donnerait une transcription vide.`,
      )
    }

    if (z.x < 0 || z.y < 0 || z.x + z.width > 1.0001 || z.y + z.height > 1.0001) {
      problèmes.push(`${nom} : déborde de la page.`)
    }
  }

  return problèmes
}

/** Un déplacement négligeable ne justifie pas de relancer une analyse payante. */
function aBougé(
  zone: ZoneCorrigée,
  existante: { x: number; y: number; width: number; height: number } | undefined,
): boolean {
  if (!existante) return true
  const seuil = 0.002
  return (
    Math.abs(zone.x - existante.x) > seuil ||
    Math.abs(zone.y - existante.y) > seuil ||
    Math.abs(zone.width - existante.width) > seuil ||
    Math.abs(zone.height - existante.height) > seuil
  )
}
