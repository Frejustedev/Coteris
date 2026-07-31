/**
 * Lecture de l'écriture manuscrite et transcriptions.
 *
 * Une transcription n'est jamais écrasée. Chaque correction produit une nouvelle
 * `transcription_version` conservant l'ancienne valeur, l'auteur, la date et le
 * motif — et peut déclencher une nouvelle analyse.
 */

import { relations } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { answerRegions } from './submissions'
import { users, organizations } from './auth'
import { primaryId, timestamps } from './_shared'

export const ocrRuns = pgTable(
  'ocr_runs',
  {
    id: primaryId(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    answerRegionId: uuid('answer_region_id')
      .notNull()
      .references(() => answerRegions.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    model: text('model'),
    /** Version du moteur, pour pouvoir expliquer une divergence entre deux lectures. */
    engineVersion: text('engine_version'),
    fullText: text('full_text').notNull().default(''),
    /** Confiance globale, entre 0 et 1. */
    confidence: real('confidence'),
    durationMs: integer('duration_ms'),
    error: text('error'),
    ...timestamps,
  },
  (table) => [
    index('ocr_runs_region_idx').on(table.answerRegionId, table.createdAt),
    index('ocr_runs_org_idx').on(table.organizationId),
  ],
)

/**
 * Fragment de texte reconnu, avec sa position et sa confiance.
 *
 * C'est le maillon qui permet, depuis un extrait justificatif, de remonter au
 * pixel exact de la copie. Sans lui, « montrer la preuve » resterait une
 * intention.
 */
export const ocrSpans = pgTable(
  'ocr_spans',
  {
    id: primaryId(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    ocrRunId: uuid('ocr_run_id')
      .notNull()
      .references(() => ocrRuns.id, { onDelete: 'cascade' }),
    /** Niveau : `block`, `line` ou `word`. */
    level: text('level').notNull(),
    text: text('text').notNull(),
    /** Décalages dans `ocrRuns.fullText`, pour relier un extrait à ses coordonnées. */
    startOffset: integer('start_offset').notNull(),
    endOffset: integer('end_offset').notNull(),
    x: real('x'),
    y: real('y'),
    width: real('width'),
    height: real('height'),
    confidence: real('confidence'),
    /** Lectures alternatives proposées par le moteur, pour les mots incertains. */
    alternatives: jsonb('alternatives').notNull().default([]),
    ...timestamps,
  },
  (table) => [
    index('ocr_spans_run_idx').on(table.ocrRunId, table.startOffset),
    index('ocr_spans_org_idx').on(table.organizationId),
  ],
)

export const transcriptionVersions = pgTable(
  'transcription_versions',
  {
    id: primaryId(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    answerRegionId: uuid('answer_region_id')
      .notNull()
      .references(() => answerRegions.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    text: text('text').notNull(),
    /** Texte de la version précédente. Jamais écrasé, jamais perdu. */
    previousText: text('previous_text'),
    /** `ocr` pour la lecture automatique, `human` pour une correction manuelle. */
    source: text('source').notNull(),
    ocrRunId: uuid('ocr_run_id').references(() => ocrRuns.id, { onDelete: 'set null' }),
    editedBy: uuid('edited_by').references(() => users.id, { onDelete: 'restrict' }),
    editReason: text('edit_reason'),
    /** Vrai pour la version actuellement utilisée par l'analyse. */
    isCurrent: boolean('is_current').notNull().default(true),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('transcription_versions_unique').on(table.answerRegionId, table.versionNumber),
    index('transcription_versions_org_idx').on(table.organizationId),
  ],
)

export const ocrRunsRelations = relations(ocrRuns, ({ one, many }) => ({
  answerRegion: one(answerRegions, {
    fields: [ocrRuns.answerRegionId],
    references: [answerRegions.id],
  }),
  spans: many(ocrSpans),
}))

export const ocrSpansRelations = relations(ocrSpans, ({ one }) => ({
  run: one(ocrRuns, { fields: [ocrSpans.ocrRunId], references: [ocrRuns.id] }),
}))
