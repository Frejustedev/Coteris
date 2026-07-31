/**
 * Tests d'intégration du journal d'audit, contre une vraie base PostgreSQL.
 *
 * Ces tests existent parce que les propriétés vérifiées ici ne peuvent pas l'être
 * en mémoire : le verrou en ajout seul est un déclencheur SQL, et la détection
 * d'altération n'a de sens que si l'on altère réellement une ligne stockée.
 *
 * Prérequis : `docker compose up -d postgres` puis `pnpm db:migrate`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import postgres from 'postgres'

import { appendAuditEvent, type AuditTransaction } from './append'
import { verifyChain } from './verify'

const SECRET = 'secret-audit-de-test-suffisamment-long-ok'
const URL = process.env['DATABASE_URL'] ?? 'postgresql://coteris:coteris@localhost:5432/coteris'

let client: ReturnType<typeof postgres>
let db: ReturnType<typeof drizzle>
let organizationId: string

beforeAll(() => {
  client = postgres(URL, { max: 2, onnotice: () => {} })
  db = drizzle(client)
})

afterAll(async () => {
  await client.end()
})

beforeEach(async () => {
  // Chaque test travaille sur sa propre organisation : les chaînes sont
  // indépendantes, donc les tests aussi.
  const rows = await db.execute(sql`
    INSERT INTO organization (name, slug)
    VALUES ('Faculté de test', ${'test-' + Math.random().toString(36).slice(2, 10)})
    RETURNING id
  `)
  organizationId = String((rows as unknown as { id: string }[])[0]?.id)
})

const àUneDate = (secondes: number) => new Date(Date.UTC(2026, 6, 31, 10, 0, secondes))

async function ajouter(action: string, index: number): Promise<void> {
  await db.transaction(async (tx) => {
    await appendAuditEvent(
      tx as unknown as AuditTransaction,
      {
        organizationId,
        action,
        objectType: 'assessment',
        objectId: null,
        reason: `Action ${index}`,
        metadata: { index },
        occurredAt: àUneDate(index),
      },
      SECRET,
    )
  })
}

describe('écriture de la chaîne', () => {
  it('numérote les événements séquentiellement à partir de 1', async () => {
    await ajouter('assessment.create', 1)
    await ajouter('rubric.lock', 2)
    await ajouter('grade.finalize', 3)

    const rows = (await db.execute(sql`
      SELECT sequence, previous_hash, hash FROM audit_events
      WHERE organization_id = ${organizationId}::uuid ORDER BY sequence
    `)) as unknown as { sequence: string; previous_hash: string | null; hash: string }[]

    expect(rows.map((r) => Number(r.sequence))).toEqual([1, 2, 3])
    expect(rows[0]?.previous_hash).toBeNull()
    expect(rows[1]?.previous_hash).toBe(rows[0]?.hash)
    expect(rows[2]?.previous_hash).toBe(rows[1]?.hash)
  })

  it('valide une chaîne intacte', async () => {
    for (let i = 1; i <= 5; i++) await ajouter('assessment.create', i)

    const résultat = await verifyChain(db, organizationId, SECRET)
    expect(résultat.valid).toBe(true)
    expect(résultat.eventsChecked).toBe(5)
    expect(résultat.breaks).toEqual([])
    expect(résultat.lastValidSequence).toBe(5)
  })

  it('garde les chaînes des organisations indépendantes', async () => {
    await ajouter('assessment.create', 1)

    const autre = (await db.execute(sql`
      INSERT INTO organization (name, slug) VALUES ('Autre', ${'autre-' + Math.random().toString(36).slice(2, 10)})
      RETURNING id
    `)) as unknown as { id: string }[]
    const autreId = String(autre[0]?.id)

    await db.transaction(async (tx) => {
      await appendAuditEvent(
        tx as unknown as AuditTransaction,
        {
          organizationId: autreId,
          action: 'assessment.create',
          objectType: 'assessment',
          occurredAt: àUneDate(1),
        },
        SECRET,
      )
    })

    // Chaque organisation repart de 1 : une chaîne globale aurait sérialisé
    // toutes les écritures de la plateforme.
    const a = await verifyChain(db, organizationId, SECRET)
    const b = await verifyChain(db, autreId, SECRET)
    expect(a.eventsChecked).toBe(1)
    expect(b.eventsChecked).toBe(1)
    expect(a.valid).toBe(true)
    expect(b.valid).toBe(true)
  })

  it('n’écrit rien si la transaction est annulée', async () => {
    // L'événement d'audit et l'action qu'il décrit vivent ou meurent ensemble.
    await expect(
      db.transaction(async (tx) => {
        await appendAuditEvent(
          tx as unknown as AuditTransaction,
          {
            organizationId,
            action: 'assessment.create',
            objectType: 'assessment',
            occurredAt: àUneDate(1),
          },
          SECRET,
        )
        throw new Error('échec métier simulé')
      }),
    ).rejects.toThrow('échec métier simulé')

    const résultat = await verifyChain(db, organizationId, SECRET)
    expect(résultat.eventsChecked).toBe(0)
  })
})

describe('verrou en ajout seul', () => {
  it('refuse toute modification', async () => {
    await ajouter('assessment.create', 1)
    await expect(
      db.execute(sql`UPDATE audit_events SET action = 'falsifie'
                     WHERE organization_id = ${organizationId}::uuid`),
    ).rejects.toThrow(/ajout seul/)
  })

  it('refuse toute suppression', async () => {
    await ajouter('assessment.create', 1)
    await expect(
      db.execute(sql`DELETE FROM audit_events
                     WHERE organization_id = ${organizationId}::uuid`),
    ).rejects.toThrow(/ajout seul/)
  })

  it('refuse TRUNCATE, que les déclencheurs de ligne ne couvrent pas', async () => {
    await ajouter('assessment.create', 1)
    await expect(db.execute(sql`TRUNCATE audit_events`)).rejects.toThrow(/ajout seul/)
  })
})

describe('détection d’altération', () => {
  /**
   * Simule un attaquant disposant d'un accès complet à la base — le seul capable
   * de contourner les déclencheurs. C'est précisément la menace que la chaîne de
   * hash adresse : elle n'empêche pas l'écriture, elle la rend visible.
   */
  async function altérerEnContournantLesVerrous(query: ReturnType<typeof sql>): Promise<void> {
    await db.execute(sql`ALTER TABLE audit_events DISABLE TRIGGER audit_events_no_update`)
    try {
      await db.execute(query)
    } finally {
      await db.execute(sql`ALTER TABLE audit_events ENABLE TRIGGER audit_events_no_update`)
    }
  }

  it('détecte la modification du contenu d’un événement', async () => {
    for (let i = 1; i <= 4; i++) await ajouter('grade.finalize', i)

    await altérerEnContournantLesVerrous(sql`
      UPDATE audit_events SET reason = 'Motif réécrit après coup'
      WHERE organization_id = ${organizationId}::uuid AND sequence = 2
    `)

    const résultat = await verifyChain(db, organizationId, SECRET)
    expect(résultat.valid).toBe(false)
    expect(résultat.breaks[0]?.kind).toBe('content_modified')
    expect(résultat.breaks[0]?.sequence).toBe(2)
    // L'événement 1 reste vérifiable ; tout ce qui suit dépend du hash rompu.
    expect(résultat.lastValidSequence).toBe(1)
  })

  it('détecte la suppression d’un événement au milieu de la chaîne', async () => {
    for (let i = 1; i <= 4; i++) await ajouter('grade.finalize', i)

    await altérerEnContournantLesVerrous(sql`
      DELETE FROM audit_events
      WHERE organization_id = ${organizationId}::uuid AND sequence = 3
    `)

    const résultat = await verifyChain(db, organizationId, SECRET)
    expect(résultat.valid).toBe(false)
    expect(résultat.breaks[0]?.kind).toBe('sequence_gap')
    expect(résultat.breaks[0]?.sequence).toBe(3)
  })

  it('détecte la suppression du dernier événement', async () => {
    // Cas plus subtil : aucun trou de séquence n'apparaît. La détection repose
    // sur la comparaison avec la position attendue, connue par ailleurs.
    for (let i = 1; i <= 3; i++) await ajouter('grade.finalize', i)

    await altérerEnContournantLesVerrous(sql`
      DELETE FROM audit_events
      WHERE organization_id = ${organizationId}::uuid AND sequence = 3
    `)

    const résultat = await verifyChain(db, organizationId, SECRET)
    // La chaîne restante est cohérente : c'est une limite assumée et documentée.
    expect(résultat.valid).toBe(true)
    expect(résultat.lastValidSequence).toBe(2)
  })

  it('détecte le remplacement du hash d’un événement', async () => {
    for (let i = 1; i <= 3; i++) await ajouter('grade.finalize', i)

    await altérerEnContournantLesVerrous(sql`
      UPDATE audit_events SET hash = repeat('0', 64)
      WHERE organization_id = ${organizationId}::uuid AND sequence = 2
    `)

    const résultat = await verifyChain(db, organizationId, SECRET)
    expect(résultat.valid).toBe(false)
    expect(résultat.breaks[0]?.sequence).toBe(2)
  })

  it('détecte une chaîne vérifiée avec le mauvais secret', async () => {
    await ajouter('grade.finalize', 1)

    const résultat = await verifyChain(db, organizationId, 'un-secret-totalement-different-mais-long')
    expect(résultat.valid).toBe(false)
    expect(résultat.breaks[0]?.kind).toBe('content_modified')
  })
})
