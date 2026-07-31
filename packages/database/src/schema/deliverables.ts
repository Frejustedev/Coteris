/**
 * Exports produits et notifications.
 *
 * La constante s'appelle `exportJobs` et non `exports` : ce dernier nom entre en
 * collision avec l'objet `exports` de CommonJS lorsque le fichier est chargé par
 * un outil qui transpile vers CJS, ce que fait drizzle-kit. La table SQL, elle,
 * garde bien le nom `exports`.
 */

import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { assessments } from './assessments'
import { organizations, users } from './auth'
import { primaryId, timestamps } from './_shared'

export const exportJobs = pgTable(
  'exports',
  {
    id: primaryId(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    /** `xlsx`, `csv`, `pdf_corrected`, `audit_report`. */
    kind: text('kind').notNull(),
    status: text('status').notNull().default('pending'),
    fileKey: text('file_key'),
    fileName: text('file_name'),
    /** Paramètres de l'export, pour pouvoir le reproduire à l'identique. */
    parameters: jsonb('parameters').notNull().default({}),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** Les exports contiennent des notes : ils expirent au lieu de s'accumuler. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    error: text('error'),
    ...timestamps,
  },
  (table) => [
    index('exports_assessment_idx').on(table.assessmentId, table.createdAt),
    index('exports_org_idx').on(table.organizationId),
  ],
)

export const notifications = pgTable(
  'notifications',
  {
    id: primaryId(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    linkPath: text('link_path'),
    readAt: timestamp('read_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('notifications_user_idx').on(table.userId, table.readAt)],
)
