/**
 * Préparation d'une épreuve : création, questions, corrigé, barème, verrouillage.
 *
 * Le verrouillage est le moment décisif du produit. Avant lui, tout se modifie ;
 * après, plus rien — et c'est ce qui rend une note défendable. Ce service refuse
 * donc de verrouiller un barème incohérent, plutôt que de laisser la
 * contradiction se découvrir au milieu d'une session de correction.
 */

import { createHash } from 'node:crypto'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'

import { AUDIT_ACTIONS } from '@coteris/database'
import { ForbiddenError, authorize, type Principal } from '@coteris/auth'
import { appendAuditEvent, type AuditTransaction } from '@coteris/audit'

import { db, schema } from '../db'
import { assertServerOnly } from '../server-guard'

assertServerOnly('services/assessment')

const hash = (v: string): string => createHash('sha256').update(v, 'utf8').digest('hex')

export interface Résultat {
  readonly ok: boolean
  readonly message?: string
  readonly id?: string
  /** Problèmes bloquants, quand le verrouillage est refusé. */
  readonly problèmes?: readonly string[]
}

// --- Création ---------------------------------------------------------------------

export interface EntréeCréation {
  readonly title: string
  readonly subject: string | null
  readonly level: string | null
  readonly cohort: string | null
  readonly language: string
  /** Note maximale, en millièmes. */
  readonly maxPoints: number
  readonly durationMinutes: number | null
  readonly anonymizationEnabled: boolean
  readonly description: string | null
  readonly now: Date
  readonly auditSecret: string
  readonly requestId?: string | null | undefined
}

export async function créerÉpreuve(
  principal: Principal,
  userId: string,
  entrée: EntréeCréation,
): Promise<Résultat> {
  try {
    authorize(principal, 'assessment', 'create')
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, message: 'Votre rôle ne permet pas de créer une épreuve.' }
    }
    throw error
  }

  if (entrée.title.trim().length < 3) {
    return { ok: false, message: 'Le titre doit comporter au moins trois caractères.' }
  }
  if (entrée.maxPoints <= 0) {
    return { ok: false, message: 'La note maximale doit être supérieure à zéro.' }
  }

  let id = ''

  await db.transaction(async (tx) => {
    const [épreuve] = await tx
      .insert(schema.assessments)
      .values({
        organizationId: principal.organizationId,
        title: entrée.title.trim(),
        subject: entrée.subject,
        level: entrée.level,
        cohort: entrée.cohort,
        language: entrée.language,
        maxPoints: entrée.maxPoints,
        durationMinutes: entrée.durationMinutes,
        anonymizationEnabled: entrée.anonymizationEnabled,
        description: entrée.description,
        status: 'DRAFT',
        createdBy: userId,
      })
      .returning()

    id = String((épreuve as Record<string, unknown>)['id'])

    // Le corrigé et le barème existent dès la création, vides. Cela évite un
    // état intermédiaire où une épreuve n'aurait ni l'un ni l'autre, que chaque
    // écriture ultérieure devrait alors gérer.
    await tx.insert(schema.answerKeys).values({
      organizationId: principal.organizationId,
      assessmentId: id,
    })
    await tx.insert(schema.rubrics).values({
      organizationId: principal.organizationId,
      assessmentId: id,
    })

    await appendAuditEvent(
      tx as unknown as AuditTransaction,
      {
        organizationId: principal.organizationId,
        actorId: userId,
        actorRole: principal.roles[0] ?? null,
        action: AUDIT_ACTIONS.ASSESSMENT_CREATE,
        objectType: 'assessment',
        objectId: id,
        newValue: { title: entrée.title.trim(), maxPoints: entrée.maxPoints },
        requestId: entrée.requestId ?? null,
        occurredAt: entrée.now,
      },
      entrée.auditSecret,
    )
  })

  return { ok: true, id, message: 'Épreuve créée.' }
}

// --- Questions, corrigé, critères ---------------------------------------------------

