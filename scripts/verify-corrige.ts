/**
 * Vérification du corrigé annoté, contre la base et le stockage réels.
 *
 *   pnpm verify:corrige
 *
 * Prérequis : `pnpm db:migrate && pnpm db:seed`.
 *
 * Ce document part chez l'étudiant. Les vérifications portent donc autant sur ce
 * qu'il REFUSE de produire que sur ce qu'il produit : un corrigé partiel
 * présenté comme définitif serait pire que pas de corrigé du tout.
 */

import { sql } from 'drizzle-orm'

import { verifyChain } from '@coteris/audit'
import type { Principal } from '@coteris/auth'
import { contentTypeForFileName } from '@coteris/exports'

import { db } from '../apps/web/src/lib/db'
import { storage } from '../apps/web/src/lib/storage'
import { créerCorrigéAnnoté } from '../apps/web/src/lib/services/corrige-annote'

const SECRET = process.env['AUDIT_HASH_SECRET'] ?? ''
let échecs = 0

function vérifier(condition: boolean, message: string, détail?: string): void {
  if (condition) console.log(`  [32mOK[0m    ${message}`)
  else {
    échecs += 1
    console.error(`  [31mÉCHEC[0m ${message}`)
    if (détail) console.error(`        ${détail}`)
  }
}

async function une<T>(requête: ReturnType<typeof sql>): Promise<T | undefined> {
  return ((await db.execute(requête)) as unknown as T[])[0]
}

