import { describe, expect, it } from 'vitest'
import { parseEnv } from './env'

const SECRET_A = 'a'.repeat(48)
const SECRET_B = 'b'.repeat(48)

const valide: Record<string, string> = {
  NODE_ENV: 'development',
  APP_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://coteris:coteris@localhost:5432/coteris',
  AUTH_SECRET: SECRET_A,
  AUDIT_HASH_SECRET: SECRET_B,
  STORAGE_DRIVER: 'local',
  STORAGE_LOCAL_PATH: './.data/storage',
  MAIL_DRIVER: 'console',
  MAIL_FROM: 'Coteris <no-reply@coteris.local>',
}

describe('env — configuration valide', () => {
  it('accepte une configuration de développement complète', () => {
    const env = parseEnv(valide)
    expect(env.NODE_ENV).toBe('development')
    expect(env.STORAGE_DRIVER).toBe('local')
    expect(env.AI_PROVIDER).toBe('mock')
  })

  it('applique les valeurs par défaut', () => {
    const env = parseEnv(valide)
    expect(env.DATABASE_POOL_SIZE).toBe(10)
    expect(env.CONFIDENCE_GREEN_MIN).toBe(90)
    expect(env.CONFIDENCE_ORANGE_MIN).toBe(65)
    expect(env.WORKER_CONCURRENCY).toBe(4)
  })

  it('convertit les nombres et booléens depuis leur forme textuelle', () => {
    const env = parseEnv({ ...valide, DATABASE_POOL_SIZE: '25', SMTP_SECURE: 'true' })
    expect(env.DATABASE_POOL_SIZE).toBe(25)
    expect(env.SMTP_SECURE).toBe(true)
  })
})

describe('env — refus de démarrer', () => {
  it('refuse un secret laissé à sa valeur d’exemple', () => {
    expect(() =>
      parseEnv({ ...valide, AUTH_SECRET: 'remplacez-moi-par-un-secret-de-32-octets-minimum' }),
    ).toThrow(/valeur d'exemple/)
  })

  it('refuse un secret trop court', () => {
    expect(() => parseEnv({ ...valide, AUTH_SECRET: 'trop-court' })).toThrow(/32 caractères/)
  })

  it('refuse une URL de base de données non PostgreSQL', () => {
    expect(() => parseEnv({ ...valide, DATABASE_URL: 'mysql://localhost/coteris' })).toThrow()
  })

  it('signale tous les problèmes d’un coup', () => {
    let message = ''
    try {
      parseEnv({ ...valide, AUTH_SECRET: 'court', APP_URL: 'pas-une-url' })
    } catch (error) {
      message = error instanceof Error ? error.message : ''
    }
    expect(message).toContain('AUTH_SECRET')
    expect(message).toContain('APP_URL')
  })
})

describe('env — dépendances conditionnelles', () => {
  it('exige la configuration S3 quand le pilote s3 est choisi', () => {
    expect(() => parseEnv({ ...valide, STORAGE_DRIVER: 's3' })).toThrow(/S3_BUCKET/)
  })

  it('accepte le pilote s3 correctement configuré', () => {
    const env = parseEnv({
      ...valide,
      STORAGE_DRIVER: 's3',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_BUCKET: 'coteris',
      S3_ACCESS_KEY: 'coteris',
      S3_SECRET_KEY: 'coteris-dev-secret',
    })
    expect(env.STORAGE_DRIVER).toBe('s3')
  })

  it('exige un chemin local quand le pilote local est choisi', () => {
    const { STORAGE_LOCAL_PATH: _omis, ...sansChemin } = valide
    expect(() => parseEnv(sansChemin)).toThrow(/STORAGE_LOCAL_PATH/)
  })

  it('exige une clé d’API dès qu’un fournisseur réel est déclaré', () => {
    expect(() => parseEnv({ ...valide, OCR_PROVIDER: 'google' })).toThrow(/OCR_API_KEY/)
    expect(() => parseEnv({ ...valide, AI_PROVIDER: 'anthropic' })).toThrow(/AI_API_KEY/)
  })

  it('n’exige aucune clé pour le fournisseur simulé', () => {
    expect(() => parseEnv({ ...valide, AI_PROVIDER: 'mock', OCR_PROVIDER: 'mock' })).not.toThrow()
  })

  it('refuse des seuils qui videraient la bande orange', () => {
    expect(() =>
      parseEnv({ ...valide, CONFIDENCE_GREEN_MIN: '70', CONFIDENCE_ORANGE_MIN: '80' }),
    ).toThrow(/CONFIDENCE_ORANGE_MIN/)
  })
})

describe('env — durcissement en production', () => {
  const production = { ...valide, NODE_ENV: 'production', APP_URL: 'https://coteris.example' }

  it('accepte une configuration de production correcte', () => {
    expect(() => parseEnv(production)).not.toThrow()
  })

  it('refuse HTTP en production', () => {
    expect(() => parseEnv({ ...production, APP_URL: 'http://coteris.example' })).toThrow(/HTTPS/)
  })

  it('refuse que le secret d’audit soit identique au secret de session', () => {
    // La compromission du secret de session ne doit pas permettre de forger
    // une chaîne d'audit.
    expect(() => parseEnv({ ...production, AUDIT_HASH_SECRET: SECRET_A })).toThrow(
      /distinct de AUTH_SECRET/,
    )
  })

  it('tolère des secrets identiques hors production, pour ne pas gêner les tests', () => {
    expect(() => parseEnv({ ...valide, AUDIT_HASH_SECRET: SECRET_A })).not.toThrow()
  })
})
