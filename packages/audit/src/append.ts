/**
 * Écriture d'un événement d'audit.
 *
 * Une seule fonction, et elle **exige une transaction**. C'est délibéré : il
 * n'existe pas de variante qui s'en passe. L'événement d'audit et l'action qu'il
 * décrit sont validés ensemble ou pas du tout. Un journal qui conserverait la
 * trace d'une action annulée — ou qui perdrait celle d'une action effectuée —
 * serait pire qu'aucun journal, puisqu'on lui ferait confiance.
 */

import { sql } from 'drizzle-orm'
import { auditEvents, type AuditAction } from '@coteris/database'

import { computeEventHash, type HashableEvent } from './hash'

/**
 * Transaction Drizzle. Typé structurellement pour ne pas dépendre de la forme
 * exacte du client, qui varie selon le pilote.
 */
export interface AuditTransaction {
  execute(query: unknown): Promise<unknown>
  insert(table: typeof auditEvents): {
    values(row: Record<string, unknown>): { returning(): Promise<Record<string, unknown>[]> }
  }
}

export interface AppendAuditEventInput {
  readonly organizationId: string
  readonly action: AuditAction | string
  readonly objectType: string
  readonly objectId?: string | null
  readonly actorId?: string | null
  readonly actorRole?: 'coordinator' | 'grader' | 'tech_admin' | null
  readonly previousValue?: unknown
  readonly newValue?: unknown
  readonly reason?: string | null
  readonly metadata?: Record<string, unknown>
  readonly requestId?: string | null
  readonly ipAddress?: string | null
  /** Injectée par l'appelant, pour que la fonction reste testable. */
  readonly occurredAt: Date
}

export interface AppendedAuditEvent {
  readonly id: string
  readonly sequence: number
  readonly hash: string
}

/**
 * Ajoute un événement à la chaîne de l'organisation.
 *
 * Le verrou consultatif est pris **par organisation**, pas globalement. Une
 * chaîne unique pour toute la plateforme sérialiserait les écritures de tous les
 * établissements derrière un seul verrou ; par organisation, deux facultés
 * corrigent en parallèle sans se gêner.
 *
 * Le verrou est de portée transactionnelle : il est relâché automatiquement au
 * COMMIT ou au ROLLBACK, y compris si le processus meurt.
 */
export async function appendAuditEvent(
  tx: AuditTransaction,
  input: AppendAuditEventInput,
  secret: string,
): Promise<AppendedAuditEvent> {
  // Sérialise les écritures concurrentes sur la chaîne de cette organisation.
  // Sans lui, deux transactions simultanées liraient la même « dernière séquence »
  // et produiraient deux événements chaînés au même prédécesseur — la chaîne
  // deviendrait un arbre, et la vérification échouerait.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.organizationId}))`)

  const rows = (await tx.execute(sql`
    SELECT sequence, hash
    FROM audit_events
    WHERE organization_id = ${input.organizationId}::uuid
    ORDER BY sequence DESC
    LIMIT 1
  `)) as unknown as { sequence: number | string; hash: string }[]

  const last = rows[0]
  const sequence = last ? Number(last.sequence) + 1 : 1
  const previousHash = last ? last.hash : null

  const hashable: HashableEvent = {
    organizationId: input.organizationId,
    sequence,
    actorId: input.actorId ?? null,
    actorRole: input.actorRole ?? null,
    action: input.action,
    objectType: input.objectType,
    objectId: input.objectId ?? null,
    previousValue: input.previousValue ?? null,
    newValue: input.newValue ?? null,
    reason: input.reason ?? null,
    metadata: input.metadata ?? {},
    requestId: input.requestId ?? null,
    occurredAt: input.occurredAt,
  }

  const hash = computeEventHash(hashable, previousHash, secret)

  const inserted = await tx
    .insert(auditEvents)
    .values({
      organizationId: input.organizationId,
      sequence,
      actorId: input.actorId ?? null,
      actorRole: input.actorRole ?? null,
      action: input.action,
      objectType: input.objectType,
      objectId: input.objectId ?? null,
      previousValue: input.previousValue ?? null,
      newValue: input.newValue ?? null,
      reason: input.reason ?? null,
      metadata: input.metadata ?? {},
      requestId: input.requestId ?? null,
      ipAddress: input.ipAddress ?? null,
      previousHash,
      hash,
      occurredAt: input.occurredAt,
    })
    .returning()

  const row = inserted[0]
  if (!row) {
    throw new Error("L'insertion de l'événement d'audit n'a rien retourné.")
  }

  return { id: String(row['id']), sequence, hash }
}
