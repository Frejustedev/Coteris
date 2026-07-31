/**
 * Configuration de l'authentification.
 *
 * Voir docs/adr/0004-authentification-better-auth.md pour le choix de la
 * bibliothèque et le modèle de permissions.
 *
 * Les noms de tables de Coteris sont au pluriel côté TypeScript et au singulier
 * côté SQL ; l'adaptateur reçoit donc une correspondance explicite.
 */

import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { organization } from 'better-auth/plugins'

import { db, schema } from './db'

function requireSecret(): string {
  const secret = process.env['AUTH_SECRET']
  if (!secret || secret.length < 32) {
    throw new Error(
      'AUTH_SECRET est absent ou trop court. Générez-en un avec : ' +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    )
  }
  return secret
}

export const auth = betterAuth({
  secret: requireSecret(),
  baseURL: process.env['APP_URL'] ?? 'http://localhost:3000',

  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
      organization: schema.organizations,
      member: schema.members,
      invitation: schema.invitations,
    },
  }),

  advanced: {
    database: {
      // Nos colonnes `id` sont des UUID. Laisser Better Auth produire ses propres
      // identifiants textuels ferait échouer chaque insertion.
      generateId: 'uuid',
    },
  },

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    // Vérification d'adresse exigée en production uniquement : en développement,
    // aucun serveur de messagerie n'est configuré.
    requireEmailVerification: process.env['NODE_ENV'] === 'production',
  },

  session: {
    expiresIn: 60 * 60 * 8,
    updateAge: 60 * 60,
  },

  databaseHooks: {
    user: {
      create: {
        /**
         * Chaque inscription crée l'espace individuel de l'enseignant.
         *
         * C'est ainsi que fonctionne « l'offre individuelle » : aucun code
         * spécifique, seulement une organisation personnelle où le propriétaire
         * cumule les rôles de coordonnateur et de correcteur.
         *
         * Sans cela, un utilisateur fraîchement inscrit n'appartiendrait à
         * aucune organisation — donc ne verrait rien, et serait renvoyé à la
         * page de connexion sans comprendre pourquoi.
         */
        after: async (user) => {
          await createPersonalWorkspace(user.id, user.name, user.email)
        },
      },
    },
  },

  plugins: [organization()],
})

/** Crée l'organisation personnelle d'un nouvel utilisateur et l'y rattache. */
async function createPersonalWorkspace(
  userId: string,
  name: string,
  email: string,
): Promise<void> {
  const base = (name || email.split('@')[0] || 'espace')
    .toLocaleLowerCase('fr-FR')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)

  // Le slug doit être unique. Le suffixe évite une collision entre deux
  // enseignants homonymes sans imposer de saisie supplémentaire.
  const slug = `${base || 'espace'}-${userId.slice(0, 8)}`

  const [org] = await db
    .insert(schema.organizations)
    .values({
      name: `Espace de ${name || email}`,
      slug,
      isPersonal: true,
    })
    .returning()

  if (!org) throw new Error("La création de l'espace individuel a échoué.")

  // Une seule ligne d'appartenance : la table porte un index unique sur
  // (organisation, utilisateur), et le plugin `organization` de Better Auth
  // suppose lui aussi une appartenance unique.
  //
  // Le cumul coordonnateur + correcteur n'est donc PAS dupliqué en base : il est
  // déduit de `isPersonal` au moment de construire le principal (voir
  // `session.ts`). Stocker deux lignes créerait une seconde source de vérité,
  // qui finirait par diverger.
  await db.insert(schema.members).values({
    organizationId: org.id,
    userId,
    role: 'coordinator',
  })
}

export type Auth = typeof auth
