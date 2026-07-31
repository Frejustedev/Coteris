/**
 * Session courante et principal.
 *
 * Toute lecture de données métier part d'ici. La règle est simple et sans
 * exception : **une fonction de dépôt reçoit toujours un `organizationId`
 * explicite**, et cet identifiant vient de la session, jamais d'un paramètre
 * d'URL. Sans cela, il suffirait de changer un identifiant dans la barre
 * d'adresse pour lire les copies d'un autre établissement.
 */

import { cache } from 'react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { and, eq } from 'drizzle-orm'

import {
  ForbiddenError,
  PERSONAL_WORKSPACE_ROLES,
  type Principal,
  type Role,
} from '@coteris/auth'

import { auth } from './auth'
import { db, schema } from './db'

export interface CurrentUser {
  readonly userId: string
  readonly name: string
  readonly email: string
  readonly principal: Principal
}

/**
 * Utilisateur connecté, ou `null`.
 *
 * `cache` mémorise le résultat pour la durée du rendu : sans elle, chaque
 * composant serveur qui appelle cette fonction déclencherait une requête de
 * session supplémentaire.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return null

  const userId = session.user.id
  const activeOrganizationId = session.session.activeOrganizationId ?? null

  // L'appartenance est relue en base à chaque rendu. Se fier au seul contenu du
  // cookie laisserait un membre révoqué garder ses droits jusqu'à expiration.
  const memberships = await db
    .select({
      organizationId: schema.members.organizationId,
      role: schema.members.role,
      isPersonal: schema.organizations.isPersonal,
    })
    .from(schema.members)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.members.organizationId))
    .where(eq(schema.members.userId, userId))

  const membership =
    memberships.find((m) => m.organizationId === activeOrganizationId) ?? memberships[0]

  if (!membership) return null

  // Dans un espace individuel, le propriétaire cumule coordonnateur et
  // correcteur. Le cumul est déduit ici plutôt que dupliqué en base : une
  // seconde source de vérité finirait par diverger de la première.
  const roles: Role[] = membership.isPersonal
    ? [...PERSONAL_WORKSPACE_ROLES]
    : [membership.role as Role]

  return {
    userId,
    name: session.user.name,
    email: session.user.email,
    principal: {
      userId,
      organizationId: membership.organizationId,
      roles,
    },
  }
})

/** Exige une session. Redirige vers la connexion sinon. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser()
  if (!user) redirect('/connexion')
  return user
}

/**
 * Vérifie qu'un objet appartient bien à l'organisation de la session.
 *
 * À appeler sur tout identifiant venant d'une URL.
 */
export function assertBelongs(principal: Principal, organizationId: string): void {
  if (principal.organizationId !== organizationId) {
    throw new ForbiddenError('organization', 'read')
  }
}

/** Organisation active, pour les fonctions de dépôt. */
export async function currentOrganizationId(): Promise<string> {
  const { principal } = await requireUser()
  return principal.organizationId
}

export async function organizationName(organizationId: string): Promise<string> {
  const [org] = await db
    .select({ name: schema.organizations.name })
    .from(schema.organizations)
    .where(and(eq(schema.organizations.id, organizationId)))
    .limit(1)
  return org?.name ?? 'Organisation'
}
