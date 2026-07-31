/**
 * Vérification de l'intégrité de la chaîne d'audit.
 *
 * Recalcule chaque hash à partir du contenu stocké et le compare à celui
 * enregistré. Détecte trois choses :
 *
 *   - une **modification** de contenu : le hash recalculé diffère ;
 *   - une **suppression** : la séquence saute un numéro, ou le chaînage se brise ;
 *   - une **insertion** : le `previousHash` ne correspond pas au précédent.
 *
 * La vérification s'arrête à la première rupture et indique sa position exacte.
 * Ce qui suit une rupture n'est pas exploitable : tout hash ultérieur dépend du
 * hash rompu.
 */

import { sql } from 'drizzle-orm'

import { computeEventHash, hashesMatch, type HashableEvent } from './hash'

export type ChainBreakKind =
  /** Le contenu de l'événement ne correspond plus à son hash. */
  | 'content_modified'
  /** Le `previousHash` ne pointe pas vers le hash de l'événement précédent. */
  | 'chain_broken'
  /** Un ou plusieurs numéros de séquence manquent. */
  | 'sequence_gap'
  /** Le premier événement de la chaîne prétend avoir un prédécesseur, ou l'inverse. */
  | 'invalid_genesis'

export interface ChainBreak {
  readonly kind: ChainBreakKind
  readonly sequence: number
  readonly eventId: string | null
  readonly detail: string
}

export interface VerificationResult {
  readonly organizationId: string
  readonly eventsChecked: number
  readonly valid: boolean
  readonly breaks: readonly ChainBreak[]
  readonly lastValidSequence: number | null
}

interface StoredEvent {
  id: string
  sequence: number | string
  actor_id: string | null
  actor_role: string | null
  action: string
  object_type: string
  object_id: string | null
  previous_value: unknown
  new_value: unknown
  reason: string | null
  metadata: unknown
  request_id: string | null
  previous_hash: string | null
  hash: string
  occurred_at: Date | string
}

export interface VerifiableDatabase {
  execute(query: unknown): Promise<unknown>
}

const LABELS: Record<ChainBreakKind, string> = {
  content_modified: 'Contenu modifié après enregistrement',
  chain_broken: 'Chaînage rompu',
  sequence_gap: 'Événement manquant',
  invalid_genesis: 'Début de chaîne incohérent',
}

export function describeBreak(brk: ChainBreak): string {
  return `${LABELS[brk.kind]} à la position ${brk.sequence} : ${brk.detail}`
}

/**
 * Vérifie la chaîne d'une organisation.
 *
 * @param fromSequence Reprise partielle. Sur un journal volumineux, revérifier
 *   depuis le début à chaque contrôle serait coûteux ; on peut repartir d'une
 *   position déjà vérifiée et archivée.
 */
export async function verifyChain(
  db: VerifiableDatabase,
  organizationId: string,
  secret: string,
  fromSequence = 1,
): Promise<VerificationResult> {
  const rows = (await db.execute(sql`
    SELECT id, sequence, actor_id, actor_role, action, object_type, object_id,
           previous_value, new_value, reason, metadata, request_id,
           previous_hash, hash, occurred_at
    FROM audit_events
    WHERE organization_id = ${organizationId}::uuid
      AND sequence >= ${fromSequence}
    ORDER BY sequence ASC
  `)) as unknown as StoredEvent[]

  const breaks: ChainBreak[] = []
  let expectedPreviousHash: string | null = null
  let expectedSequence = fromSequence
  let lastValidSequence: number | null = null

  for (const row of rows) {
    const sequence = Number(row.sequence)

    if (sequence !== expectedSequence) {
      breaks.push({
        kind: 'sequence_gap',
        sequence: expectedSequence,
        eventId: null,
        detail:
          `l'événement ${expectedSequence} est absent ; le suivant enregistré porte ` +
          `le numéro ${sequence}. Une suppression a eu lieu.`,
      })
      break
    }

    // Le premier événement d'une chaîne n'a pas de prédécesseur.
    if (sequence === 1 && row.previous_hash !== null) {
      breaks.push({
        kind: 'invalid_genesis',
        sequence,
        eventId: row.id,
        detail: 'le premier événement référence un prédécesseur inexistant.',
      })
      break
    }

    if (expectedPreviousHash !== null && row.previous_hash !== expectedPreviousHash) {
      breaks.push({
        kind: 'chain_broken',
        sequence,
        eventId: row.id,
        detail:
          'le hash du prédécesseur enregistré ne correspond pas à celui de ' +
          "l'événement précédent. Un événement a été inséré ou remplacé.",
      })
      break
    }

    const hashable: HashableEvent = {
      organizationId,
      sequence,
      actorId: row.actor_id,
      actorRole: row.actor_role,
      action: row.action,
      objectType: row.object_type,
      objectId: row.object_id,
      previousValue: row.previous_value,
      newValue: row.new_value,
      reason: row.reason,
      metadata: row.metadata,
      requestId: row.request_id,
      occurredAt: row.occurred_at instanceof Date ? row.occurred_at : new Date(row.occurred_at),
    }

    const recomputed = computeEventHash(hashable, row.previous_hash, secret)

    if (!hashesMatch(recomputed, row.hash)) {
      breaks.push({
        kind: 'content_modified',
        sequence,
        eventId: row.id,
        detail:
          `le hash recalculé ne correspond pas à celui enregistré pour l'action ` +
          `« ${row.action} ». Le contenu a été modifié.`,
      })
      break
    }

    lastValidSequence = sequence
    expectedPreviousHash = row.hash
    expectedSequence = sequence + 1
  }

  return {
    organizationId,
    eventsChecked: rows.length,
    valid: breaks.length === 0,
    breaks,
    lastValidSequence,
  }
}
