/**
 * Contrôle d'accès par ressource et par action.
 *
 * Un modèle hiérarchique simple (admin > coordonnateur > correcteur) ne convient
 * pas à Coteris, pour une raison précise : **l'administrateur technique ne doit
 * pas accéder au contenu des copies**. Il exploite la plateforme, il ne corrige
 * pas. Dans une hiérarchie, il hériterait de tout.
 *
 * D'où un catalogue de ressources et d'actions, où chaque rôle reçoit exactement
 * ce dont il a besoin — et rien de plus.
 *
 * Ce module est **pur** : aucune base, aucun réseau. Les permissions se testent
 * donc exhaustivement en mémoire, et la matrice complète des rôles tient dans un
 * écran.
 */

/** Catalogue fermé des ressources et des actions possibles. */
export const STATEMENTS = {
  organization: ['read', 'update', 'delete'],
  member: ['read', 'create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
  assessment: ['create', 'read', 'update', 'delete'],
  answerKey: ['create', 'read', 'update', 'validate'],
  rubric: ['create', 'read', 'update', 'validate', 'lock'],
  submission: ['create', 'read', 'delete', 'assign'],
  /** Le contenu même des copies : images, transcriptions. Distinct des métadonnées. */
  submissionContent: ['read'],
  grading: ['read', 'propose', 'review', 'finalize', 'publish'],
  /** Levée d'anonymat. La permission la plus sensible du système. */
  identity: ['reveal'],
  export: ['create', 'read'],
  audit: ['read'],
  platform: ['configure', 'operate'],
} as const

export type Resource = keyof typeof STATEMENTS
export type Action<R extends Resource> = (typeof STATEMENTS)[R][number]

export type Permissions = {
  readonly [R in Resource]?: readonly Action<R>[]
}

export type Role = 'coordinator' | 'grader' | 'tech_admin'

/**
 * Coordonnateur — responsable pédagogique de l'épreuve.
 *
 * Il prépare, valide, verrouille, distribue, suit et publie.
 */
const coordinator: Permissions = {
  organization: ['read', 'update'],
  member: ['read', 'create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
  assessment: ['create', 'read', 'update', 'delete'],
  answerKey: ['create', 'read', 'update', 'validate'],
  rubric: ['create', 'read', 'update', 'validate', 'lock'],
  submission: ['create', 'read', 'delete', 'assign'],
  submissionContent: ['read'],
  grading: ['read', 'propose', 'review', 'finalize', 'publish'],
  identity: ['reveal'],
  export: ['create', 'read'],
  audit: ['read'],
}

/**
 * Correcteur — il corrige, il ne décide pas du barème.
 *
 * Trois absences sont volontaires et structurantes :
 *   - `rubric` sans `update`, `validate` ni `lock` : un correcteur ne peut pas
 *     modifier les règles du jeu en cours de partie ;
 *   - `grading` sans `finalize` ni `publish` : il propose une décision, le
 *     coordonnateur arrête la note ;
 *   - `identity` absent : il ne lève jamais l'anonymat.
 *
 * `submission: ['read']` autorise la lecture *en principe*. La restriction aux
 * copies qui lui sont **attribuées** relève du périmètre des données, pas des
 * permissions, et est appliquée dans la couche de dépôt.
 *
 * `grading: ['propose']` lui est en revanche accordé : le cahier des charges
 * prévoit qu'un correcteur puisse « demander une nouvelle analyse », typiquement
 * après avoir corrigé une transcription. Proposer n'est pas décider.
 */
const grader: Permissions = {
  organization: ['read'],
  member: ['read'],
  assessment: ['read'],
  answerKey: ['read'],
  rubric: ['read'],
  submission: ['read'],
  submissionContent: ['read'],
  grading: ['read', 'propose', 'review'],
  export: ['read'],
}

/**
 * Administrateur technique — il exploite la plateforme.
 *
 * Absences volontaires : `submissionContent`, `grading`, `identity`, `export`,
 * `answerKey`, `rubric`. Il ne voit pas les copies, ne corrige pas, ne lève pas
 * l'anonymat et n'exporte pas de notes.
 *
 * Ce n'est pas un oubli, c'est l'exigence du cahier des charges rendue
 * exécutable — et testée.
 */
const techAdmin: Permissions = {
  organization: ['read'],
  member: ['read', 'create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
  assessment: ['read'],
  audit: ['read'],
  platform: ['configure', 'operate'],
}

export const ROLE_PERMISSIONS: Record<Role, Permissions> = {
  coordinator,
  grader,
  tech_admin: techAdmin,
}

export const ROLE_LABELS: Record<Role, string> = {
  coordinator: 'Coordonnateur',
  grader: 'Correcteur',
  tech_admin: 'Administrateur technique',
}

/**
 * Un utilisateur peut cumuler plusieurs rôles dans une organisation.
 *
 * C'est ainsi que l'offre individuelle fonctionne : dans son espace personnel,
 * l'enseignant est à la fois coordonnateur et correcteur. Aucun code spécifique
 * à « l'offre individuelle » n'existe — seulement un cumul de rôles.
 */
export interface Principal {
  readonly userId: string
  readonly organizationId: string
  readonly roles: readonly Role[]
}

/**
 * L'utilisateur a-t-il le droit d'effectuer cette action sur cette ressource ?
 *
 * Les rôles s'additionnent : il suffit qu'un seul l'autorise.
 */
export function can<R extends Resource>(
  principal: Principal,
  resource: R,
  action: Action<R>,
): boolean {
  for (const role of principal.roles) {
    const granted = ROLE_PERMISSIONS[role][resource] as readonly string[] | undefined
    if (granted?.includes(action)) return true
  }
  return false
}

/** Vrai si toutes les permissions demandées sont accordées. */
export function canAll(
  principal: Principal,
  required: readonly { resource: Resource; action: string }[],
): boolean {
  return required.every((r) => can(principal, r.resource, r.action as never))
}

export class ForbiddenError extends Error {
  readonly resource: Resource
  readonly action: string

  constructor(resource: Resource, action: string) {
    // Le message ne révèle jamais l'existence ou non de la ressource visée :
    // « vous n'avez pas accès à l'épreuve X » confirmerait que X existe.
    super("Vous n'avez pas les droits nécessaires pour effectuer cette action.")
    this.name = 'ForbiddenError'
    this.resource = resource
    this.action = action
  }
}

/**
 * Vérifie une permission ou lève.
 *
 * À appeler **côté serveur**, systématiquement, y compris quand l'interface a
 * déjà masqué le bouton correspondant. L'interface cache ; le serveur interdit.
 */
export function authorize<R extends Resource>(
  principal: Principal,
  resource: R,
  action: Action<R>,
): void {
  if (!can(principal, resource, action)) {
    throw new ForbiddenError(resource, action)
  }
}

/**
 * Vérifie que le principal agit bien dans l'organisation visée.
 *
 * Première défense contre les fuites entre établissements. Elle paraît triviale
 * — c'est précisément pour cela qu'on l'oublie.
 */
export function assertSameOrganization(principal: Principal, organizationId: string): void {
  if (principal.organizationId !== organizationId) {
    throw new ForbiddenError('organization', 'read')
  }
}

/** Rôles cumulés du propriétaire d'un espace individuel. */
export const PERSONAL_WORKSPACE_ROLES: readonly Role[] = ['coordinator', 'grader']
