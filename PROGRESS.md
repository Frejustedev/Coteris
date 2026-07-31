# Avancement de Coteris

Ce fichier est la source de vérité sur ce qui **fonctionne réellement**.

Règle absolue : rien n'est marqué terminé sans que les tests correspondants aient été
**exécutés** et **vus passer**. Une page qui s'affiche sans backend n'est pas une
fonctionnalité. Aucun résultat de mesure n'est reporté ici s'il n'a pas été produit par une
exécution réelle.

Légende : ⬜ non commencé · 🟡 en cours · ✅ terminé et testé · ⛔ bloqué

---

## État global

| Étape | Contenu | État |
|---|---|---|
| 0 | Plan, ADR, documentation fondatrice | ✅ |
| 1 | Monorepo, outillage, CI, Docker | ✅ |
| 2 | Modèle de données et migrations | ✅ |
| 3 | Moteur de barème déterministe | ✅ |
| 4 | Journal d'audit à chaîne de hash | ✅ |
| 5 | Permissions et rôles (matrice pure) | ✅ |
| 6 | Abstractions IA/OCR et fournisseur simulé | ✅ |
| 7 | Tranche verticale de bout en bout | ⬜ |
| 8+ | Approfondissement des phases | ⬜ |

**Tests exécutés à ce jour : 210, tous verts.** Dernière exécution : 2026-07-31.

```
Unitaires — 198, sans aucune infrastructure
  @coteris/shared    62  (millipoints 30, confiance 15, configuration 17)
  @coteris/grading   40  (moteur de barème)
  @coteris/database   9  (invariants de schéma)
  @coteris/audit     16  (chaîne de hash)
  @coteris/auth      29  (matrice de permissions)
  @coteris/ai        42  (validation des sorties, coûts, fournisseur simulé)

Intégration — 12, contre PostgreSQL 17 réel
  @coteris/audit     12  (verrous, détection d'altération, transactions)
```

---

## Journal détaillé

### Étape 0 — Plan et décisions d'architecture — ✅

**Réalisé**

- Dépôt initialisé (`Frejustedev/Coteris`, vide au départ).
- Capacités réelles de l'hébergeur o2switch vérifiées auprès de sa documentation
  (Node 22/24 via Passenger, PostgreSQL, Redis, SSH, cron, CloudLinux LVE).
- Décisions d'architecture rédigées et motivées.

**Fichiers produits**

| Fichier | Objet |
|---|---|
| `README.md` | Présentation, démarrage, structure |
| `PROGRESS.md` | Ce fichier |
| `docs/adr/0001-monolithe-modulaire.md` | Monolithe modulaire en monorepo TypeScript |
| `docs/adr/0002-drizzle-comme-orm.md` | Drizzle plutôt que Prisma |
| `docs/adr/0003-file-attente-postgres.md` | File dans Postgres, sans Redis |
| `docs/adr/0004-authentification-better-auth.md` | Better Auth et contrôle d'accès par ressource |
| `docs/adr/0005-deploiement-portable.md` | Portabilité d'hébergement, o2switch par défaut |
| `docs/adr/0006-arithmetique-des-points.md` | Points en entiers, millièmes |

**Migrations créées** : aucune.

**Tests exécutés** : aucun. Aucun code exécutable n'existe à ce stade.

**Limites connues**

- Le maintien d'un worker permanent sur hébergement mutualisé doit être validé auprès du
  support o2switch avant toute mise en production. Voir ADR 0005.
- Aucun jeu de copies réelles n'est disponible. Le benchmark de la phase 0 ne peut donc pas
  produire de résultat. Il sera construit et laissé en attente de données.

**Reste à faire**

- `docs/architecture.md`, `docs/data-model.md`
- ADR 0007 (pipeline de correction et frontière IA / moteur)

---

### Étape 1 — Fondations du dépôt — ✅

**Réalisé**

