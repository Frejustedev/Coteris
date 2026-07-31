/**
 * Dépendances partagées par les tâches du worker.
 *
 * Le worker possède **son propre pool de connexions**, distinct de celui de
 * l'application web. Un pic de traitements ne doit pas affamer les requêtes des
 * enseignants en train de corriger.
 */

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import { createMockOcrProvider, createMockTextAnalysisProvider } from '@coteris/ai'
import type { OcrProvider, TextAnalysisProvider } from '@coteris/ai'
import { createStorage, type StorageDriver } from '@coteris/storage'

export interface WorkerContext {
  readonly db: ReturnType<typeof drizzle>
  readonly storage: StorageDriver
  readonly ocr: OcrProvider
  readonly analyzer: TextAnalysisProvider
  readonly auditSecret: string
  readonly promptVersion: number
  readonly close: () => Promise<void>
}

function requis(nom: string): string {
  const valeur = process.env[nom]
  if (!valeur) throw new Error(`${nom} est requis.`)
  return valeur
}

export function createContext(): WorkerContext {
  const url = requis('DATABASE_URL')

  const auditSecret = requis('AUDIT_HASH_SECRET')
  if (auditSecret.length < 32) {
    throw new Error('AUDIT_HASH_SECRET doit faire au moins 32 caractères.')
  }

  const client = postgres(url, {
    max: Number(process.env['WORKER_POOL_SIZE'] ?? 5),
    onnotice: () => {},
    debug: false,
  })

  const storageDriver = process.env['STORAGE_DRIVER'] ?? 'local'
  const storage = createStorage(
    storageDriver === 's3'
      ? {
          driver: 's3',
          endpoint: requis('S3_ENDPOINT'),
          region: process.env['S3_REGION'] ?? 'us-east-1',
          bucket: requis('S3_BUCKET'),
          accessKey: requis('S3_ACCESS_KEY'),
          secretKey: requis('S3_SECRET_KEY'),
          forcePathStyle: process.env['S3_FORCE_PATH_STYLE'] !== 'false',
        }
      : { driver: 'local', path: requis('STORAGE_LOCAL_PATH') },
  )

  // Seuls les fournisseurs simulés sont implémentés. Les autres seront ajoutés
  // après la phase de banc d'essai, qui doit décider lequel retenir — choisir
  // avant de mesurer serait exactement ce que le cahier des charges interdit.
  const fournisseurIa = process.env['AI_PROVIDER'] ?? 'mock'
  const fournisseurOcr = process.env['OCR_PROVIDER'] ?? 'mock'
  if (fournisseurIa !== 'mock' || fournisseurOcr !== 'mock') {
    throw new Error(
      `Fournisseur « ${fournisseurIa} / ${fournisseurOcr} » non implémenté. ` +
        'Seul le fournisseur simulé existe à ce stade ; voir docs/benchmark-protocol.md.',
    )
  }

  return {
    // Aucun schéma relationnel n'est passé : le worker n'utilise que du SQL
    // explicite et des insertions sur des tables nommées. L'indexation
    // relationnelle de Drizzle n'apporterait rien et impose de lui fournir un
    // objet ne contenant que des tables.
    db: drizzle(client, { casing: 'snake_case' }),
    storage,
    ocr: createMockOcrProvider(),
    analyzer: createMockTextAnalysisProvider(),
    auditSecret,
    promptVersion: Number(process.env['AI_PROMPT_VERSION'] ?? 1),
    close: () => client.end(),
  }
}
