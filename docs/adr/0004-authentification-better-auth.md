# ADR 0004 — Better Auth pour l'authentification et les organisations

- **Statut** : accepté
- **Date** : 2026-07-31

## Contexte

Coteris a besoin de : inscription, connexion, déconnexion, vérification d'adresse
électronique, récupération de mot de passe, sessions sécurisées, profil, et **invitation
d'un utilisateur dans une organisation**.

Toute donnée métier appartient à une organisation. Trois rôles visibles existent :
coordonnateur, correcteur, administrateur technique.

Une contrainte particulière du produit : **l'administrateur technique ne doit pas accéder
au contenu des copies sans permission explicite**. Ce n'est donc pas un super-utilisateur.
Un modèle de rôles hiérarchique simple (admin > coordonnateur > correcteur) ne peut pas
exprimer cela. Il faut un modèle par ressource et par action.

## Décision

**Better Auth**, avec son plugin `organization`, et un contrôle d'accès personnalisé décrit
par un catalogue de ressources et d'actions.

## Justification

Le plugin `organization` couvre nativement les organisations, les membres, les rôles et le
cycle de vie complet des invitations (création, acceptation, refus, annulation, liste).
C'est très exactement le périmètre des sections 7.1 à 7.3 du cahier des charges.

Surtout, son contrôle d'accès repose sur `createAccessControl`, qui définit des rôles comme
des ensembles d'actions autorisées par ressource. Cela permet d'exprimer directement la
contrainte sur l'administrateur technique :

```ts
export const statements = {
  organization:  ['update', 'delete'],
  member:        ['create', 'update', 'delete'],
  invitation:    ['create', 'cancel'],
  assessment:    ['create', 'read', 'update', 'delete'],
  answerKey:     ['create', 'read', 'update', 'validate'],
  rubric:        ['create', 'read', 'update', 'validate', 'lock'],
  submission:    ['create', 'read', 'delete', 'assign'],
  submissionContent: ['read'],      // le contenu des copies, distinct du reste
  grading:       ['read', 'propose', 'review', 'finalize', 'publish'],
  identity:      ['reveal'],        // levée d'anonymat
  export:        ['create', 'read'],
  audit:         ['read'],
  platform:      ['configure', 'operate'],
} as const

const coordonnateur = ac.newRole({
  assessment: ['create', 'read', 'update', 'delete'],
  answerKey:  ['create', 'read', 'update', 'validate'],
  rubric:     ['create', 'read', 'update', 'validate', 'lock'],
  submission: ['create', 'read', 'delete', 'assign'],
  submissionContent: ['read'],
  grading:    ['read', 'propose', 'review', 'finalize', 'publish'],
  identity:   ['reveal'],
  invitation: ['create', 'cancel'],
  member:     ['create', 'update', 'delete'],
  export:     ['create', 'read'],
  audit:      ['read'],
})

const correcteur = ac.newRole({
  assessment: ['read'],
  answerKey:  ['read'],
  rubric:     ['read'],                    // lecture seule : jamais 'update' ni 'lock'
  submission: ['read'],                    // filtré aux copies attribuées
  submissionContent: ['read'],
  grading:    ['read', 'review'],          // jamais 'finalize' ni 'publish'
})

const adminTechnique = ac.newRole({
  platform:   ['configure', 'operate'],
  audit:      ['read'],
  member:     ['create', 'update', 'delete'],
  // Volontairement absents : submissionContent, grading, identity, export.
  // L'administrateur technique exploite la plateforme, il ne voit pas les copies.
})
```

L'absence de `submissionContent: ['read']` dans le rôle d'administrateur technique n'est pas
un oubli : c'est l'exigence du cahier des charges, rendue exécutable et testable.

Better Auth fournit également `requireOrgRole`, un intergiciel serveur qui contrôle
l'appartenance et le rôle avant d'exécuter un point d'entrée — ce qui évite la faute la plus
courante, à savoir contrôler les permissions dans l'interface seulement.

## Alternatives écartées

**Authentification écrite à la main.** Deux à trois semaines de travail pour reconstruire
le hachage des mots de passe, la rotation des sessions, les jetons de vérification à usage
unique, la limitation de débit et le cycle des invitations. Chacun de ces points est une
faille potentielle, sur un produit qui manipule des copies d'examen. Le gain serait nul.

**Auth.js / NextAuth.** Excellent pour la connexion fédérée, mais sans notion
d'organisation ni de contrôle d'accès par ressource. Il aurait fallu construire toute la
couche multi-établissement par-dessus.

**Lucia.** Le projet a été réorienté vers un support d'apprentissage plutôt qu'une
bibliothèque maintenue. Écarté pour cette raison.

## Conséquences

**Positives**

- Les tables `user`, `session`, `account`, `verification`, `organization`, `member`,
  `invitation` sont fournies et s'intègrent au schéma Drizzle existant.
- Les permissions sont déclaratives, lisibles en un écran, et testables unitairement sans
  base de données.
- L'offre individuelle est obtenue sans code spécifique : le propriétaire reçoit un rôle
  cumulant coordonnateur et correcteur dans son organisation personnelle.

**Négatives**

- Dépendance à une bibliothèque tierce sur un chemin critique. Atténuation : les appels sont
  encapsulés dans `packages/auth`, le reste du code ne dépend que de nos propres types
  `Session`, `Role` et `can()`.
- Le contrôle d'accès de Better Auth ne connaît pas le **périmètre des données** : il sait
  qu'un correcteur peut lire des copies, pas *lesquelles*. La restriction aux copies
  attribuées reste de notre ressort, appliquée dans la couche de dépôt et couverte par des
  tests de sécurité dédiés.

## Règle d'application

Une permission est vérifiée **côté serveur**, systématiquement, y compris quand l'interface
a déjà masqué le bouton correspondant. L'interface cache ; le serveur interdit.
