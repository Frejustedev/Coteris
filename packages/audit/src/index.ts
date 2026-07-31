/**
 * @coteris/audit — journal en ajout seul et chaîne de hash.
 *
 * Rappel : Coteris n'utilise pas de blockchain et ne le prétendra jamais. Une
 * chaîne de HMAC suffit à détecter une altération, ce qui est le besoin réel.
 */

export { canonicalize, computeEventHash, hashesMatch, type HashableEvent } from './hash'
export {
  appendAuditEvent,
  type AppendAuditEventInput,
  type AppendedAuditEvent,
  type AuditTransaction,
} from './append'
export {
  verifyChain,
  describeBreak,
  type ChainBreak,
  type ChainBreakKind,
  type VerifiableDatabase,
  type VerificationResult,
} from './verify'
