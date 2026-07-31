# ADR 0002 — Drizzle comme ORM

- **Statut** : accepté
- **Date** : 2026-07-31

## Contexte

Coteris repose sur PostgreSQL avec un schéma relationnel dense : une trentaine de tables,
du versionnement immuable (sujets, corrigés, barèmes), une chaîne de hash d'audit, et des
requêtes qui sortent du cadre CRUD :

- prise de travaux concurrente avec `FOR UPDATE SKIP LOCKED` ;
- verrouillage consultatif (`pg_advisory_xact_lock`) pour sérialiser l'écriture de la
  chaîne d'audit par organisation ;
- agrégations statistiques (distribution des notes, taux de modification par critère,
  coûts d'inférence agrégés) ;
- politiques de sécurité au niveau ligne (RLS) exigeant `SET LOCAL` par transaction.

L'hébergement cible inclut du mutualisé CloudLinux, sans droits root et sans possibilité
d'installer des bibliothèques système (voir ADR 0005).

## Décision

**Drizzle ORM** avec `drizzle-kit` pour les migrations.

## Justification

**Aucun binaire natif.** Drizzle est du TypeScript pur au-dessus d'un pilote Postgres.
C'est décisif : sur CloudLinux, faire correspondre un moteur compilé à la bonne version de
glibc est une source d'échec de déploiement que nous ne pouvons pas déboguer sans accès
root. Drizzle supprime entièrement cette classe de problème.

**Le SQL reste accessible.** Drizzle assume d'être une fine couche typée au-dessus de SQL
plutôt qu'une abstraction qui le masque. Nos requêtes les plus critiques — file d'attente,
audit, statistiques — sont précisément celles qu'un ORM de haut niveau rend pénibles à
exprimer.

**Migrations lisibles.** `drizzle-kit` génère du SQL que l'on relit et amende à la main.
Sur un produit dont l'argument de vente est la traçabilité, savoir exactement ce qu'une
migration fait à une table d'audit n'est pas un luxe.

**Transactions explicites.** L'écriture métier, son événement d'audit et la mise en file du
job doivent partager une transaction (ADR 0003). Drizzle expose cela sans détour.

## Alternative écartée : Prisma

Prisma offre une meilleure ergonomie sur les relations imbriquées, ce qui aurait compté vu
la taille du schéma. Il a été écarté pour trois raisons :

1. Le client s'appuie historiquement sur un moteur binaire dont la cible doit correspondre
   à la plateforme — risque direct sur l'hébergement mutualisé visé.
2. Une part significative de nos requêtes critiques serait tombée dans `$queryRaw`, perdant
   le bénéfice du typage tout en payant le coût de l'abstraction.
3. Le poids du client pèse sur le démarrage à froid, ce qui compte si l'application est un
   jour déployée en environnement sans serveur.

Prisma resterait un choix défendable sur un déploiement exclusivement conteneurisé. Il ne
l'est pas ici, car la portabilité de l'hébergement est une exigence (ADR 0005).

## Conséquences

**Positives**

- Le paquet `database` s'installe et s'exécute sur n'importe quel Node 22+ sans étape de
  compilation.
- Les migrations sont relues en revue de code comme du SQL ordinaire.
- La mise en place de RLS (`SET LOCAL app.current_org_id`) est directe.

**Négatives**

- Les lectures profondément imbriquées demandent plus de code qu'avec Prisma. Atténuation :
  les accès aux données passent par des fonctions de dépôt nommées dans
  `packages/database/src/repositories`, jamais par des requêtes ad hoc dans les composants.
- L'écosystème d'outils annexes est plus restreint. Sans impact identifié pour la V1.

## Règle d'application

Toute fonction de dépôt qui lit ou écrit une donnée métier **doit** accepter un
`organizationId` en paramètre explicite. Aucune exception. Cette contrainte est vérifiée par
les tests de sécurité inter-organisations et constitue notre première défense contre les
fuites entre établissements ; RLS est la seconde.
