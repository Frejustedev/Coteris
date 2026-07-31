/**
 * Vérification des exports, contre la base et le stockage réels.
 *
 *   pnpm verify:exports
 *
 * Prérequis : `pnpm db:migrate && pnpm db:seed`.
 */

import { sql } from 'drizzle-orm'

import { verifyChain } from '@coteris/audit'
import type { Principal } from '@coteris/auth'

import { db } from '../apps/web/src/lib/db'
import { storage } from '../apps/web/src/lib/storage'
import { créerExport } from '../apps/web/src/lib/services/exports'

const SECRET = process.env['AUDIT_HASH_SECRET'] ?? ''
let échecs = 0

function vérifier(condition: boolean, message: string, détail?: string): void {
  if (condition) console.log(`  [32mOK[0m    ${message}`)
  else {
    échecs += 1
    console.error(`  [31mÉCHEC[0m ${message}`)
    if (détail) console.error(`        ${détail}`)
  }
}

async function une<T>(requête: ReturnType<typeof sql>): Promise<T | undefined> {
  return ((await db.execute(requête)) as unknown as T[])[0]
}

async function main(): Promise<void> {
  if (SECRET.length < 32) throw new Error('AUDIT_HASH_SECRET est requis.')

  console.log('\nVérification des exports\n')

  const org = await une<{ id: string }>(
    sql`SELECT id FROM organization WHERE slug = 'faculte-demo'`,
  )
  const user = await une<{ id: string }>(
    sql`SELECT id FROM "user" WHERE email = 'coordinateur@demo.coteris.local'`,
  )
  const épreuve = await une<{ id: string }>(sql`SELECT id FROM assessments LIMIT 1`)
  if (!org || !user || !épreuve) throw new Error('Données de démonstration absentes.')

  const coordinateur: Principal = {
    userId: user.id,
    organizationId: org.id,
    roles: ['coordinator'],
  }
  const correcteur: Principal = { ...coordinateur, roles: ['grader'] }
  const adminTechnique: Principal = { ...coordinateur, roles: ['tech_admin'] }

  // --- Permissions ------------------------------------------------------------
  console.log('Permissions')

  const refusCorrecteur = await créerExport(correcteur, user.id, {
    assessmentId: épreuve.id,
    genre: 'resultats',
    now: new Date(),
    auditSecret: SECRET,
  })
  vérifier(!refusCorrecteur.ok, 'un correcteur ne crée pas d’export', refusCorrecteur.message)

  const refusAdmin = await créerExport(adminTechnique, user.id, {
    assessmentId: épreuve.id,
    genre: 'resultats',
    now: new Date(),
    auditSecret: SECRET,
  })
  vérifier(
    !refusAdmin.ok,
    'un administrateur technique n’exporte aucune note',
    refusAdmin.message,
  )

  // --- Export des résultats -----------------------------------------------------
  console.log('\nExport des résultats')

  const auditAvant = Number(
    (
      await une<{ n: string }>(
        sql`SELECT count(*) AS n FROM audit_events WHERE organization_id = ${org.id}::uuid`,
      )
    )?.n ?? 0,
  )

  const résultats = await créerExport(coordinateur, user.id, {
    assessmentId: épreuve.id,
    genre: 'resultats',
    now: new Date(),
    auditSecret: SECRET,
  })
  vérifier(résultats.ok, 'l’export des résultats est créé', résultats.message)
  vérifier(
    (résultats.fileName ?? '').endsWith('.csv'),
    'le nom de fichier est proposé',
    résultats.fileName,
  )

  const ligne = await une<{ file_key: string }>(
    sql`SELECT file_key FROM exports WHERE id = ${String(résultats.exportId)}::uuid`,
  )
  const objet = ligne ? await storage().get(ligne.file_key) : null
  vérifier(objet !== null, 'le fichier est réellement écrit dans le stockage')

  const csv = objet ? new TextDecoder().decode(objet.bytes) : ''

  // On inspecte les octets bruts : `TextDecoder` retire silencieusement la
  // marque d'ordre des octets, ce qui ferait croire à tort qu'elle est absente.
  const octets = objet?.bytes ?? new Uint8Array()
  vérifier(
    octets[0] === 0xef && octets[1] === 0xbb && octets[2] === 0xbf,
    'le fichier porte la marque d’ordre des octets, sans laquelle Excel casse les accents',
  )
  vérifier(csv.includes(';'), 'les colonnes sont séparées par un point-virgule')
  vérifier(csv.includes('Code anonyme'), 'la colonne d’identification est anonyme')
  vérifier(!csv.includes('Nomfictif'), 'aucune identité d’étudiant n’apparaît dans l’export')
  vérifier(csv.includes('ANON-001'), 'les copies figurent dans l’export')
  vérifier(
    csv.includes('Proposée — non validée'),
    'les notes non validées sont signalées comme telles',
  )

  const lignesCsv = csv.split('\r\n').filter((l) => l.trim() !== '')
  const copies = Number(
    (
      await une<{ n: string }>(
        sql`SELECT count(*) AS n FROM submissions WHERE assessment_id = ${épreuve.id}::uuid`,
      )
    )?.n ?? 0,
  )
  vérifier(
    lignesCsv.length === copies + 1,
    'une ligne par copie, plus l’en-tête',
    `${lignesCsv.length} lignes pour ${copies} copies`,
  )

  // --- Rapport d'audit ------------------------------------------------------------
  console.log('\nRapport d’audit')

  const audit = await créerExport(coordinateur, user.id, {
    assessmentId: épreuve.id,
    genre: 'audit',
    now: new Date(),
    auditSecret: SECRET,
  })
  vérifier(audit.ok, 'le rapport d’audit est créé', audit.message)

  const ligneAudit = await une<{ file_key: string }>(
    sql`SELECT file_key FROM exports WHERE id = ${String(audit.exportId)}::uuid`,
  )
  const objetAudit = ligneAudit ? await storage().get(ligneAudit.file_key) : null
  const csvAudit = objetAudit ? new TextDecoder().decode(objetAudit.bytes) : ''

  vérifier(csvAudit.includes('Verrouillage du barème'), 'les actions sont traduites en français')
  vérifier(csvAudit.includes('Empreinte'), 'l’empreinte de chaque événement est exportée')

  // --- Audit de l'export lui-même ---------------------------------------------------
  console.log('\nTraçabilité')

  const auditAprès = Number(
    (
      await une<{ n: string }>(
        sql`SELECT count(*) AS n FROM audit_events WHERE organization_id = ${org.id}::uuid`,
      )
    )?.n ?? 0,
  )
  vérifier(
    auditAprès === auditAvant + 2,
    'chaque export produit son propre événement d’audit',
    `avant ${auditAvant}, après ${auditAprès}`,
  )

  const chaîne = await verifyChain(db, org.id, SECRET)
  vérifier(chaîne.valid, `la chaîne d’audit reste intègre (${chaîne.eventsChecked} événements)`)

  console.log('')
  if (échecs === 0) console.log('[32mToutes les vérifications passent.[0m\n')
  else {
    console.error(`[31m${échecs} vérification(s) en échec.[0m\n`)
    process.exitCode = 1
  }
}

main()
  .catch((error: unknown) => {
    console.error('\nÉchec de la vérification :', error)
    process.exitCode = 1
  })
  .finally(() => process.exit(process.exitCode ?? 0))
