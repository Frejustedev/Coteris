/**
 * Comptes, sessions, organisations et rôles.
 *
 * Les noms de tables et de colonnes suivent les conventions de Better Auth et de
 * son plugin `organization` (voir docs/adr/0004-authentification-better-auth.md) :
 * l'adaptateur les résout par nom de modèle. On y ajoute les colonnes propres à
 * Coteris, ce que Better Auth autorise.
 */

import { relations } from 'drizzle-orm'
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { memberRoleEnum, primaryId, timestamps } from './_shared'

export const users = pgTable(
  'user',
  {
    id: primaryId(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    ...timestamps,
  },
  (table) => [uniqueIndex('user_email_unique').on(table.email)],
)

export const sessions = pgTable(
  'session',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    /** Organisation active de la session. Détermine le cloisonnement des données. */
    activeOrganizationId: uuid('active_organization_id'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('session_token_unique').on(table.token),
    index('session_user_idx').on(table.userId),
    index('session_expires_idx').on(table.expiresAt),
  ],
)

export const accounts = pgTable(
  'account',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    idToken: text('id_token'),
    /** Haché, jamais en clair. Better Auth s'en charge. */
    password: text('password'),
    ...timestamps,
  },
  (table) => [
    index('account_user_idx').on(table.userId),
    uniqueIndex('account_provider_unique').on(table.providerId, table.accountId),
  ],
)

export const verifications = pgTable(
  'verification',
  {
    id: primaryId(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    index('verification_identifier_idx').on(table.identifier),
    index('verification_expires_idx').on(table.expiresAt),
  ],
)

/**
 * Une organisation est un établissement, une faculté, une école, ou l'espace
 * individuel d'un enseignant.
 *
 * C'est l'unité de cloisonnement : toute donnée métier lui appartient.
 */
export const organizations = pgTable(
  'organization',
  {
    id: primaryId(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    logo: text('logo'),
    /**
     * Vrai pour l'espace personnel d'un enseignant seul.
     * Le propriétaire y cumule les permissions de coordonnateur et de correcteur,
     * sans qu'aucun code spécifique à « l'offre individuelle » n'existe.
     */
    isPersonal: boolean('is_personal').notNull().default(false),
    /** Réglages propres à l'organisation : seuils de confiance, politique de validation groupée. */
    settings: jsonb('settings').notNull().default({}),
    metadata: jsonb('metadata'),
    ...timestamps,
  },
  (table) => [uniqueIndex('organization_slug_unique').on(table.slug)],
)

export const members = pgTable(
  'member',
  {
    id: primaryId(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: memberRoleEnum('role').notNull().default('grader'),
    ...timestamps,
  },
  (table) => [
    // Un utilisateur n'a qu'une appartenance par organisation.
    uniqueIndex('member_org_user_unique').on(table.organizationId, table.userId),
    index('member_org_idx').on(table.organizationId),
    index('member_user_idx').on(table.userId),
  ],
)

export const invitations = pgTable(
  'invitation',
  {
    id: primaryId(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: memberRoleEnum('role').notNull().default('grader'),
    status: text('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    inviterId: uuid('inviter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (table) => [
    index('invitation_org_idx').on(table.organizationId),
    index('invitation_email_idx').on(table.email),
  ],
)

// --- Relations ---------------------------------------------------------------

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  accounts: many(accounts),
  memberships: many(members),
}))

export const organizationsRelations = relations(organizations, ({ many }) => ({
  members: many(members),
  invitations: many(invitations),
}))

export const membersRelations = relations(members, ({ one }) => ({
  organization: one(organizations, {
    fields: [members.organizationId],
    references: [organizations.id],
  }),
  user: one(users, { fields: [members.userId], references: [users.id] }),
}))
