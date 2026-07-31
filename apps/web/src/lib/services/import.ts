/**
 * Import de copies.
 *
 * Le service écrit le fichier, crée la copie et ses zones de réponse, met les
 * analyses en file et journalise — **le tout dans une seule transaction** pour
 * la partie base. Une copie importée dont l'analyse ne serait jamais mise en file
 * resterait éternellement « en attente », sans que l'enseignant comprenne
 * pourquoi.
 *
 * Ce que l'import refuse est aussi important que ce qu'il accepte.
 */

import { sql } from 'drizzle-orm'

import { AUDIT_ACTIONS } from '@coteris/database'
import { ForbiddenError, authorize, type Principal } from '@coteris/auth'
import { appendAuditEvent, type AuditTransaction } from '@coteris/audit'
import { TASKS, addJob, type JobTransaction } from '@coteris/jobs'
import { contentHash, detectContentType, storageKey } from '@coteris/storage'

import { db, schema } from '../db'
import { assertServerOnly } from '../server-guard'
import { storage } from '../storage'

assertServerOnly('services/import')

export interface RésultatImport {
  readonly ok: boolean
  readonly submissionId?: string
  readonly anonymousCode?: string
  readonly message?: string
  /** Vrai si le fichier avait déjà été importé : ce n'est pas une erreur. */
  readonly doublon?: boolean
}

export interface EntréeImport {
  readonly assessmentId: string
  readonly fileName: string
  readonly bytes: Uint8Array
  readonly now: Date
  readonly auditSecret: string
  readonly requestId?: string | null | undefined
}

function tailleMaxOctets(): number {
  return Number(process.env['UPLOAD_MAX_FILE_SIZE_MB'] ?? 25) * 1024 * 1024
}

