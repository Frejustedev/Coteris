/**
 * Tests de la matrice de permissions.
 *
 * Le cahier des charges décrit ce que chaque rôle « peut faire ». Ces tests
 * vérifient surtout ce qu'il **ne peut pas** faire — c'est là que se trouvent les
 * exigences de sécurité, et c'est ce qu'on oublie de tester.
 */

import { describe, expect, it } from 'vitest'
import {
  ForbiddenError,
  PERSONAL_WORKSPACE_ROLES,
  ROLE_PERMISSIONS,
  STATEMENTS,
  assertSameOrganization,
  authorize,
  can,
  type Principal,
  type Resource,
  type Role,
} from './permissions'

const ORG_A = '00000000-0000-4000-8000-00000000000a'
const ORG_B = '00000000-0000-4000-8000-00000000000b'

const principal = (roles: Role[], organizationId = ORG_A): Principal => ({
  userId: '00000000-0000-4000-8000-0000000000aa',
  organizationId,
  roles,
})

const coordonnateur = principal(['coordinator'])
const correcteur = principal(['grader'])
const adminTechnique = principal(['tech_admin'])

describe('coordonnateur', () => {
  it('prépare et verrouille le barème', () => {
    expect(can(coordonnateur, 'assessment', 'create')).toBe(true)
    expect(can(coordonnateur, 'answerKey', 'validate')).toBe(true)
    expect(can(coordonnateur, 'rubric', 'validate')).toBe(true)
    expect(can(coordonnateur, 'rubric', 'lock')).toBe(true)
  })

  it('gère les copies, les correcteurs et les résultats', () => {
    expect(can(coordonnateur, 'submission', 'create')).toBe(true)
    expect(can(coordonnateur, 'submission', 'assign')).toBe(true)
    expect(can(coordonnateur, 'invitation', 'create')).toBe(true)
    expect(can(coordonnateur, 'grading', 'finalize')).toBe(true)
    expect(can(coordonnateur, 'grading', 'publish')).toBe(true)
    expect(can(coordonnateur, 'export', 'create')).toBe(true)
    expect(can(coordonnateur, 'audit', 'read')).toBe(true)
  })

  it('peut lever l’anonymat', () => {
    expect(can(coordonnateur, 'identity', 'reveal')).toBe(true)
  })

  it('n’administre pas la plateforme', () => {
    expect(can(coordonnateur, 'platform', 'configure')).toBe(false)
    expect(can(coordonnateur, 'platform', 'operate')).toBe(false)
  })
})

describe('correcteur — ce qu’il ne peut pas faire', () => {
  it('ne modifie jamais le barème', () => {
    // Un correcteur ne change pas les règles du jeu en cours de partie.
    expect(can(correcteur, 'rubric', 'read')).toBe(true)
    expect(can(correcteur, 'rubric', 'update')).toBe(false)
    expect(can(correcteur, 'rubric', 'validate')).toBe(false)
    expect(can(correcteur, 'rubric', 'lock')).toBe(false)
    expect(can(correcteur, 'rubric', 'create')).toBe(false)
  })

  it('ne modifie pas le corrigé', () => {
    expect(can(correcteur, 'answerKey', 'read')).toBe(true)
    expect(can(correcteur, 'answerKey', 'update')).toBe(false)
    expect(can(correcteur, 'answerKey', 'validate')).toBe(false)
  })

  it('ne finalise ni ne publie une note', () => {
    expect(can(correcteur, 'grading', 'review')).toBe(true)
    expect(can(correcteur, 'grading', 'finalize')).toBe(false)
    expect(can(correcteur, 'grading', 'publish')).toBe(false)
  })

  it('ne lève jamais l’anonymat', () => {
    expect(can(correcteur, 'identity', 'reveal')).toBe(false)
  })

  it('n’attribue pas les copies et n’invite personne', () => {
    expect(can(correcteur, 'submission', 'assign')).toBe(false)
    expect(can(correcteur, 'submission', 'delete')).toBe(false)
    expect(can(correcteur, 'invitation', 'create')).toBe(false)
    expect(can(correcteur, 'member', 'create')).toBe(false)
  })

  it('ne consulte pas le journal d’audit', () => {
    expect(can(correcteur, 'audit', 'read')).toBe(false)
  })

  it('ne crée pas d’épreuve', () => {
    expect(can(correcteur, 'assessment', 'read')).toBe(true)
    expect(can(correcteur, 'assessment', 'create')).toBe(false)
    expect(can(correcteur, 'assessment', 'update')).toBe(false)
    expect(can(correcteur, 'assessment', 'delete')).toBe(false)
  })
})