async function main(): Promise<void> {
  if (SECRET.length < 32) throw new Error('AUDIT_HASH_SECRET est requis.')

  console.log('\nVérification du corrigé annoté\n')

  const org = await une<{ id: string }>(
    sql`SELECT id FROM organization WHERE slug = 'faculte-demo'`,
  )
  const user = await une<{ id: string }>(
    sql`SELECT id FROM "user" WHERE email = 'coordinateur@demo.coteris.local'`,
  )
  if (!org || !user) throw new Error('Données de démonstration absentes.')

  const coordinateur: Principal = {
    userId: user.id,
    organizationId: org.id,
    roles: ['coordinator'],
  }

  // La copie la plus avancée du jeu de démonstration : celle qui a le plus de
  // décisions déjà validées.
  const copie = await une<{ id: string; code: string; assessment_id: string }>(sql`
    SELECT s.id, s.anonymous_code AS code, s.assessment_id
    FROM submissions s
    WHERE s.organization_id = ${org.id}::uuid AND s.deleted_at IS NULL
    ORDER BY (
      SELECT count(*) FROM grading_decisions d
      WHERE d.submission_id = s.id AND d.points_awarded IS NOT NULL
    ) DESC
    LIMIT 1
  `)
  if (!copie) throw new Error('Aucune copie de démonstration.')

  const maintenant = new Date()
  const base = { now: maintenant, auditSecret: SECRET, requestId: null }

  // --- Refus ----------------------------------------------------------------
  console.log('Refus de produire un document faux')

  const inconnue = await créerCorrigéAnnoté(coordinateur, user.id, {
    ...base,
    submissionId: '00000000-0000-4000-8000-000000000000',
  })
  vérifier(!inconnue.ok, 'une copie inexistante est refusée', inconnue.message)

  const correcteurSansDroit: Principal = { ...coordinateur, roles: ['tech_admin'] }
  const interdit = await créerCorrigéAnnoté(correcteurSansDroit, user.id, {
    ...base,
    submissionId: copie.id,
  })
  vérifier(
    !interdit.ok,
    'l’administrateur technique ne produit pas de corrigé : il n’a aucun rôle pédagogique',
    interdit.message,
  )

  // Le piège central : une question jamais analysée ne produit aucune décision,
  // donc ne contredit aucun contrôle portant sur les décisions existantes.
  const [questionOrpheline] = (await db.execute(sql`
    INSERT INTO questions
      (organization_id, assessment_id, number, prompt, type, max_points, sort_order)
    VALUES (
      ${org.id}::uuid, ${copie.assessment_id}::uuid, '999',
      'Question ajoutée par la vérification, jamais analysée.',
      'short_answer', 1000, 999
    )
    RETURNING id
  `)) as unknown as { id: string }[]

  const incomplet = await créerCorrigéAnnoté(coordinateur, user.id, {
    ...base,
    submissionId: copie.id,
  })
  vérifier(
    !incomplet.ok && (incomplet.message ?? '').includes('analysées'),
    'une question jamais analysée fait refuser le corrigé, au lieu de disparaître du total',
    incomplet.message,
  )

  await db.execute(sql`DELETE FROM questions WHERE id = ${questionOrpheline?.id ?? ''}::uuid`)

  // Une décision non validée doit également faire refuser.
  const [uneDécision] = (await db.execute(sql`
    SELECT id, points_awarded FROM grading_decisions
    WHERE submission_id = ${copie.id}::uuid AND points_awarded IS NOT NULL
    LIMIT 1
  `)) as unknown as { id: string; points_awarded: number }[]

  if (uneDécision) {
    await db.execute(sql`
      UPDATE grading_decisions SET points_awarded = NULL WHERE id = ${uneDécision.id}::uuid
    `)
    const partiel = await créerCorrigéAnnoté(coordinateur, user.id, {
      ...base,
      submissionId: copie.id,
    })
    vérifier(
      !partiel.ok && (partiel.message ?? '').includes('validées'),
      'une décision non validée fait refuser : le corrigé ne reprend que des points humains',
      partiel.message,
    )
    await db.execute(sql`
      UPDATE grading_decisions SET points_awarded = ${uneDécision.points_awarded}
      WHERE id = ${uneDécision.id}::uuid
    `)
  }

  // --- Production -----------------------------------------------------------
  console.log('\nProduction sur une copie entièrement validée')

  const avant = await une<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM audit_events WHERE organization_id = ${org.id}::uuid`,
  )

  const produit = await créerCorrigéAnnoté(coordinateur, user.id, {
    ...base,
    submissionId: copie.id,
  })

  vérifier(produit.ok, 'le corrigé est produit', produit.message)
  if (!produit.ok) {
    console.error('\n[31mLa suite dépend de cette production.[0m')
    process.exitCode = 1
    return
  }

  vérifier(
    (produit.fileName ?? '').endsWith('.pdf'),
    'le fichier porte l’extension .pdf',
    produit.fileName,
  )
  vérifier(
    contentTypeForFileName(produit.fileName ?? '') === 'application/pdf',
    'son type MIME se déduit du nom, et n’est plus text/csv',
  )

  // La table s'appelle « exports », le modèle Drizzle « exportJobs ».
  const ligne = await une<{ file_key: string; kind: string; file_name: string }>(sql`
    SELECT file_key, kind, file_name FROM exports WHERE id = ${produit.exportId ?? ''}::uuid
  `)
  vérifier(ligne?.kind === 'pdf_corrected', 'l’export est enregistré au bon genre', ligne?.kind)

  const objet = ligne ? await storage().get(ligne.file_key) : null
  vérifier(objet !== null, 'le document est bien dans le stockage')

  if (objet) {
    const entête = Array.from(objet.bytes.slice(0, 5))
      .map((o) => String.fromCharCode(o))
      .join('')
    vérifier(entête === '%PDF-', 'le fichier stocké est un vrai PDF', entête)
    vérifier(objet.size > 800, 'il n’est pas vide', `${objet.size} octets`)
    // Aucune image embarquée : un corrigé textuel pèse quelques dizaines de
    // kilo-octets. Au-delà du mégaoctet, c'est qu'une image s'est glissée.
    vérifier(objet.size < 1_000_000, 'il reste léger : aucune image embarquée', `${objet.size} octets`)
  }

  const après = await une<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM audit_events WHERE organization_id = ${org.id}::uuid`,
  )
  vérifier(
    (après?.n ?? 0) === (avant?.n ?? 0) + 1,
    'la production laisse exactement un événement d’audit',
    `avant ${avant?.n}, après ${après?.n}`,
  )

  const chaîne = await verifyChain(db, org.id, SECRET)
  vérifier(
    chaîne.valid,
    `la chaîne d’audit reste intègre (${chaîne.eventsChecked} événements)`,
  )

  console.log(
    échecs === 0
      ? '\n[32mToutes les vérifications passent.[0m\n'
      : `\n[31m${échecs} vérification(s) en échec.[0m\n`,
  )
  process.exitCode = échecs === 0 ? 0 : 1
}

main()
  .catch((error: unknown) => {
    console.error('\nÉchec de la vérification :', error)
    process.exitCode = 1
  })
  // Le pool de connexions garde le processus en vie : sans cette sortie
  // explicite, le script réussit puis ne rend jamais la main.
  .finally(() => process.exit(process.exitCode ?? 0))
