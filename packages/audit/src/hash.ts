/**
 * Chaîne de hash du journal d'audit.
 *
 * Ce n'est **pas** une blockchain, et Coteris ne le prétendra jamais. C'est une
 * chaîne de HMAC-SHA256 : chaque événement inclut le hash du précédent. Modifier
 * ou supprimer une ligne rompt la chaîne, et la vérification indique exactement à
 * quelle position.
 *
 * Ce que cela garantit : détecter une altération a posteriori.
 * Ce que cela ne garantit pas : empêcher quelqu'un qui possède
 * `AUDIT_HASH_SECRET` **et** les droits d'écriture de reforger toute la chaîne.
 * D'où deux protections complémentaires :
 *   - la table est en ajout seul au niveau de la base (déclencheurs SQL) ;
 *   - le secret d'audit est distinct du secret de session, ce qu'une contrainte
 *     de configuration impose en production.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

/** Champs d'un événement entrant dans le calcul du hash. */
export interface HashableEvent {
  readonly organizationId: string
  readonly sequence: number
  readonly actorId: string | null
  readonly actorRole: string | null
  readonly action: string
  readonly objectType: string
  readonly objectId: string | null
  readonly previousValue: unknown
  readonly newValue: unknown
  readonly reason: string | null
  readonly metadata: unknown
  readonly requestId: string | null
  readonly occurredAt: Date
}

/**
 * Sérialisation canonique.
 *
 * Le hash doit être reproductible des années plus tard, sur une autre machine,
 * après relecture depuis la base. Deux pièges à éviter :
 *
 * - **L'ordre des clés d'un objet JSON n'est pas garanti.** `JSON.stringify` suit
 *   l'ordre d'insertion, qui diffère entre un objet construit en mémoire et le
 *   même objet relu depuis une colonne `jsonb`. On trie donc les clés,
 *   récursivement.
 * - **Les dates.** On sérialise en ISO 8601 UTC, jamais en horodatage local.
 */
export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return 'null'

  if (value instanceof Date) return JSON.stringify(value.toISOString())

  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, v]) => `${JSON.stringify(key)}:${canonicalize(v)}`)
    return `{${entries.join(',')}}`
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(
        `Valeur numérique non finie dans un événement d'audit : ${value}. ` +
          `Elle rendrait le hash irreproductible.`,
      )
    }
    return JSON.stringify(value)
  }

  return JSON.stringify(value)
}

/**
 * Calcule le hash d'un événement, chaîné au précédent.
 *
 * `previousHash` vaut `null` pour le premier événement d'une organisation.
 */
export function computeEventHash(
  event: HashableEvent,
  previousHash: string | null,
  secret: string,
): string {
  if (secret.length < 32) {
    throw new Error("AUDIT_HASH_SECRET doit faire au moins 32 caractères.")
  }

  const payload = canonicalize({
    organizationId: event.organizationId,
    sequence: event.sequence,
    actorId: event.actorId,
    actorRole: event.actorRole,
    action: event.action,
    objectType: event.objectType,
    objectId: event.objectId,
    previousValue: event.previousValue ?? null,
    newValue: event.newValue ?? null,
    reason: event.reason,
    metadata: event.metadata ?? {},
    requestId: event.requestId,
    occurredAt: event.occurredAt,
    previousHash,
  })

  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex')
}

/** Comparaison à temps constant, pour ne pas fuiter d'information par la durée. */
export function hashesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
}
