/**
 * Création des exports.
 *
 * Un export est un **document daté** : il fige un état des notes à un instant
 * précis. Il est donc stocké, pas régénéré à la volée — deux téléchargements du
 * même export doivent donner le même fichier, sans quoi deux membres du jury
 * pourraient travailler sur des chiffres différents.
 */

import { sql } from 'drizzle-orm'

import { AUDIT_ACTIONS } from '@coteris/database'
import { ForbiddenError, authorize, type Principal } from '@coteris/auth'
import { appendAuditEvent, type AuditTransaction } from '@coteris/audit'
import {
  buildAuditCsv,
  buildResultsCsv,
  exportFileName,
  type LigneAudit,
  type LigneRésultat,
  type QuestionColonne,
} from '@coteris/exports'
import { storageKey } from '@coteris/storage'

import { db, schema } from '../db'
import { assertServerOnly } from '../server-guard'
import { storage } from '../storage'

assertServerOnly('services/exports')

export type GenreExport = 'resultats' | 'audit'

export interface EntréeExport {
  readonly assessmentId: string
  readonly genre: GenreExport
  readonly now: Date
  readonly auditSecret: string
  readonly requestId?: string | null | undefined
}

export interface RésultatExport {
  readonly ok: boolean
  readonly exportId?: string
  readonly fileName?: string
  readonly message?: string
}

export async function créerExport(
  principal: Principal,
  userId: string,
  entrée: EntréeExport,
): Promise<RésultatExport> {
  try {
    authorize(principal, 'export', 'create')
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, message: 'Votre rôle ne permet pas de créer un export.' }
    }
    throw error
  }

  // L'export d'audit expose des noms d'acteurs et des motifs : il exige la
  // permission de lire le journal, en plus de celle d'exporter.
  if (entrée.genre === 'audit') {
    try {
      authorize(principal, 'audit', 'read')
    } catch (error) {
      if (error instanceof ForbiddenError) {
        return { ok: false, message: 'Votre rôle ne permet pas d’exporter le journal d’audit.' }
      }
      throw error
    }
  }

  const [épreuve] = (await db.execute(sql`
    SELECT id, title, anonymization_enabled
    FROM assessments
    WHERE id = ${entrée.assessmentId}::uuid
      AND organization_id = ${principal.organizationId}::uuid
      AND deleted_at IS NULL
  `)) as unknown as Record<string, unknown>[]

  if (!épreuve) return { ok: false, message: 'Épreuve introuvable.' }

  const titre = String(épreuve['title'])
  const contenu =
    entrée.genre === 'resultats'
      ? await construireRésultats(principal.organizationId, entrée.assessmentId, titre, Boolean(épreuve['anonymization_enabled']))
      : await construireAudit(principal.organizationId, titre)

  const fileName = exportFileName(titre, entrée.genre, entrée.now)
  const key = storageKey(principal.organizationId, [
    'exports',
    `${entrée.assessmentId}-${entrée.genre}-${entrée.now.getTime()}.csv`,
  ])

  await storage().put(key, new TextEncoder().encode(contenu), {
    contentType: 'text/csv; charset=utf-8',
  })

  let exportId = ''

  await db.transaction(async (tx) => {
    const [ligne] = await tx
      .insert(schema.exportJobs)
      .values({
        organizationId: principal.organizationId,
        assessmentId: entrée.assessmentId,
        kind: entrée.genre === 'resultats' ? 'csv' : 'audit_report',
        status: 'ready',
        fileKey: key,
        fileName,
        parameters: { genre: entrée.genre },
        requestedBy: userId,
        completedAt: entrée.now,
        // Un export contient des notes : il expire au lieu de s'accumuler.
        expiresAt: new Date(entrée.now.getTime() + 30 * 24 * 3600 * 1000),
      })
      .returning()

    exportId = String((ligne as Record<string, unknown>)['id'])

    await appendAuditEvent(
      tx as unknown as AuditTransaction,
      {
        organizationId: principal.organizationId,
        actorId: userId,
        actorRole: principal.roles[0] ?? null,
        action: AUDIT_ACTIONS.EXPORT_CREATE,
        objectType: 'export',
        objectId: exportId,
        newValue: { genre: entrée.genre, fileName },
        requestId: entrée.requestId ?? null,
        occurredAt: entrée.now,
      },
      entrée.auditSecret,
    )
  })

  return { ok: true, exportId, fileName }
}

