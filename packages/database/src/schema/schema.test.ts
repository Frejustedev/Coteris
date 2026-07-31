/**
 * Invariants structurels du schéma.
 *
 * Ces tests ne touchent pas à la base : ils inspectent les définitions Drizzle.
 * Ils existent parce que les règles vérifiées ici sont exactement celles qu'on
 * oublie en ajoutant une table six mois plus tard — et dont l'oubli ne se voit
 * qu'au moment d'une fuite de données entre établissements.
 */

import { describe, expect, it } from 'vitest'
import { getTableColumns, getTableName, is } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'

import * as schema from './index'

/**
 * Tables légitimement dépourvues de `organization_id`.
 *
 * Toute addition à cette liste doit être justifiée ici même.
 */
const SANS_ORGANISATION = new Set([
  // Comptes : un utilisateur peut appartenir à plusieurs organisations.
  'user',
  'session',
  'account',
  'verification',
  // L'organisation elle-même.
  'organization',
  // Catalogue global des offres commerciales.
  'subscription_plans',
])

function toutesLesTables(): { name: string; table: PgTable }[] {
  const tables: { name: string; table: PgTable }[] = []
  // Le module exporte aussi des énumérations, des types et des relations :
  // on ne retient que ce qui est réellement une table.
  for (const valeur of Object.values(schema) as unknown[]) {
    if (is(valeur, PgTable)) {
      tables.push({ name: getTableName(valeur), table: valeur })
    }
  }
  return tables
}

describe('cloisonnement entre organisations', () => {
  it('trouve bien les tables du schéma', () => {
    const tables = toutesLesTables()
    expect(tables.length).toBeGreaterThan(20)
  })

  it('impose organization_id non nul sur toute table métier', () => {
    const manquantes: string[] = []

    for (const { name, table } of toutesLesTables()) {
      if (SANS_ORGANISATION.has(name)) continue

      const colonnes = getTableColumns(table)
      const org = Object.values(colonnes).find((c) => c.name === 'organization_id')

      if (!org) {
        manquantes.push(`${name} : colonne organization_id absente`)
      } else if (!org.notNull) {
        manquantes.push(`${name} : organization_id peut être nul`)
      }
    }

    expect(
      manquantes,
      `Ces tables ne peuvent pas être cloisonnées par organisation :\n${manquantes.join('\n')}`,
    ).toEqual([])
  })
})

describe('arithmétique des points', () => {
  /**
   * Les points sont des entiers en millièmes (ADR 0006). Une colonne de points
   * déclarée en virgule flottante produirait des notes fausses au centième sur
   * un document d'examen.
   */
  it('n’utilise jamais de virgule flottante pour une colonne de points', () => {
    const fautives: string[] = []
    const motsClés = ['points', 'max_points', 'cap']

    for (const { name, table } of toutesLesTables()) {
      for (const colonne of Object.values(getTableColumns(table))) {
        const estColonneDePoints = motsClés.some((mot) => colonne.name.includes(mot))
        if (!estColonneDePoints) continue

        if (colonne.columnType !== 'PgInteger' && colonne.columnType !== 'PgBigInt53') {
          fautives.push(`${name}.${colonne.name} est de type ${colonne.columnType}`)
        }
      }
    }

    expect(
      fautives,
      `Colonnes de points en virgule flottante :\n${fautives.join('\n')}`,
    ).toEqual([])
  })

  it('stocke les coûts d’inférence en entiers', () => {
    const fautives: string[] = []

    for (const { name, table } of toutesLesTables()) {
      for (const colonne of Object.values(getTableColumns(table))) {
        if (!colonne.name.includes('cost')) continue
        if (colonne.columnType !== 'PgBigInt53' && colonne.columnType !== 'PgInteger') {
          fautives.push(`${name}.${colonne.name} est de type ${colonne.columnType}`)
        }
      }
    }

    expect(fautives).toEqual([])
  })
})

describe('traçabilité', () => {
  it('donne au journal d’audit tout ce qu’exige la chaîne de hash', () => {
    const colonnes = Object.values(getTableColumns(schema.auditEvents)).map((c) => c.name)

    for (const requise of [
      'organization_id',
      'sequence',
      'actor_id',
      'action',
      'object_type',
      'object_id',
      'previous_value',
      'new_value',
      'reason',
      'request_id',
      'previous_hash',
      'hash',
      'occurred_at',
    ]) {
      expect(colonnes, `audit_events.${requise} manquant`).toContain(requise)
    }
  })

  it('n’autorise pas la suppression logique du journal d’audit', () => {
    // Un journal en ajout seul ne peut pas avoir de colonne de suppression :
    // ce serait une porte de sortie pour effacer une trace.
    const colonnes = Object.values(getTableColumns(schema.auditEvents)).map((c) => c.name)
    expect(colonnes).not.toContain('deleted_at')
    expect(colonnes).not.toContain('updated_at')
  })

  it('relie chaque décision de correction aux versions utilisées', () => {
    const colonnes = Object.values(getTableColumns(schema.gradingRuns)).map((c) => c.name)
    expect(colonnes).toContain('rubric_version_id')
    expect(colonnes).toContain('answer_key_version_id')
    // Sans la version du prompt, une proposition n'est pas reproductible.
    expect(colonnes).toContain('prompt_version')
  })

  it('sépare les points proposés des points attribués', () => {
    const colonnes = Object.values(getTableColumns(schema.gradingDecisions)).map((c) => c.name)
    expect(colonnes).toContain('points_proposed')
    expect(colonnes).toContain('points_awarded')
  })
})

describe('anonymisation', () => {
  it('isole l’identité de l’étudiant dans une table dédiée', () => {
    // La copie ne doit porter aucun élément d'identité : masquer un nom dans
    // l'interface tout en le laissant sur la même ligne ne protège de rien.
    const colonnes = Object.values(getTableColumns(schema.submissions)).map((c) => c.name)
    expect(colonnes).not.toContain('student_id')
    expect(colonnes).not.toContain('first_name')
    expect(colonnes).not.toContain('last_name')
    expect(colonnes).toContain('anonymous_code')

    const identités = Object.values(getTableColumns(schema.submissionIdentities)).map((c) => c.name)
    expect(identités).toContain('submission_id')
    expect(identités).toContain('student_id')
  })
})