- Monorepo pnpm + Turborepo, TypeScript en mode strict étendu
  (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- ESLint avec les **règles de dépendance entre paquets** : le moteur de barème ne peut
  physiquement plus importer la base de données, le réseau, `Date` ou `Math.random`.
  La pureté n'est pas une convention, elle est imposée par l'outillage.
- `.env.example` complet et validation Zod au démarrage, avec dépendances conditionnelles.
- `docker-compose.yml` : PostgreSQL 17 (collation ICU `fr-FR`) et MinIO. Pas de Redis.
- CI GitHub Actions : format, lint, typage, tests unitaires, migrations idempotentes,
  build, audit des dépendances, recherche de secrets, refus d'un `.env` commité.

**Fichiers importants**

`package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`,
`eslint.config.mjs`, `.env.example`, `docker-compose.yml`, `.github/workflows/ci.yml`

**Tests exécutés** : `pnpm lint` ✅ · `pnpm typecheck` ✅ · `pnpm test` ✅

**Limites connues**

- La CI n'a pas encore été exécutée sur GitHub : les étapes `db:migrate`, `db:generate`
  et `test:integration` référencent un paquet `@coteris/database` qui n'existe pas encore.
  Le job `integration` échouera tant que l'étape 2 n'est pas faite. C'est attendu.
- Aucun dépôt distant n'a été poussé, aucun commit n'a été créé.

---

### Étape 3 — Moteur de barème déterministe — ✅

Réalisée avant les étapes 2, 4 et 5 : ce paquet ne dépend d'aucune infrastructure, il
pouvait donc être construit et vérifié exhaustivement tout de suite.

**Réalisé**

- `@coteris/shared` : arithmétique en millièmes de point (ADR 0006), niveaux de confiance,
  identifiants typés, validation de configuration.
- `@coteris/grading` : moteur pur couvrant les six types d'attribution (tout ou rien,
  partiel, points par élément, manuel, bonus, pénalité), les contradictions, les erreurs
  factuelles, les plafonds, les exclusions entre critères, les critères obligatoires et
  l'arrondi.
- Chaque opération produit une trace `AppliedRule` expliquant en français ce qui a modifié
  la valeur, et de combien. Un jury peut refaire le calcul à la main.
- Le moteur **refuse d'attribuer des points sans extrait justificatif** — et refuse aussi
  d'appliquer une pénalité non justifiée. « Aucune note sans preuve » est vérifié par le
  code, pas seulement écrit dans un document.

**Deux décisions prises en cours de route, à partir d'un test qui a échoué**

1. *Confiance* — le calcul initial faisait une moyenne pondérée où l'OCR pesait 45 %. Un
   test a montré qu'une transcription fiable à 40 % ressortait en « orange » parce qu'une
   bonne correspondance de critères la compensait. C'est faux : une correspondance calculée
   sur du texte mal lu ne vaut rien. L'OCR est devenu un **plafond multiplicatif** — on ne
   peut pas être plus confiant dans l'analyse que dans le texte qu'elle a lu.
2. *Contradiction* — modélisée comme un **drapeau indépendant** de l'état du critère, et non
   comme un état parmi d'autres. Sans cela, la règle « plafonner le critère à 50 % en cas de
   contradiction majeure » était inexprimable : elle suppose un élément à la fois présent et
   contredit. Ce découpage correspond aussi exactement au JSON d'analyse de la section 19.

**Fichiers importants**

| Fichier | Contenu |
|---|---|
| `packages/shared/src/millipoints.ts` | Arithmétique entière exacte |
| `packages/shared/src/confidence.ts` | Niveaux vert / orange / rouge |
| `packages/shared/src/env.ts` | Validation de configuration |
| `packages/grading/src/types.ts` | Frontière IA / moteur |
| `packages/grading/src/engine.ts` | Calcul et traçabilité |

**Tests exécutés — 102, tous verts**

```
✓ packages/shared/src/millipoints.test.ts   30 tests
✓ packages/shared/src/confidence.test.ts    15 tests
✓ packages/shared/src/env.test.ts           17 tests
✓ packages/grading/src/engine.test.ts       40 tests
```

Couvre notamment : le scénario iode stable / MIBG de la section 39, le déterminisme sur
1 000 exécutions, l'indépendance à l'ordre des critères reçus, et l'invariant « la note
reste dans [0, barème] » sur toutes les combinaisons d'états.

**Limites connues**

- Le moteur n'est encore appelé par rien : ni base de données, ni interface. C'est une
  brique vérifiée, pas une fonctionnalité livrée.
- `docs/grading-engine.md` reste à rédiger.

---

### Étape 2 — Modèle de données — ✅

**Réalisé**

- 38 tables, migration générée, **appliquée sur une base PostgreSQL 17 réelle**, et
  cycle complet réinitialisation → migration vérifié.
- Journal d'audit rendu **réellement** en ajout seul : trois déclencheurs bloquent
  `UPDATE`, `DELETE` et `TRUNCATE`. Les trois vecteurs ont été testés contre la base,
  pas supposés.
- Contraintes `CHECK` traduisant les règles du produit : un verrouillage porte
  toujours date **et** signataire ; une décision validée porte toujours son
  validateur ; une note publiée a nécessairement été finalisée.
- Anonymisation structurelle : `submissions` ne porte qu'un code anonyme, la
  correspondance vit dans `submission_identities`.
- 9 tests d'invariants de schéma, qui inspectent les définitions Drizzle sans base.

**Trois problèmes trouvés et corrigés en cours de route**