export interface EntréeQuestion {
  readonly assessmentId: string
  readonly number: string
  readonly prompt: string
  readonly type: 'mcq' | 'true_false' | 'short_answer' | 'short_essay' | 'clinical_case'
  /** En millièmes. */
  readonly maxPoints: number
  /** Corrigé officiel de la question, fourni par le professeur. */
  readonly answerKey: string
  /** Critères du barème. */
  readonly critères: readonly {
    readonly label: string
    readonly maxPoints: number
    readonly acceptableAnswers: readonly string[]
  }[]
  readonly now: Date
  readonly auditSecret: string
  readonly requestId?: string | null | undefined
}

/**
 * Ajoute une question avec son corrigé et ses critères.
 *
 * Les trois sont écrits ensemble : une question sans critères ne serait jamais
 * corrigeable, et laisser cet état possible obligerait à le gérer partout.
 */
export async function ajouterQuestion(
  principal: Principal,
  userId: string,
  entrée: EntréeQuestion,
): Promise<Résultat> {
  try {
    authorize(principal, 'assessment', 'update')
    authorize(principal, 'rubric', 'create')
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, message: 'Votre rôle ne permet pas de modifier cette épreuve.' }
    }
    throw error
  }

  const épreuve = await chargerÉpreuveModifiable(principal, entrée.assessmentId)
  // `ok` discrimine de façon fiable : `message` est optionnel sur `Résultat` et
  // ne rétrécirait pas le type.
  if ('ok' in épreuve) return épreuve

  if (entrée.prompt.trim().length < 3) {
    return { ok: false, message: 'L’énoncé doit comporter au moins trois caractères.' }
  }
  if (entrée.critères.length === 0) {
    return {
      ok: false,
      message:
        'Une question doit comporter au moins un critère : sans critère, aucune correction ' +
        'n’est possible.',
    }
  }

  const sommeCritères = entrée.critères.reduce((s, c) => s + c.maxPoints, 0)
  if (sommeCritères !== entrée.maxPoints) {
    return {
      ok: false,
      message:
        `La somme des critères (${sommeCritères / 1000}) doit égaler le barème de la ` +
        `question (${entrée.maxPoints / 1000}).`,
    }
  }

  const [dernier] = await db
    .select({ sortOrder: schema.questions.sortOrder })
    .from(schema.questions)
    .where(
      and(
        eq(schema.questions.assessmentId, entrée.assessmentId),
        isNull(schema.questions.deletedAt),
      ),
    )
    .orderBy(sql`sort_order DESC`)
    .limit(1)

  let questionId = ''

  await db.transaction(async (tx) => {
    const [question] = await tx
      .insert(schema.questions)
      .values({
        organizationId: principal.organizationId,
        assessmentId: entrée.assessmentId,
        number: entrée.number.trim(),
        prompt: entrée.prompt.trim(),
        type: entrée.type,
        maxPoints: entrée.maxPoints,
        sortOrder: (dernier?.sortOrder ?? 0) + 1,
      })
      .returning()

    questionId = String((question as Record<string, unknown>)['id'])

    // Le corrigé et les critères sont rattachés au **brouillon** de version : la
    // version verrouillée sera figée au moment du verrouillage.
    for (const [index, c] of entrée.critères.entries()) {
      await tx.insert(schema.answerKeyElements).values({
        organizationId: principal.organizationId,
        answerKeyVersionId: épreuve.answerKeyVersionId,
        questionId,
        kind: 'essential',
        content: c.label,
        synonyms: c.acceptableAnswers,
        sortOrder: index,
        // Saisi par le professeur, donc accepté d'emblée. Un critère proposé par
        // l'IA arriverait, lui, en brouillon.
        validationStatus: 'accepted',
        validatedBy: userId,
        validatedAt: entrée.now,
      })

      await tx.insert(schema.rubricCriteria).values({
        organizationId: principal.organizationId,
        rubricVersionId: épreuve.rubricVersionId,
        questionId,
        label: c.label,
        attribution: 'all_or_nothing',
        maxPoints: c.maxPoints,
        sortOrder: index + 1,
        acceptableAnswers: c.acceptableAnswers,
        contradictionPolicy: { kind: 'ignore' },
        validationStatus: 'accepted',
        validatedBy: userId,
        validatedAt: entrée.now,
      })
    }

    await tx
      .update(schema.answerKeyVersions)
      .set({ rawText: sql`coalesce(raw_text, '') || ${`\n${entrée.number}. ${entrée.answerKey}`}` })
      .where(eq(schema.answerKeyVersions.id, épreuve.answerKeyVersionId))

    await appendAuditEvent(
      tx as unknown as AuditTransaction,
      {
        organizationId: principal.organizationId,
        actorId: userId,
        actorRole: principal.roles[0] ?? null,
        action: AUDIT_ACTIONS.QUESTION_UPDATE,
        objectType: 'question',
        objectId: questionId,
        newValue: {
          number: entrée.number,
          maxPoints: entrée.maxPoints,
          critères: entrée.critères.length,
        },
        requestId: entrée.requestId ?? null,
        occurredAt: entrée.now,
      },
      entrée.auditSecret,
    )
  })

  return { ok: true, id: questionId, message: 'Question ajoutée.' }
}

