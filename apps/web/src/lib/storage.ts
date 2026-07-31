import 'server-only'

/**
 * Accès au stockage depuis l'application web.
 *
 * Les fichiers de copies ne sont jamais servis directement par le serveur web ni
 * exposés par une URL pré-signée du fournisseur. Ils passent par
 * `/api/fichiers/…`, qui vérifie d'abord la session et la permission, puis le
 * jeton. Un seul chemin d'accès, identique quel que soit le pilote.
 */

import { createStorage, signAccess, type StorageDriver } from '@coteris/storage'

const globalForStorage = globalThis as unknown as { __coterisStorage?: StorageDriver }

function config() {
  const driver = (process.env['STORAGE_DRIVER'] ?? 'local') as 'local' | 's3'

  if (driver === 'local') {
    const path = process.env['STORAGE_LOCAL_PATH']
    if (!path) throw new Error('STORAGE_LOCAL_PATH est requis quand STORAGE_DRIVER=local.')
    return { driver: 'local' as const, path }
  }

  const requis = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const
  for (const clé of requis) {
    if (!process.env[clé]) throw new Error(`${clé} est requis quand STORAGE_DRIVER=s3.`)
  }

  return {
    driver: 's3' as const,
    endpoint: process.env['S3_ENDPOINT'] as string,
    region: process.env['S3_REGION'] ?? 'us-east-1',
    bucket: process.env['S3_BUCKET'] as string,
    accessKey: process.env['S3_ACCESS_KEY'] as string,
    secretKey: process.env['S3_SECRET_KEY'] as string,
    forcePathStyle: process.env['S3_FORCE_PATH_STYLE'] !== 'false',
  }
}

export function storage(): StorageDriver {
  globalForStorage.__coterisStorage ??= createStorage(config())
  return globalForStorage.__coterisStorage
}

export function storageSecret(): string {
  const secret = process.env['AUTH_SECRET']
  if (!secret || secret.length < 32) {
    throw new Error('AUTH_SECRET est requis pour signer les accès aux fichiers.')
  }
  return secret
}

function ttl(): number {
  const valeur = Number(process.env['STORAGE_SIGNED_URL_TTL'] ?? 300)
  return Number.isFinite(valeur) && valeur > 0 && valeur <= 3600 ? valeur : 300
}

/**
 * URL signée d'un fichier, valable quelques minutes.
 *
 * À n'appeler qu'après avoir vérifié que l'utilisateur a le droit de voir le
 * fichier : le jeton évite de refaire ce contrôle à chaque image chargée, il ne
 * le remplace pas.
 */
export function signedFileUrl(key: string, organizationId: string): string {
  const { token } = signAccess(key, organizationId, storageSecret(), ttl(), Date.now())
  return `/api/fichiers/${key.split('/').map(encodeURIComponent).join('/')}?jeton=${encodeURIComponent(token)}`
}