// --- Assemblage des données ------------------------------------------------------

async function construireRésultats(
  organizationId: string,
  assessmentId: string,
  titre: string,
  anonymisé: boolean,
): Promise<string> {
  const questions = (await db.execute(sql`
    SELECT id, number, max_points FROM questions
    WHERE assessment_id = ${assessmentId}::uuid
      AND organization_id = ${organizationId}::uuid
      AND deleted_at IS NULL
    ORDER BY sort_order
  `)) as unknown as Record<string, unknown>[]

  const colonnes: QuestionColonne[] = questions.map((q) => ({
    questionId: String(q['id']),
    number: String(q['number']),
    maxPoints: Number(q['max_points']),
  }))

  const copies = (await db.execute(sql`
    SELECT
      s.id,
      s.anonymous_code,
      gt.points_exact                        AS total,
      gt.points_max                          AS total_max,
      gt.finalized_at,
      u.name                                 AS validateur,
      -- Une copie n'est « validée » que si CHACUNE de ses décisions l'est.
      -- Un total calculé sur des propositions ne doit pas être présenté comme
      -- une note validée.
      NOT EXISTS (
        SELECT 1 FROM grading_decisions d
        WHERE d.submission_id = s.id AND d.points_awarded IS NULL
      ) AND EXISTS (
        SELECT 1 FROM grading_decisions d WHERE d.submission_id = s.id
      )                                      AS entierement_validee
    FROM submissions s
    LEFT JOIN grades gt
      ON gt.submission_id = s.id AND gt.question_id IS NULL AND gt.superseded_at IS NULL
    LEFT JOIN "user" u ON u.id = gt.finalized_by
    WHERE s.assessment_id = ${assessmentId}::uuid
      AND s.organization_id = ${organizationId}::uuid
      AND s.deleted_at IS NULL
    ORDER BY s.anonymous_code
  `)) as unknown as Record<string, unknown>[]

  const parQuestion = (await db.execute(sql`
    SELECT g.submission_id, g.question_id, g.points_exact
    FROM grades g
    JOIN submissions s ON s.id = g.submission_id
    WHERE s.assessment_id = ${assessmentId}::uuid
      AND g.question_id IS NOT NULL
      AND g.superseded_at IS NULL
  `)) as unknown as Record<string, unknown>[]

  const notes = new Map<string, Record<string, number | null>>()
  for (const n of parQuestion) {
    const copie = String(n['submission_id'])
    const courant = notes.get(copie) ?? {}
    courant[String(n['question_id'])] =
      n['points_exact'] === null ? null : Number(n['points_exact'])
    notes.set(copie, courant)
  }

  const lignes: LigneRésultat[] = copies.map((c) => ({
    identifiant: String(c['anonymous_code']),
    pointsParQuestion: notes.get(String(c['id'])) ?? {},
    total: c['total'] === null ? null : Number(c['total']),
    totalMax: Number(c['total_max'] ?? 0),
    entièrementValidée: Boolean(c['entierement_validee']),
    validateur: (c['validateur'] as string | null) ?? null,
    validéeLe: c['finalized_at'] ? new Date(c['finalized_at'] as string) : null,
  }))

  return buildResultsCsv(colonnes, lignes, { titreÉpreuve: titre, anonymisé })
}

async function construireAudit(organizationId: string, titre: string): Promise<string> {
  const événements = (await db.execute(sql`
    SELECT a.sequence, a.occurred_at, a.action, a.object_type, a.reason, a.hash,
           a.actor_role, u.name AS acteur
    FROM audit_events a
    LEFT JOIN "user" u ON u.id = a.actor_id
    WHERE a.organization_id = ${organizationId}::uuid
    ORDER BY a.sequence
  `)) as unknown as Record<string, unknown>[]

  const lignes: LigneAudit[] = événements.map((e) => ({
    sequence: Number(e['sequence']),
    occurredAt: new Date(e['occurred_at'] as string),
    action: String(e['action']),
    objectType: String(e['object_type']),
    acteur: (e['acteur'] as string | null) ?? null,
    rôle: (e['actor_role'] as string | null) ?? null,
    motif: (e['reason'] as string | null) ?? null,
    hash: String(e['hash']),
  }))

  return buildAuditCsv(lignes, { titreÉpreuve: titre })
}