// --- Verrouillage --------------------------------------------------------------------

export interface EntréeVerrouillage {
  readonly assessmentId: string
  readonly now: Date
  readonly auditSecret: string
  readonly requestId?: string | null | undefined
}

/**
 * Valide et verrouille le sujet, le corrigé et le barème.
 *
 * C'est le moment décisif : après lui, aucune modification directe n'est
 * possible, et les copies peuvent être importées.
 *
 * Le service refuse de verrouiller un barème incohérent. Découvrir au milieu
 * d'une session de correction que le total des questions ne fait pas la note
 * maximale est bien pire qu'un refus explicite ici.
 */
export async function verrouillerBarème(
  principal: Principal,
  userId: string,
  entrée: EntréeVerrouillage,
): Promise<Résultat> {
  try {
    authorize(principal, 'rubric', 'lock')
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return { ok: false, message: 'Votre rôle ne permet pas de verrouiller un barème.' }
    }
    throw error
  }

  const épreuve = await chargerÉpreuveModifiable(principal, entrée.assessmentId)
  // `ok` discrimine de façon fiable : `message` est optionnel sur `Résultat` et
  // ne rétrécirait pas le type.
  if ('ok' in épreuve) return épreuve

  const problèmes = await contrôlerCohérence(entrée.assessmentId, épreuve)
  if (problèmes.length > 0) {
    return {
      ok: false,
      message: 'Le barème ne peut pas être verrouillé en l’état.',
      problèmes,
    }
  }

  const questions = await db
    .select()
    .from(schema.questions)
    .where(
      and(
        eq(schema.questions.assessmentId, entrée.assessmentId),
        isNull(schema.questions.deletedAt),
      ),
    )
    .orderBy(asc(schema.questions.sortOrder))

  const critères = await db
    .select()
    .from(schema.rubricCriteria)
    .where(eq(schema.rubricCriteria.rubricVersionId, épreuve.rubricVersionId))
    .orderBy(asc(schema.rubricCriteria.sortOrder))

  const sujet = questions.map((q) => `${q.number}. ${q.prompt}`).join('\n')
  const empreinteBarème = hash(
    JSON.stringify(
      critères.map((c) => ({ q: c.questionId, l: c.label, p: c.maxPoints, a: c.acceptableAnswers })),
    ),
  )

  await db.transaction(async (tx) => {
    const [versionSujet] = await tx
      .insert(schema.assessmentVersions)
      .values({
        organizationId: principal.organizationId,
        assessmentId: entrée.assessmentId,
        versionNumber: 1,
        extractedText: sujet,
        contentHash: hash(sujet),
        lockedAt: entrée.now,
        lockedBy: userId,
      })
      .returning()

    // Les questions sont rattachées à la version figée du sujet.
    await tx
      .update(schema.questions)
      .set({ assessmentVersionId: String((versionSujet as Record<string, unknown>)['id']) })
      .where(eq(schema.questions.assessmentId, entrée.assessmentId))

    await tx
      .update(schema.answerKeyVersions)
      .set({ lockedAt: entrée.now, lockedBy: userId })
      .where(eq(schema.answerKeyVersions.id, épreuve.answerKeyVersionId))

    await tx
      .update(schema.rubricVersions)
      .set({ lockedAt: entrée.now, lockedBy: userId, contentHash: empreinteBarème })
      .where(eq(schema.rubricVersions.id, épreuve.rubricVersionId))

    await tx
      .update(schema.assessments)
      .set({ status: 'READY_FOR_SUBMISSIONS', updatedAt: entrée.now })
      .where(eq(schema.assessments.id, entrée.assessmentId))

    for (const action of [
      AUDIT_ACTIONS.ANSWER_KEY_VALIDATE,
      AUDIT_ACTIONS.RUBRIC_LOCK,
    ] as const) {
      await appendAuditEvent(
        tx as unknown as AuditTransaction,
        {
          organizationId: principal.organizationId,
          actorId: userId,
          actorRole: principal.roles[0] ?? null,
          action,
          objectType: action === AUDIT_ACTIONS.RUBRIC_LOCK ? 'rubric_version' : 'answer_key_version',
          objectId:
            action === AUDIT_ACTIONS.RUBRIC_LOCK
              ? épreuve.rubricVersionId
              : épreuve.answerKeyVersionId,
          newValue: { versionNumber: 1, contentHash: empreinteBarème },
          reason: 'Validation et verrouillage avant import des copies',
          requestId: entrée.requestId ?? null,
          occurredAt: entrée.now,
        },
        entrée.auditSecret,
      )
    }
  })

  return {
    ok: true,
    message:
      'Barème verrouillé. L’épreuve accepte désormais les copies ; aucune modification ' +
      'directe du barème n’est plus possible.',
  }
}

