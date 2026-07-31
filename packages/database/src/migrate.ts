/**
 * Application des migrations.
 *
 * Exécuté par `pnpm db:migrate`, en développement comme en CI et en production.
 * Idempotent : rejouer la commande sur une base à jour ne fait rien.
 */

import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { sql } from 'drizzle-orm'
import postgres from 'postgres'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = resolve(here, '../drizzle')

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL']
  if (!url) {
    throw new Error('DATABASE_URL est requis pour appliquer les migrations.')
  }

  // `max: 1` : les migrations doivent s'appliquer séquentiellement.
  const client = postgres(url, { max: 1 })
  const db = drizzle(client)

  try {
    console.log('Application des migrations…')
    await migrate(db, { migrationsFolder })

    await hardenAuditTable(db)

    console.log('Migrations appliquées.')
  } finally {
    await client.end()
  }
}

/**
 * Rend la table d'audit réellement en ajout seul.
 *
 * Cette étape ne peut pas être exprimée dans le schéma Drizzle : c'est une
 * question de droits, pas de structure. Elle est pourtant essentielle — une
 * chaîne de hash qu'un UPDATE peut réécrire ne prouve rien, puisqu'un attaquant
 * disposant des droits d'écriture recalculerait simplement la chaîne.
 *
 * Le déclencheur bloque UPDATE et DELETE y compris pour le propriétaire de la
 * table, ce qu'un simple REVOKE ne ferait pas.
 */
async function hardenAuditTable(db: ReturnType<typeof drizzle>): Promise<void> {
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION coteris_audit_append_only()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION
        'audit_events est en ajout seul : % interdit. La chaîne de hash perdrait toute valeur probante.',
        TG_OP;
    END;
    $$ LANGUAGE plpgsql;
  `)

  await db.execute(sql`DROP TRIGGER IF EXISTS audit_events_no_update ON audit_events;`)
  await db.execute(sql`
    CREATE TRIGGER audit_events_no_update
      BEFORE UPDATE OR DELETE ON audit_events
      FOR EACH ROW EXECUTE FUNCTION coteris_audit_append_only();
  `)

  // TRUNCATE ne déclenche PAS les triggers de ligne : sans ce second
  // déclencheur, une seule commande effacerait tout le journal d'audit sans
  // rien rencontrer. Il faut un trigger de niveau instruction.
  await db.execute(sql`DROP TRIGGER IF EXISTS audit_events_no_truncate ON audit_events;`)
  await db.execute(sql`
    CREATE TRIGGER audit_events_no_truncate
      BEFORE TRUNCATE ON audit_events
      FOR EACH STATEMENT EXECUTE FUNCTION coteris_audit_append_only();
  `)

  console.log("Table d'audit verrouillée en ajout seul (UPDATE, DELETE et TRUNCATE).")
}

main().catch((error: unknown) => {
  console.error('Échec des migrations :', error)
  process.exitCode = 1
})
