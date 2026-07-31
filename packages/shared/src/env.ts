/**
 * Validation de la configuration au démarrage.
 *
 * L'application refuse de démarrer si une variable est absente ou invalide,
 * plutôt que d'échouer plus tard, en production, sur un message obscur.
 *
 * Les dépendances conditionnelles sont vérifiées : déclarer STORAGE_DRIVER=s3
 * sans fournir S3_BUCKET est une erreur de configuration détectée ici, pas au
 * premier import de copie.
 */

import { z } from 'zod'

const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1')

const port = z.coerce.number().int().min(1).max(65535)

const secret = (name: string) =>
  z
    .string()
    .min(32, `${name} doit faire au moins 32 caractères`)
    .refine((value) => !value.startsWith('remplacez-moi'), {
      message: `${name} porte encore sa valeur d'exemple. Générez un secret réel.`,
    })

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),

  DATABASE_URL: z.string().url().startsWith('postgres'),
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),

  AUTH_SECRET: secret('AUTH_SECRET'),
  AUDIT_HASH_SECRET: secret('AUDIT_HASH_SECRET'),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_PATH: z.string().optional(),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: booleanish.default('true'),
  STORAGE_SIGNED_URL_TTL: z.coerce.number().int().min(30).max(3600).default(300),

  MAIL_DRIVER: z.enum(['console', 'smtp', 'resend']).default('console'),
  MAIL_FROM: z.string().min(1),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: port.default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: booleanish.default('false'),
  RESEND_API_KEY: z.string().optional(),

  AI_PROVIDER: z.enum(['mock', 'anthropic', 'google', 'azure', 'mistral']).default('mock'),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
  OCR_PROVIDER: z.enum(['mock', 'google', 'azure', 'mistral']).default('mock'),
  OCR_API_KEY: z.string().optional(),
  OCR_MODEL: z.string().optional(),
  AI_PROMPT_VERSION: z.coerce.number().int().min(1).default(1),

  AI_MONTHLY_BUDGET_EUR: z.coerce.number().min(0).default(50),
  AI_PER_ASSESSMENT_BUDGET_EUR: z.coerce.number().min(0).default(10),

  CONFIDENCE_GREEN_MIN: z.coerce.number().min(0).max(100).default(90),
  CONFIDENCE_ORANGE_MIN: z.coerce.number().min(0).max(100).default(65),
  SECOND_PASS_GREEN_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.05),

  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  WORKER_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(5),

  UPLOAD_MAX_FILE_SIZE_MB: z.coerce.number().int().min(1).max(200).default(25),
  UPLOAD_MAX_PAGES_PER_SUBMISSION: z.coerce.number().int().min(1).max(200).default(20),
  UPLOAD_MIN_DPI: z.coerce.number().int().min(72).max(600).default(150),
})

export const envSchema = baseSchema
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER === 'local' && !env.STORAGE_LOCAL_PATH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STORAGE_LOCAL_PATH'],
        message: 'STORAGE_LOCAL_PATH est requis quand STORAGE_DRIVER=local',
      })
    }

    if (env.STORAGE_DRIVER === 's3') {
      for (const key of ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} est requis quand STORAGE_DRIVER=s3`,
          })
        }
      }
    }

    if (env.MAIL_DRIVER === 'smtp' && !env.SMTP_HOST) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SMTP_HOST'],
        message: 'SMTP_HOST est requis quand MAIL_DRIVER=smtp',
      })
    }

    if (env.MAIL_DRIVER === 'resend' && !env.RESEND_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['RESEND_API_KEY'],
        message: 'RESEND_API_KEY est requis quand MAIL_DRIVER=resend',
      })
    }

    if (env.AI_PROVIDER !== 'mock' && !env.AI_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AI_API_KEY'],
        message: `AI_API_KEY est requis quand AI_PROVIDER=${env.AI_PROVIDER}`,
      })
    }

    if (env.OCR_PROVIDER !== 'mock' && !env.OCR_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OCR_API_KEY'],
        message: `OCR_API_KEY est requis quand OCR_PROVIDER=${env.OCR_PROVIDER}`,
      })
    }

    if (env.CONFIDENCE_ORANGE_MIN >= env.CONFIDENCE_GREEN_MIN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CONFIDENCE_ORANGE_MIN'],
        message:
          'CONFIDENCE_ORANGE_MIN doit être strictement inférieur à CONFIDENCE_GREEN_MIN, ' +
          'sinon la bande orange est vide et aucun cas ne serait signalé comme incertain.',
      })
    }

    if (env.NODE_ENV === 'production') {
      if (env.AUTH_SECRET === env.AUDIT_HASH_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AUDIT_HASH_SECRET'],
          message:
            'AUDIT_HASH_SECRET doit être distinct de AUTH_SECRET : la compromission de ' +
            "l'un ne doit pas permettre de forger une chaîne d'audit.",
        })
      }
      if (env.APP_URL.startsWith('http://')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['APP_URL'],
          message: 'APP_URL doit utiliser HTTPS en production.',
        })
      }
    }
  })

export type Env = z.infer<typeof baseSchema>

/**
 * Valide et retourne la configuration.
 *
 * En cas d'échec, lève une erreur listant TOUS les problèmes d'un coup — corriger
 * sa configuration une variable à la fois est une perte de temps.
 */
export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source)

  if (!result.success) {
    const problèmes = result.error.issues
      .map((issue) => `  · ${issue.path.join('.') || '(racine)'} : ${issue.message}`)
      .join('\n')

    throw new Error(
      `Configuration invalide — l'application ne peut pas démarrer.\n\n${problèmes}\n\n` +
        `Comparez votre fichier .env avec .env.example.`,
    )
  }

  return result.data
}

let cached: Env | undefined

/** Configuration validée, mise en cache après le premier appel. */
export function env(): Env {
  cached ??= parseEnv()
  return cached
}

/** Réinitialise le cache. Réservé aux tests. */
export function resetEnvCache(): void {
  cached = undefined
}