// --- Aides -------------------------------------------------------------------------

interface ÉpreuveModifiable {
  readonly id: string
  readonly maxPoints: number
  readonly answerKeyVersionId: string
  readonly rubricVersionId: string
}

/**
 * Charge l'épreuve et ses versions de travail, en créant celles-ci au besoin.
 *
 * Refuse si le barème est déjà verrouillé : une modification après verrouillage
 * exige une nouvelle version, ce qui n'est pas encore implémenté. Refuser
 * explicitement vaut mieux que laisser un barème officiel changer sans trace.
 */
async function chargerÉpreuveModifiable(
  principal: Principal,
  assessmentId: string,
): Promise<ÉpreuveModifiable | Résultat> {
  const [épreuve] = await db
    .select({ id: schema.assessments.id, maxPoints: schema.assessments.maxPoints })
    .from(schema.assessments)
    .where(
      and(
        eq(schema.assessments.id, assessmentId),
        eq(schema.assessments.organizationId, principal.organizationId),
        isNull(schema.assessments.deletedAt),
      ),
    )
    .limit(1)

  if (!épreuve) return { ok: false, message: 'Épreuve introuvable.' }

  const [verrouillé] = (await db.execute(sql`
    SELECT rv.id FROM rubrics r
    JOIN rubric_versions rv ON rv.rubric_id = r.id
    WHERE r.assessment_id = ${assessmentId}::uuid AND rv.locked_at IS NOT NULL
    LIMIT 1
  `)) as unknown as { id: string }[]

  if (verrouillé) {
    return {
      ok: false,
      message:
        'Le barème de cette épreuve est verrouillé. Toute modification exige la création ' +
        'd’une nouvelle version, non encore implémentée.',
    }
  }

  const answerKeyVersionId = await versionDeTravailCorrigé(principal, assessmentId)
  const rubricVersionId = await versionDeTravailBarème(principal, assessmentId, answerKeyVersionId)

  return { id: épreuve.id, maxPoints: épreuve.maxPoints, answerKeyVersionId, rubricVersionId }
}

