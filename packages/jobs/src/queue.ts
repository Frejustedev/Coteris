/**
 * Mise en file des travaux.
 *
 * **La fonction exige une transaction.** Il n'existe pas de variante qui s'en
 * passe, et c'est la raison d'être du choix d'une file dans PostgreSQL
 * (voir docs/adr/0003-file-attente-postgres.md).
 *
 * Avec une file externe, ce code contiendrait une faute irréductible :
 *
 *   await db.insert(submissions).values(copie)   // transaction validée
 *   await queue.add('ocr', { submissionId })     // et si ça échoue ici ?
 *
 * La copie existerait en base sans jamais être traitée, et l'enseignant verrait
 * une copie éternellement « en attente ». Le symétrique est pire : le job part,
 * la transaction est annulée, le worker traite une copie inexistante.
 *
 * `graphile_worker.add_job` étant une fonction SQL, l'insertion du job participe
 * à la transaction de l'appelant. Les trois écritures — donnée métier, audit,
 * job — sont validées ensemble ou pas du tout.
 */

import { sql } from 'drizzle-orm'

import { PAYLOAD_SCHEMAS, RETRY_POLICY, type TaskName } from './tasks'

/**
 * Transaction Drizzle, typée structurellement pour ne pas dépendre de la forme
 * exacte du client, qui varie selon le pilote.
 */
export interface JobTransaction {
  execute(query: unknown): Promise<unknown>
}

export interface AddJobOptions {
  /** Exécution différée. */
  readonly runAt?: Date
  /** Priorité : plus le nombre est bas, plus le job passe tôt. */
  readonly priority?: number
  /**
   * Clé d'unicité. Deux mises en file avec la même clé ne produisent qu'un job.
   *
   * Indispensable pour la ré-analyse : un correcteur qui clique deux fois ne doit
   * pas déclencher deux appels d'IA facturés.
   */
  readonly jobKey?: string
}

export class JobPayloadError extends Error {
  constructor(task: string, détail: string) {
    super(`Charge utile invalide pour la tâche « ${task} » : ${détail}`)
    this.name = 'JobPayloadError'
  }
}

/**
 * Ajoute un job dans la transaction courante.
 *
 * La charge utile est validée **à l'écriture** autant qu'à la lecture : mieux
 * vaut refuser un job mal formé au moment où l'on sait encore quelle action l'a
 * produit, plutôt que de le voir échouer trois heures plus tard dans le worker.
 */
export async function addJob(
  tx: JobTransaction,
  task: TaskName,
  payload: unknown,
  options: AddJobOptions = {},
): Promise<void> {
  const schéma = PAYLOAD_SCHEMAS[task]
  const analyse = schéma.safeParse(payload)
  if (!analyse.success) {
    throw new JobPayloadError(
      task,
      analyse.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join(', '),
    )
  }

  const maxAttempts = RETRY_POLICY[task].maxAttempts

  await tx.execute(sql`
    SELECT graphile_worker.add_job(
      identifier   => ${task},
      payload      => ${JSON.stringify(analyse.data)}::json,
      run_at       => ${options.runAt ? options.runAt.toISOString() : null}::timestamptz,
      max_attempts => ${maxAttempts},
      job_key      => ${options.jobKey ?? null},
      priority     => ${options.priority ?? 0}
    )
  `)
}

/**
 * Valide et retourne la charge utile d'un job à l'exécution.
 *
 * Un job survit aux redéploiements : il peut avoir été écrit par une version de
 * l'application et lu par la suivante.
 */
export function parsePayload<T extends TaskName>(
  task: T,
  payload: unknown,
): ReturnType<(typeof PAYLOAD_SCHEMAS)[T]['parse']> {
  const analyse = PAYLOAD_SCHEMAS[task].safeParse(payload)
  if (!analyse.success) {
    throw new JobPayloadError(
      task,
      analyse.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join(', '),
    )
  }
  return analyse.data as ReturnType<(typeof PAYLOAD_SCHEMAS)[T]['parse']>
}