export async function importerCopie(
  principal: Principal,
  userId: string,
  entrée: EntréeImport,
): Promise<RésultatImport> {
  try {
    authorize(principal, 'submission', 'create')
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, message: 'Votre rôle ne permet pas d’importer des copies.' }
    }
    throw error
  }

  // --- Contrôles du fichier ---------------------------------------------------
  if (entrée.bytes.byteLength === 0) {
    return { ok: false, message: 'Le fichier est vide.' }
  }

  if (entrée.bytes.byteLength > tailleMaxOctets()) {
    const mo = Math.round(tailleMaxOctets() / (1024 * 1024))
    return { ok: false, message: `Le fichier dépasse la taille maximale de ${mo} Mo.` }
  }

  // Le type est déduit des octets, jamais du nom ni du type déclaré : un
  // exécutable renommé en .png arriverait avec le type image/png.
  const type = detectContentType(entrée.bytes)
  if (!type) {
    return {
      ok: false,
      message:
        'Format non reconnu. Les copies acceptées sont au format JPEG, PNG ou WEBP. ' +
        'Le contrôle porte sur le contenu du fichier, pas sur son extension.',
    }
  }

  if (type === 'application/pdf') {
    // Refus explicite plutôt qu'un import qui resterait bloqué : découper un PDF
    // en pages n'est pas encore implémenté, et le dire vaut mieux que de laisser
    // l'enseignant attendre.
    return {
      ok: false,
      message:
        'Les PDF ne sont pas encore pris en charge : le découpage en pages reste à ' +
        'implémenter. Importez les pages sous forme d’images.',
    }
  }

  // --- Épreuve et barème -------------------------------------------------------
  const [épreuve] = (await db.execute(sql`
    SELECT a.id, a.title, a.status,
           (SELECT count(*) FROM questions q
             WHERE q.assessment_id = a.id AND q.deleted_at IS NULL) AS nb_questions,
           EXISTS (
             SELECT 1 FROM rubrics r
             JOIN rubric_versions rv ON rv.rubric_id = r.id
             WHERE r.assessment_id = a.id AND rv.locked_at IS NOT NULL
           ) AS bareme_verrouille
    FROM assessments a
    WHERE a.id = ${entrée.assessmentId}::uuid
      AND a.organization_id = ${principal.organizationId}::uuid
      AND a.deleted_at IS NULL
  `)) as unknown as Record<string, unknown>[]

  if (!épreuve) return { ok: false, message: 'Épreuve introuvable.' }

  if (!épreuve['bareme_verrouille']) {
    // Principe du produit, appliqué à l'entrée : importer des copies sans barème
    // verrouillé mènerait à une file de travaux qui échouerait un à un.
    return {
      ok: false,
      message:
        'Le barème de cette épreuve n’est pas verrouillé. Aucune correction n’est ' +
        'possible tant qu’il ne l’est pas.',
    }
  }

  const nbQuestions = Number(épreuve['nb_questions'])
  if (nbQuestions === 0) {
    return { ok: false, message: 'Cette épreuve ne contient aucune question.' }
  }

  // --- Doublon ------------------------------------------------------------------
  const empreinte = contentHash(entrée.bytes)

  const [existante] = (await db.execute(sql`
    SELECT id, anonymous_code FROM submissions
    WHERE assessment_id = ${entrée.assessmentId}::uuid
      AND organization_id = ${principal.organizationId}::uuid
      AND file_hash = ${empreinte}
      AND deleted_at IS NULL
    LIMIT 1
  `)) as unknown as Record<string, unknown>[]

  if (existante) {
    // Un doublon n'est pas une erreur : un enseignant qui reclique après un délai
    // réseau ne doit pas se retrouver avec deux copies à démêler avant un jury.
    return {
      ok: true,
      doublon: true,
      submissionId: String(existante['id']),
      anonymousCode: String(existante['anonymous_code']),
      message: `Ce fichier a déjà été importé sous le code ${String(existante['anonymous_code'])}.`,
    }
  }

  // --- Code anonyme --------------------------------------------------------------
  const [dernier] = (await db.execute(sql`
    SELECT anonymous_code FROM submissions
    WHERE assessment_id = ${entrée.assessmentId}::uuid
    ORDER BY anonymous_code DESC LIMIT 1
  `)) as unknown as { anonymous_code: string }[]

  const suivant = (Number(dernier?.anonymous_code?.replace(/\D/g, '') ?? 0) || 0) + 1
  const anonymousCode = `ANON-${String(suivant).padStart(3, '0')}`

  // --- Écriture du fichier ---------------------------------------------------------
  const cléOriginal = storageKey(principal.organizationId, [
    'copies',
    entrée.assessmentId,
    `${anonymousCode}-original`,
  ])

  await storage().put(cléOriginal, entrée.bytes, { contentType: type })

  const questions = (await db.execute(sql`
    SELECT id, sort_order FROM questions
    WHERE assessment_id = ${entrée.assessmentId}::uuid AND deleted_at IS NULL
    ORDER BY sort_order
  `)) as unknown as Record<string, unknown>[]

  let submissionId = ''

  await db.transaction(async (tx) => {
    const [copie] = await tx
      .insert(schema.submissions)
      .values({
        organizationId: principal.organizationId,
        assessmentId: entrée.assessmentId,
        anonymousCode,
        status: 'segmented',
        // La segmentation est déduite d'une hypothèse de mise en page, pas
        // détectée : l'enseignant doit la vérifier.
        quality: 'check_recommended',
        qualityIssues: ['segmentation_automatique_a_verifier'],
        pageCount: 1,
        originalFileKey: cléOriginal,
        originalFileName: entrée.fileName.slice(0, 255),
        fileHash: empreinte,
        idempotencyKey: `${entrée.assessmentId}:${empreinte}`,
        uploadedBy: userId,
      })
      .returning()

    submissionId = String((copie as Record<string, unknown>)['id'])

    const [page] = await tx
      .insert(schema.submissionPages)
      .values({
        organizationId: principal.organizationId,
        submissionId,
        pageNumber: 1,
        imageKey: cléOriginal,
        quality: 'acceptable',
      })
      .returning()

    const pageId = String((page as Record<string, unknown>)['id'])

    /*
     * Segmentation par bandes égales.
     *
     * C'est une **hypothèse de mise en page**, pas une détection : on suppose une
     * zone de réponse par question, dans l'ordre, réparties sur la hauteur. Elle
     * est vraie pour beaucoup de sujets à réponses courtes et fausse pour les
     * autres.
     *
     * Elle est donc marquée d'une confiance faible, la copie est classée
     * « vérification recommandée », et l'interface le dit. Une détection réelle
     * et la correction manuelle des zones restent à implémenter.
     */
    const hauteur = 0.94 / questions.length
    for (const [index, q] of questions.entries()) {
      const [zone] = await tx
        .insert(schema.answerRegions)
        .values({
          organizationId: principal.organizationId,
          submissionId,
          submissionPageId: pageId,
          questionId: String(q['id']),
          x: 0.03,
          y: 0.03 + index * hauteur,
          width: 0.94,
          height: hauteur * 0.95,
          croppedImageKey: cléOriginal,
          origin: 'auto',
          confidence: 0.3,
          sortOrder: index,
        })
        .returning()

      // Mise en file dans la MÊME transaction que la copie. Sans cela, une copie
      // pourrait exister sans que son analyse soit jamais demandée.
      await addJob(
        tx as unknown as JobTransaction,
        TASKS.ANALYZE_REGION,
        {
          organizationId: principal.organizationId,
          submissionId,
          answerRegionId: String((zone as Record<string, unknown>)['id']),
          questionId: String(q['id']),
          forceSecondPass: false,
          requestedBy: userId,
        },
        { jobKey: `analyse:${String((zone as Record<string, unknown>)['id'])}` },
      )
    }

    await appendAuditEvent(
      tx as unknown as AuditTransaction,
      {
        organizationId: principal.organizationId,
        actorId: userId,
        actorRole: principal.roles[0] ?? null,
        action: AUDIT_ACTIONS.SUBMISSION_IMPORT,
        objectType: 'submission',
        objectId: submissionId,
        newValue: {
          anonymousCode,
          fileName: entrée.fileName,
          contentType: type,
          sizeBytes: entrée.bytes.byteLength,
          fileHash: empreinte,
          zones: questions.length,
        },
        requestId: entrée.requestId ?? null,
        occurredAt: entrée.now,
      },
      entrée.auditSecret,
    )
  })

  return {
    ok: true,
    submissionId,
    anonymousCode,
    message:
      `Copie importée sous le code ${anonymousCode}. ${questions.length} analyse(s) ` +
      `mise(s) en file. La segmentation automatique doit être vérifiée.`,
  }
}