async function versionDeTravailCorrigé(
  principal: Principal,
  assessmentId: string,
): Promise<string> {
  const [existante] = (await db.execute(sql`
    SELECT akv.id FROM answer_keys ak
    JOIN answer_key_versions akv ON akv.answer_key_id = ak.id
    WHERE ak.assessment_id = ${assessmentId}::uuid AND akv.locked_at IS NULL
    ORDER BY akv.version_number DESC LIMIT 1
  `)) as unknown as { id: string }[]

  if (existante) return existante.id

  const [clé] = await db
    .select({ id: schema.answerKeys.id })
    .from(schema.answerKeys)
    .where(eq(schema.answerKeys.assessmentId, assessmentId))
    .limit(1)

  const [version] = await db
    .insert(schema.answerKeyVersions)
    .values({
      organizationId: principal.organizationId,
      answerKeyId: String(clé?.id),
      versionNumber: 1,
      rawText: '',
      contentHash: hash(''),
    })
    .returning()

  return String((version as Record<string, unknown>)['id'])
}

async function versionDeTravailBarème(
  principal: Principal,
  assessmentId: string,
  answerKeyVersionId: string,
): Promise<string> {
  const [existante] = (await db.execute(sql`
    SELECT rv.id FROM rubrics r
    JOIN rubric_versions rv ON rv.rubric_id = r.id
    WHERE r.assessment_id = ${assessmentId}::uuid AND rv.locked_at IS NULL
    ORDER BY rv.version_number DESC LIMIT 1
  `)) as unknown as { id: string }[]

  if (existante) return existante.id

  const [barème] = await db
    .select({ id: schema.rubrics.id })
    .from(schema.rubrics)
    .where(eq(schema.rubrics.assessmentId, assessmentId))
    .limit(1)

  const [version] = await db
    .insert(schema.rubricVersions)
    .values({
      organizationId: principal.organizationId,
      rubricId: String(barème?.id),
      answerKeyVersionId,
      versionNumber: 1,
      contentHash: hash(''),
    })
    .returning()

  return String((version as Record<string, unknown>)['id'])
}

/**
 * Contrôles de cohérence avant verrouillage.
 *
 * Tous les problèmes sont rendus d'un coup : corriger un barème une erreur à la
 * fois est une perte de temps.
 */
async function contrôlerCohérence(
  assessmentId: string,
  épreuve: ÉpreuveModifiable,
): Promise<string[]> {
  const problèmes: string[] = []

  const questions = await db
    .select()
    .from(schema.questions)
    .where(
      and(eq(schema.questions.assessmentId, assessmentId), isNull(schema.questions.deletedAt)),
    )

  if (questions.length === 0) {
    problèmes.push('L’épreuve ne comporte aucune question.')
    return problèmes
  }

  const critères = await db
    .select()
    .from(schema.rubricCriteria)
    .where(
      and(
        eq(schema.rubricCriteria.rubricVersionId, épreuve.rubricVersionId),
        isNull(schema.rubricCriteria.deletedAt),
      ),
    )

  for (const q of questions) {
    const siens = critères.filter((c) => c.questionId === q.id)
    if (siens.length === 0) {
      problèmes.push(`Question ${q.number} : aucun critère. Elle ne serait jamais corrigeable.`)
      continue
    }
    const somme = siens.reduce((s, c) => s + c.maxPoints, 0)
    if (somme !== q.maxPoints) {
      problèmes.push(
        `Question ${q.number} : la somme des critères (${somme / 1000}) ne fait pas le ` +
          `barème de la question (${q.maxPoints / 1000}).`,
      )
    }
  }

  const total = questions.reduce((s, q) => s + q.maxPoints, 0)
  if (total !== épreuve.maxPoints) {
    problèmes.push(
      `Le total des questions (${total / 1000}) ne fait pas la note maximale de ` +
        `l’épreuve (${épreuve.maxPoints / 1000}).`,
    )
  }

  return problèmes
}