1. **`TRUNCATE` contournait le verrou d'audit.** Le déclencheur `BEFORE UPDATE OR
   DELETE ... FOR EACH ROW` ne se déclenche pas sur `TRUNCATE`. Une seule commande
   aurait effacé tout le journal. Corrigé par un second déclencheur de niveau
   instruction.
2. **`pnpm db:reset` laissait la base inutilisable.** `DROP SCHEMA public` ne touchait
   pas au schéma `drizzle`, où est tracé l'historique des migrations. Drizzle croyait
   donc la migration déjà appliquée et sautait la création des tables ; la migration
   suivante échouait sans raison apparente.
3. **Le nom `exports` cassait la génération.** Une constante nommée `exports` entre en
   collision avec l'objet `exports` de CommonJS quand drizzle-kit transpile le
   fichier. Renommée `exportJobs` ; la table SQL garde son nom.

**Fichiers importants**

| Fichier | Contenu |
|---|---|
| `packages/database/src/schema/*.ts` | 38 tables réparties par domaine |
| `packages/database/src/schema/schema.test.ts` | Invariants structurels |
| `packages/database/src/migrate.ts` | Migrations et durcissement de l'audit |
| `packages/database/src/reset.ts` | Réinitialisation, refusée en production |
| `packages/database/drizzle/0000_modern_chamber.sql` | Migration initiale |
| `docs/data-model.md` | Principes et chaîne de preuve |

**Migrations créées** : `0000_modern_chamber.sql` — 38 tables, index et contraintes.

**Tests exécutés** : 111 au total, tous verts. `pnpm lint` ✅ · `pnpm typecheck` ✅

**Limites connues**

- Les politiques de sécurité au niveau ligne (RLS) ne sont pas encore en place. Le
  cloisonnement repose pour l'instant sur la couche applicative. RLS viendra la
  doubler à l'étape de durcissement.
- Aucune donnée de démonstration n'existe encore : `pnpm db:seed` n'est pas implémenté.

---

### Étape 4 — Journal d'audit à chaîne de hash — ✅

**Réalisé**

- Chaîne HMAC-SHA256 **par organisation**, pas globale : deux établissements
  écrivent en parallèle sans se bloquer. Verrou consultatif de portée
  transactionnelle pour sérialiser les écritures d'une même organisation.
- `appendAuditEvent` **exige** une transaction en premier paramètre ; aucune
  variante ne s'en passe. L'audit et l'action qu'il décrit sont validés ensemble.
- Sérialisation canonique : clés triées récursivement, dates en ISO 8601 UTC,
  nombres non finis rejetés. Sans cela, un objet relu depuis `jsonb` produirait un
  hash différent de celui calculé à l'écriture.
- `verifyChain` distingue quatre types de rupture et indique la position exacte.
- Verrou en ajout seul vérifié sur les **trois** vecteurs : UPDATE, DELETE, TRUNCATE.

**Deux problèmes trouvés en testant**

1. **`pnpm test` exigeait une base de données.** Vitest ramassait les tests
   d'intégration dans la passe unitaire. Le job « qualité » de la CI, qui ne démarre
   pas PostgreSQL, aurait échoué. Corrigé par des configurations Vitest distinctes.
2. **La suppression du dernier événement n'est pas détectable** par la seule
   vérification de chaîne : aucun trou de séquence, aucun chaînage rompu. C'est une
   limite structurelle de toute chaîne de hash locale. Elle est couverte par un test
   qui **documente** le comportement au lieu de le masquer, et la parade — archiver
   hors base le dernier hash validé — est notée pour l'étape de durcissement.

**Fichiers importants**

| Fichier | Contenu |
|---|---|
| `packages/audit/src/hash.ts` | Sérialisation canonique et HMAC |
| `packages/audit/src/append.ts` | Écriture transactionnelle et verrou par organisation |
| `packages/audit/src/verify.ts` | Vérification et typologie des ruptures |
| `packages/audit/src/audit.integration.test.ts` | 12 tests contre une base réelle |
| `docs/audit-trail.md` | Garanties, limites assumées, événements obligatoires |

**Tests exécutés**

```
✓ hash.test.ts               16 tests  (sans base)
✓ audit.integration.test.ts  12 tests  (PostgreSQL 17 réel)
```

Les tests d'altération désactivent temporairement le déclencheur pour simuler un
attaquant disposant d'un accès complet à la base — la seule menace que la chaîne de
hash adresse réellement.

**Limites connues**

- La chaîne ne protège pas contre un attaquant possédant à la fois
  `AUDIT_HASH_SECRET` et un accès complet à la base. Documenté sans détour dans
  `docs/audit-trail.md` ; aucune promesse de type « blockchain » n'est faite.
- Le service applicatif qui appellera `appendAuditEvent` pour chaque action métier
  n'existe pas encore : la brique est prête, elle n'est câblée à rien.

---

### Étape 5 — Permissions et rôles — ✅ (partielle)

**Réalisé**

- Catalogue fermé de 13 ressources et de leurs actions, dans un module **pur** :
  la matrice complète des rôles tient dans un écran et se teste en mémoire.
- Trois rôles, définis par ce qu'ils **ne peuvent pas** faire autant que par ce
  qu'ils peuvent.
- `assertSameOrganization` : première défense contre les fuites entre
  établissements.
- `ForbiddenError` ne révèle jamais l'existence de la ressource visée — « vous
  n'avez pas accès à l'épreuve X » confirmerait que X existe.

**La contrainte du cahier des charges, rendue exécutable**

L'administrateur technique n'a **pas** `submissionContent: ['read']`. Ce n'est pas
un oubli : c'est l'exigence « il ne doit pas accéder au contenu des copies »
traduite en code et couverte par un test. Un modèle hiérarchique
(admin > coordonnateur > correcteur) rendait cette contrainte inexprimable, puisque
l'admin y hériterait de tout.

**Tests exécutés** : 29, tous verts. Ils portent principalement sur les refus —
correcteur qui ne peut pas verrouiller un barème, ni finaliser, ni lever
l'anonymat ; admin technique qui ne voit pas les copies ; coordonnateur de A sans
aucun droit sur B.

**Ce qui reste** : le câblage à Better Auth (sessions, inscription, invitations,
vérification d'adresse) se fera avec l'application Next.js, à l'étape suivante. La
matrice de permissions, elle, est prête et testée.

---

### Étape 6 — Abstractions IA et fournisseur simulé — ✅

**Réalisé**

- Interfaces `OcrProvider`, `TextAnalysisProvider`, `VisionAnalysisProvider`,
  `EmbeddingProvider`. Le métier ne dépend d'aucun fournisseur concret.
- Schéma Zod strict de la sortie d'analyse, correspondant au JSON de la section 19.
- **`validateEvidence`** : vérifie que chaque extrait cité figure littéralement
  dans la transcription. C'est la barrière contre la preuve inventée — le mode
  d'erreur le plus dangereux du produit, parce qu'une citation fabriquée est
  indiscernable d'une vraie à l'œil nu. Les pénalités sont vérifiées au même titre
  que les points : une sanction sans preuve est aussi contestable qu'un point non
  justifié.
- **`validateCriteriaScope`** : refuse un critère inventé par le modèle, un critère
  classé deux fois, ou une analyse incomplète — un critère oublié serait
  silencieusement noté zéro.
- Coûts en **millionièmes d'euro** (entiers), coupe-circuit vérifié **avant**
  l'appel. `computeCost` lève si le tarif est inconnu plutôt que de compter zéro :
  un modèle de coût faux produirait un prix de vente faux.
- Fournisseurs simulés déterministes, sans réseau ni dépense, couvrant le scénario
  iode stable / MIBG.

**Un bug trouvé et corrigé**

La normalisation `NFD` décompose « é » en deux caractères ; retirer ensuite les
diacritiques change la longueur de la chaîne. Les extraits retournés auraient été
**décalés de quelques caractères, silencieusement** — donc faux, tout en paraissant
plausibles. Corrigé par une table de correspondance entre positions normalisées et
positions d'origine. Un test vérifie que « protéger la thyroïde » revient intact,
accents compris.

**Tests exécutés** : 42, tous verts.

**Limites connues**

- `PRICING` ne contient que le fournisseur simulé, à zéro. **Aucun tarif réel n'est
  inventé** : ils seront ajoutés depuis les grilles publiées au moment d'intégrer
  un fournisseur.
- Le laboratoire de banc d'essai (`docs/benchmark-protocol.md`,
  `scripts/run-benchmark.ts`) n'est pas encore écrit.
- Aucun fournisseur réel n'est implémenté.

---

## Mesures

Aucune mesure n'a été effectuée. Cette section restera vide tant que le banc d'essai n'aura
pas été exécuté sur des données réelles.

| Métrique | Valeur | Date | Conditions |
|---|---|---|---|
| Accord IA-humain par critère | non mesuré | — | — |
| Précision de détection des critères | non mesuré | — | — |
| Rappel de détection des critères | non mesuré | — | — |
| Erreur moyenne sur la note | non mesuré | — | — |
| Taux de recours à la validation humaine | non mesuré | — | — |
| Fiabilité des décisions vertes | non mesuré | — | — |
| Coût d'inférence par page | non mesuré | — | — |
| Coût par copie | non mesuré | — | — |
| Durée moyenne de traitement | non mesuré | — | — |

---

## Prochaine action

Étape 2 — modèle de données : schéma Drizzle complet, migrations, contraintes et index.
C'est le préalable au journal d'audit (étape 4) et à l'authentification (étape 5).
