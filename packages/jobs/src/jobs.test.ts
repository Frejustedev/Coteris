import { describe, expect, it, vi } from 'vitest'

import {
  JobPayloadError,
  PAYLOAD_SCHEMAS,
  RETRY_POLICY,
  TASKS,
  addJob,
  parsePayload,
  type JobTransaction,
} from './index'

const UUID = '11111111-1111-4111-8111-111111111111'

const chargeValide = {
  organizationId: UUID,
  submissionId: UUID,
  answerRegionId: UUID,
  questionId: UUID,
  forceSecondPass: false,
  requestedBy: null,
}

function transactionFactice(): JobTransaction & { appels: unknown[] } {
  const appels: unknown[] = []
  return {
    appels,
    execute: (query: unknown) => {
      appels.push(query)
      return Promise.resolve([])
    },
  }
}

describe('catalogue des tâches', () => {
  it('déclare un schéma pour chaque tâche', () => {
    for (const nom of Object.values(TASKS)) {
      expect(PAYLOAD_SCHEMAS[nom], `schéma manquant pour ${nom}`).toBeDefined()
    }
  })

  it('déclare une politique de reprise pour chaque tâche', () => {
    for (const nom of Object.values(TASKS)) {
      expect(RETRY_POLICY[nom], `politique manquante pour ${nom}`).toBeDefined()
      // Un nombre de tentatives modeste : réessayer douze fois un job voué à
      // échouer coûte cher et masque le vrai problème.
      expect(RETRY_POLICY[nom].maxAttempts).toBeGreaterThanOrEqual(1)
      expect(RETRY_POLICY[nom].maxAttempts).toBeLessThanOrEqual(5)
    }
  })
})

describe('validation des charges utiles', () => {
  it('accepte une charge bien formée', async () => {
    const tx = transactionFactice()
    await addJob(tx, TASKS.ANALYZE_REGION, chargeValide)
    expect(tx.appels).toHaveLength(1)
  })

  it('refuse une charge incomplète à l’écriture', async () => {
    // Mieux vaut refuser au moment où l'on sait encore quelle action a produit
    // le job, plutôt que de le voir échouer trois heures plus tard.
    const tx = transactionFactice()
    await expect(
      addJob(tx, TASKS.ANALYZE_REGION, { organizationId: UUID }),
    ).rejects.toThrow(JobPayloadError)
    expect(tx.appels).toHaveLength(0)
  })

  it('refuse un identifiant qui n’est pas un UUID', async () => {
    const tx = transactionFactice()
    await expect(
      addJob(tx, TASKS.ANALYZE_REGION, { ...chargeValide, submissionId: 'copie-1' }),
    ).rejects.toThrow(JobPayloadError)
  })

  it('applique les valeurs par défaut', () => {
    const charge = parsePayload(TASKS.ANALYZE_REGION, {
      organizationId: UUID,
      submissionId: UUID,
      answerRegionId: UUID,
      questionId: UUID,
    })
    expect(charge.forceSecondPass).toBe(false)
    expect(charge.requestedBy).toBeNull()
  })

  it('valide aussi à la lecture', () => {
    // Un job survit aux redéploiements : il peut avoir été écrit par une version
    // de l'application et lu par la suivante.
    expect(() => parsePayload(TASKS.ANALYZE_REGION, { champ: 'inconnu' })).toThrow(
      JobPayloadError,
    )
  })

  it('nomme le champ fautif dans le message', () => {
    try {
      parsePayload(TASKS.EXPORT, { organizationId: UUID })
      expect.unreachable()
    } catch (error) {
      expect((error as Error).message).toContain('exportId')
    }
  })

  it('exige un motif pour une recorrection', () => {
    // Une recorrection modifie des notes déjà proposées : elle doit dire pourquoi.
    expect(() =>
      parsePayload(TASKS.REGRADE, {
        organizationId: UUID,
        assessmentId: UUID,
        rubricVersionId: UUID,
      }),
    ).toThrow(JobPayloadError)

    expect(() =>
      parsePayload(TASKS.REGRADE, {
        organizationId: UUID,
        assessmentId: UUID,
        rubricVersionId: UUID,
        reason: 'Nouvelle version du barème après acceptation d’une formulation',
      }),
    ).not.toThrow()
  })
})

describe('mise en file', () => {
  it('exige une transaction — il n’existe aucune variante sans', () => {
    // La signature l'impose : le premier paramètre est la transaction. C'est la
    // raison d'être du choix d'une file dans PostgreSQL (ADR 0003).
    expect(addJob.length).toBeGreaterThanOrEqual(3)
  })

  it('transmet la politique de reprise de la tâche', async () => {
    const tx = transactionFactice()
    const espion = vi.spyOn(tx, 'execute')
    await addJob(tx, TASKS.ANALYZE_REGION, chargeValide)

    const requête = JSON.stringify(espion.mock.calls[0]?.[0])
    expect(requête).toContain(String(RETRY_POLICY[TASKS.ANALYZE_REGION].maxAttempts))
  })

  it('accepte une clé d’unicité', async () => {
    // Un correcteur qui clique deux fois ne doit pas déclencher deux appels d'IA.
    const tx = transactionFactice()
    await addJob(tx, TASKS.ANALYZE_REGION, chargeValide, { jobKey: 'analyse:region-1' })
    expect(JSON.stringify(tx.appels[0])).toContain('analyse:region-1')
  })
})
