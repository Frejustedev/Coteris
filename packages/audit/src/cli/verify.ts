/**
 * Vérification de l'intégrité des journaux d'audit.
 *
 *   pnpm audit:verify              toutes les organisations
 *   pnpm audit:verify <uuid>       une seule
 *
 * Sort en code 1 si une chaîne est rompue, pour être utilisable dans une tâche
 * planifiée ou un contrôle de conformité.
 */

import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import { describeBreak, verifyChain } from '../verify'

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL']
  if (!url) throw new Error('DATABASE_URL est requis.')

  const secret = process.env['AUDIT_HASH_SECRET']
  if (!secret) {
    throw new Error(
      "AUDIT_HASH_SECRET est requis. Sans le secret d'origine, aucune chaîne ne peut " +
        'être vérifiée — et ce serait normal.',
    )
  }

  const cible = process.argv[2]
  const client = postgres(url, { max: 1, onnotice: () => {} })
  const db = drizzle(client)

  let rompues = 0

  try {
    const organisations = (await db.execute(
      cible
        ? sql`SELECT id, name FROM organization WHERE id = ${cible}::uuid`
        : sql`SELECT o.id, o.name FROM organization o
              WHERE EXISTS (SELECT 1 FROM audit_events a WHERE a.organization_id = o.id)
              ORDER BY o.name`,
    )) as unknown as { id: string; name: string }[]

    if (organisations.length === 0) {
      console.log('Aucun journal d’audit à vérifier.')
      return
    }

    console.log(`Vérification de ${organisations.length} journal(aux) d'audit…\n`)

    for (const org of organisations) {
      const résultat = await verifyChain(db, org.id, secret)

      if (résultat.valid) {
        console.log(
          `  OK      ${org.name} — ${résultat.eventsChecked} événement(s), chaîne intacte`,
        )
      } else {
        rompues += 1
        console.error(`  ROMPUE  ${org.name} — ${résultat.eventsChecked} événement(s) lus`)
        for (const rupture of résultat.breaks) {
          console.error(`          ${describeBreak(rupture)}`)
        }
        console.error(
          `          Dernière position vérifiable : ${résultat.lastValidSequence ?? 'aucune'}`,
        )
      }
    }

    console.log('')
    if (rompues > 0) {
      console.error(`${rompues} journal(aux) altéré(s). Ce constat doit être traité comme un incident.`)
      process.exitCode = 1
    } else {
      console.log('Tous les journaux sont intègres.')
    }
  } finally {
    await client.end()
  }
}

main().catch((error: unknown) => {
  console.error('Échec de la vérification :', error)
  process.exitCode = 1
})
