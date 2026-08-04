/**
 * Dépendances partagées par les tâches du worker.
 *
 * Le worker possède **son propre pool de connexions**, distinct de celui de
 * l'application web. Un pic de traitements ne doit pas affamer les requêtes des
 * enseignants en train de corriger.
 */

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import {
  createAnthropicTextAnalysisProvider,
  createMockOcrProvider,
  createMockTextAnalysisProvider,
  MODELE_PAR_DEFAUT,
} from '@coteris/ai'
import type { OcrProvider, TextAnalysisProvider } from '@coteris/ai'
import { createStorage, type StorageDriver } from '@coteris/storage'

export interface WorkerContext {
  readonly db: ReturnType<typeof drizzle>
  readonly storage: StorageDriver
  readonly ocr: OcrProvider
  readonly analyzer: TextAnalysisProvider
  /**
   * Modèle effectivement appelé.
   *
   * Il n'est nulle part ailleurs : `TextAnalysisProvider` n'expose qu'un `name`,
   * et le modèle n'apparaît que dans l'usage rapporté APRÈS l'appel. Or le
   * coupe-circuit doit estimer un coût AVANT, et une estimation a besoin du
   * tarif, donc du modèle.
   */
  readonly analyzerModel: string
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

  // AI_PROVIDER est REQUIS, sans repli silencieux.
  //
  // Un `?? 'mock'` ferait démarrer le worker normalement et corriger de vraies
  // copies par correspondance lexicale, sans un seul message. Le scénario n'est
  // pas théorique : en production le worker est relancé par cron via
  // scripts/worker-watchdog.sh, qui n'exporte aucune variable, et aucun code du
  // dépôt ne lit de fichier .env. Mieux vaut un démarrage refusé qu'une épreuve
  // entière corrigée par le simulateur à l'insu de tous.
  const fournisseurIa = requis('AI_PROVIDER')
  const fournisseurOcr = process.env['OCR_PROVIDER'] ?? 'mock'

  // L'OCR reste au simulateur : le choix d'un moteur de lecture ne peut pas être
  // fait avant d'avoir mesuré sur de vraies copies manuscrites, et le banc
  // d'essai refuse explicitement de trancher sur des transcriptions parfaites.
  if (fournisseurOcr !== 'mock') {
    throw new Error(
      `Fournisseur OCR « ${fournisseurOcr} » non implémenté. Aucun moteur de lecture n'a ` +
        'encore été mesuré ; voir docs/benchmark-protocol.md.',
    )
  }

  const analyzerModel =
    fournisseurIa === 'anthropic'
      ? (process.env['AI_MODEL'] ?? MODELE_PAR_DEFAUT)
      : 'mock-analysis'

  const analyzer =
    fournisseurIa === 'anthropic'
      ? createAnthropicTextAnalysisProvider({
          apiKey: requis('AI_API_KEY'),
          model: analyzerModel,
        })
      : fournisseurIa === 'mock'
        ? createMockTextAnalysisProvider()
        : (() => {
            throw new Error(
              `Fournisseur d'analyse « ${fournisseurIa} » non implémenté. ` +
                "Valeurs acceptées : mock, anthropic.",
            )
          })()

  // Le fournisseur effectivement retenu est journalisé au démarrage : sans cela,
  // rien ne distingue un worker qui corrige avec un modèle d'un worker qui
  // corrige avec le simulateur.
  console.warn(
    `[worker] analyse : ${fournisseurIa}` +
      (fournisseurIa === 'anthropic' ? ` (${process.env['AI_MODEL'] ?? MODELE_PAR_DEFAUT})` : '') +
      ` · lecture : ${fournisseurOcr}`,
  )

  return {
    // Aucun schéma relationnel n'est passé : le worker n'utilise que du SQL
    // explicite et des insertions sur des tables nommées. L'indexation
    // relationnelle de Drizzle n'apporterait rien et impose de lui fournir un
    // objet ne contenant que des tables.
    db: drizzle(client, { casing: 'snake_case' }),
    storage,
    ocr: createMockOcrProvider(),
    analyzer,
    analyzerModel,
    auditSecret,
    promptVersion: Number(process.env['AI_PROMPT_VERSION'] ?? 1),
    close: () => client.end(),
  }
}