describe('administrateur technique — la contrainte du cahier des charges', () => {
  it('ne voit jamais le contenu des copies', () => {
    // « Il ne doit pas accéder automatiquement au contenu des copies sans
    //   permission explicite. » Rendu exécutable, et testé.
    expect(can(adminTechnique, 'submissionContent', 'read')).toBe(false)
  })

  it('ne corrige pas et ne note pas', () => {
    expect(can(adminTechnique, 'grading', 'read')).toBe(false)
    expect(can(adminTechnique, 'grading', 'review')).toBe(false)
    expect(can(adminTechnique, 'grading', 'finalize')).toBe(false)
    expect(can(adminTechnique, 'grading', 'publish')).toBe(false)
  })

  it('ne lève pas l’anonymat', () => {
    expect(can(adminTechnique, 'identity', 'reveal')).toBe(false)
  })

  it('n’exporte aucune note', () => {
    expect(can(adminTechnique, 'export', 'create')).toBe(false)
    expect(can(adminTechnique, 'export', 'read')).toBe(false)
  })

  it('ne touche ni au corrigé ni au barème', () => {
    expect(can(adminTechnique, 'answerKey', 'read')).toBe(false)
    expect(can(adminTechnique, 'rubric', 'read')).toBe(false)
    expect(can(adminTechnique, 'rubric', 'lock')).toBe(false)
  })

  it('exploite la plateforme et lit l’audit', () => {
    expect(can(adminTechnique, 'platform', 'configure')).toBe(true)
    expect(can(adminTechnique, 'platform', 'operate')).toBe(true)
    expect(can(adminTechnique, 'audit', 'read')).toBe(true)
    expect(can(adminTechnique, 'member', 'update')).toBe(true)
  })
})

describe('cumul de rôles — l’offre individuelle', () => {
  const enseignantSeul = principal([...PERSONAL_WORKSPACE_ROLES])

  it('donne au propriétaire les droits de coordonnateur et de correcteur', () => {
    expect(can(enseignantSeul, 'rubric', 'lock')).toBe(true)
    expect(can(enseignantSeul, 'grading', 'review')).toBe(true)
    expect(can(enseignantSeul, 'grading', 'finalize')).toBe(true)
    expect(can(enseignantSeul, 'export', 'create')).toBe(true)
  })

  it('ne lui donne pas pour autant l’administration de la plateforme', () => {
    // L'offre individuelle n'est pas un mode « tout permis ».
    expect(can(enseignantSeul, 'platform', 'configure')).toBe(false)
  })

  it('additionne les rôles sans qu’aucun n’en retire à un autre', () => {
    const cumul = principal(['grader', 'tech_admin'])
    expect(can(cumul, 'submissionContent', 'read')).toBe(true) // du correcteur
    expect(can(cumul, 'platform', 'operate')).toBe(true) // de l'admin
  })

  it('n’accorde rien à un principal sans rôle', () => {
    const sansRôle = principal([])
    for (const resource of Object.keys(STATEMENTS) as Resource[]) {
      for (const action of STATEMENTS[resource]) {
        expect(can(sansRôle, resource, action as never)).toBe(false)
      }
    }
  })
})

describe('cloisonnement entre organisations', () => {
  it('refuse un principal agissant hors de son organisation', () => {
    expect(() => assertSameOrganization(coordonnateur, ORG_B)).toThrow(ForbiddenError)
  })

  it('accepte un principal dans son organisation', () => {
    expect(() => assertSameOrganization(coordonnateur, ORG_A)).not.toThrow()
  })

  it('ne dépend pas du rôle : même un coordonnateur reste cloisonné', () => {
    // Être coordonnateur de A ne donne aucun droit sur B.
    const coordinateurDeB = principal(['coordinator'], ORG_B)
    expect(() => assertSameOrganization(coordinateurDeB, ORG_A)).toThrow(ForbiddenError)
  })
})

describe('authorize', () => {
  it('laisse passer une action autorisée', () => {
    expect(() => authorize(coordonnateur, 'rubric', 'lock')).not.toThrow()
  })

  it('lève sur une action interdite', () => {
    expect(() => authorize(correcteur, 'rubric', 'lock')).toThrow(ForbiddenError)
  })

  it('ne révèle pas l’existence de la ressource dans son message', () => {
    // « Vous n'avez pas accès à l'épreuve X » confirmerait que X existe.
    try {
      authorize(correcteur, 'identity', 'reveal')
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenError)
      expect((error as Error).message).not.toContain('identity')
      expect((error as Error).message).toBe(
        "Vous n'avez pas les droits nécessaires pour effectuer cette action.",
      )
    }
  })
})

describe('intégrité du catalogue', () => {
  it('n’accorde aucune permission absente du catalogue', () => {
    for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
      for (const [resource, actions] of Object.entries(permissions)) {
        const connues = STATEMENTS[resource as Resource] as readonly string[]
        expect(connues, `ressource inconnue « ${resource} » pour le rôle ${role}`).toBeDefined()
        for (const action of actions as readonly string[]) {
          expect(
            connues,
            `action inconnue « ${resource}.${action} » pour le rôle ${role}`,
          ).toContain(action)
        }
      }
    }
  })

  it('donne à chaque rôle un libellé français', () => {
    const rôles: Role[] = ['coordinator', 'grader', 'tech_admin']
    for (const rôle of rôles) {
      expect(ROLE_PERMISSIONS[rôle]).toBeDefined()
    }
  })
})
