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
| 6bis | Pipeline de correction (logique métier) | ✅ |
| 6ter | Données de démonstration réelles | ✅ |
| 7 | Interface web — lecture et correction | ✅ |
| 8 | Validation humaine — actions câblées | ✅ |
| 9 | Stockage des fichiers | ✅ |
| 10 | Worker et file de travaux | ✅ |
| 11 | Exports CSV et rapport d'audit | ✅ |
| 12 | Import de copies | ✅ |
| 13 | Segmentation réelle, banc d'essai, PDF corrigé | ⬜ |
| 8+ | Approfondissement des phases | ⬜ |

**Tests exécutés à ce jour : 383, tous verts.** Dernière exécution : 2026-08-01.

```
Unitaires — 278, sans aucune infrastructure
  @coteris/shared    62  (millipoints 30, confiance 15, configuration 17)
  @coteris/grading   40  (moteur de barème)
  @coteris/database   9  (invariants de schéma)
  @coteris/audit     16  (chaîne de hash)
  @coteris/auth      30  (matrice de permissions)
  @coteris/ai        42  (validation des sorties, coûts, fournisseur simulé)
  @coteris/pipeline  12  (chaîne complète OCR → analyse → points → confiance)
  @coteris/storage   27  (clés, types réels, jetons d'accès)
  @coteris/jobs      12  (charges utiles, politiques de reprise, mise en file)
  @coteris/exports   28  (échappement, injection de formule, format francophone)

Intégration — 12, contre PostgreSQL 17 réel
  @coteris/audit     12  (verrous, détection d'altération, transactions)

Bout en bout — 93, contre l'application, la base, le worker et le stockage réels
  pnpm smoke          28  (parcours utilisateur, sécurité du service de fichiers)
  pnpm verify:review  15  (validation humaine, audit, recalcul)
  pnpm verify:worker  12  (file transactionnelle, traitement, audit)
  pnpm verify:exports 17  (permissions, contenu, format, traçabilité)
  pnpm verify:import  21  (refus, stockage, zones, file, traitement, doublon)
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

### Étape 6bis — Pipeline de correction — ✅

C'est la pièce qui relie tout. Les briques existaient ; celle-ci les fait
fonctionner ensemble, et un test prouve la chaîne complète sur le scénario du
cahier des charges.

**Les sept étapes de la section 19, implémentées et tracées**

```
preparation → readability → analysis → scoring → confidence → second_pass
```

Chaque étape produit une trace lisible. Le pipeline est **pur** : ni base, ni
réseau. Les entrées sont des paramètres, la sortie une structure de données —
donc testable à l'identique, indéfiniment.

**Ce que le test de bout en bout prouve**

Réponse « Il faut donner de l'iode non radioactif pour protéger la thyroïde avant
l'injection », barème à trois critères → **0,5 point sur 1**, avec les extraits
« iode non radioactif » et « protéger la thyroïde » tirés de la copie, le critère
sur la captation classé absent, un niveau de confiance vert, et aucune seconde
analyse payante déclenchée.

**Trois refus assumés**

1. **Aucune correction sans barème verrouillé** — `RubricNotLockedError`, testé.
2. **On n'invente jamais.** Copie blanche ou confiance OCR sous le seuil :
   l'analyse n'est même pas lancée. Économie réelle, et surtout aucune proposition
   appuyée sur du texte illisible.
3. **Preuves rejetées, points refusés.** Si les extraits cités ne figurent pas dans
   la copie, ou si un critère sort du barème, la proposition entière est écartée et
   le cas part en validation humaine.

**Une décision corrigée par un test rouge**

J'avais implémenté « note proche d'un seuil important » au niveau de la question :
une note à 0,5/1 déclenchait une seconde analyse. C'est faux. Une question notée à
la moitié n'est proche d'aucun seuil signifiant — les seuils qui comptent, moyenne
et barre d'admission, portent sur la copie entière. La règle envoyait en seconde
analyse payante une grande partie de l'épreuve. Elle a été retirée du pipeline et
confiée à l'orchestrateur, qui voit le total.

De même, l'échantillonnage aléatoire de cas verts ne se décide pas ici : ce module
doit rester déterministe. L'appelant le demande via `forceSecondPass`.

**Tests exécutés** : 12, tous verts.

**Limites connues**

- Le pipeline n'est appelé par rien : ni worker, ni interface. Il n'écrit pas encore
  en base et ne produit pas d'événement d'audit.
- La seconde vérification est signalée mais pas exécutée : il n'y a qu'un
  fournisseur, et il est simulé.

---

### Étape 6ter — Données de démonstration — ✅

**Le seed ne fabrique pas ses résultats : il exécute le pipeline.**

C'est le point important. Un jeu de démonstration écrit à la main donnerait une
image flatteuse et fausse. Celui-ci fait réellement tourner l'OCR simulé puis le
pipeline de correction sur six copies, et enregistre ce qui en sort. Il échouerait
si la chaîne était cassée.

**Contenu**, entièrement fictif (aucune donnée personnelle réelle) :

- une faculté de médecine, un coordonnateur, deux correcteurs, dix étudiants ;
- une épreuve de médecine nucléaire à cinq questions courtes, 5 points ;
- un corrigé validé, un barème de 12 critères **verrouillé** avant tout import ;
- six copies produisant des cas verts, orange et rouges, une réponse correcte non
  prévue au corrigé, et une copie partiellement blanche.

**Sortie réelle de l'exécution**

```
ANON-001 — 4.70 / 5   cas vert, réponses nettes
ANON-002 — 2.20 / 5   le cas du cahier des charges : 2 critères sur 3 en question 1
ANON-003 — 3.90 / 5   cas orange, lecture douteuse
ANON-004 — 0.00 / 5   cas rouge, scan inexploitable — aucune proposition
ANON-005 — 4.75 / 5   réponse correcte non prévue au corrigé
ANON-006 — 0.65 / 5   copie partiellement blanche

Décisions : 16 vertes, 4 orange, 10 rouges

copies 6 · analyses 30 · décisions 72 · preuves 55 · validations 39 · audit 49
```

`ANON-004` mérite un mot : la confiance OCR simulée est de 31 %, sous le seuil.
L'analyse n'est **même pas lancée** — le système ne propose rien plutôt que
d'inventer, et ne paie pas pour analyser de l'illisible.

**Vérification de la chaîne d'audit**

```
$ pnpm audit:verify
  OK      Faculté de médecine de démonstration — 49 événement(s), chaîne intacte
```

Les 49 événements produits par le seed forment une chaîne vérifiable. La commande
sort en code 1 si une chaîne est rompue, pour être utilisable dans un contrôle de
conformité planifié.

**Fichiers importants**

| Fichier | Contenu |
|---|---|
| `packages/seed/src/fixtures.ts` | Épreuve, barème, copies simulées |
| `packages/seed/src/run.ts` | Chargement, exécution réelle du pipeline |
| `packages/audit/src/cli/verify.ts` | Commande de vérification d'intégrité |

**Limites connues**

- Les comptes de démonstration existent mais **n'ont pas de mot de passe** : la
  gestion des identifiants revient à Better Auth, qui sera câblé avec l'application.
  Inventer ici un format de hachage risquerait de ne pas correspondre.
- Les images de copies sont référencées par clé mais n'existent pas sur le disque :
  il n'y a pas encore de couche de stockage.

---

### Étape 7 — Interface web — ✅ (lecture et correction)

**Coteris est désormais utilisable dans un navigateur.**

Next.js 15, App Router, rendu serveur. Identité visuelle du cahier des charges :
bleu marine, vert pétrole, or, Manrope et Inter. Sobre et institutionnelle —
l'interface accompagne une décision qui engage un enseignant devant un jury.

**Écrans livrés**

| Écran | Contenu |
|---|---|
| Connexion / inscription | Better Auth, mot de passe d'au moins 12 caractères |
| Tableau de bord | Épreuves de l'organisation, barème, nombre de copies |
| Épreuve | Statistiques, liste des copies avec niveaux de confiance, questions |
| **Correction** | Écran à trois zones |
| Historique | Journal d'audit, avec l'empreinte de chaque événement |

**L'écran de correction**

Trois zones, conformes à la section 21 : la copie à gauche, la réponse au centre,
la notation à droite. Survoler un critère **surligne dans la transcription
l'extrait exact qui le justifie** — c'est la traduction visuelle de « aucune note
sans preuve ». Navigation au clavier (`j` / `k`), ignorée dès qu'un champ de saisie
a le focus.

**Une lacune produit corrigée en chemin**

Un utilisateur qui s'inscrivait n'appartenait à aucune organisation : il était
renvoyé à la connexion sans comprendre pourquoi. L'inscription crée maintenant
**l'espace individuel** de l'enseignant, où il cumule coordonnateur et correcteur.

Le cumul est **déduit** de `organization.isPersonal` au moment de construire le
principal, et non dupliqué en base : la table `member` porte un index unique sur
(organisation, utilisateur), et deux lignes auraient créé une seconde source de
vérité qui aurait fini par diverger.

**Vérification — test de fumée HTTP**

```
$ pnpm smoke
```

22 vérifications, toutes vertes. Il parcourt le chemin réel d'un utilisateur et
vérifie notamment :

- un visiteur non connecté est redirigé hors du tableau de bord ;
- **une requête d'authentification sans en-tête `Origin` est refusée** (CSRF) ;
- l'écran de correction rend bien ses trois zones et affiche « total proposé »,
  distinct d'une note définitive ;
- **aucune identité d'étudiant n'apparaît** sur la page d'épreuve : l'anonymat
  tient ;
- une épreuve hors de l'organisation renvoie 404 — elle est *introuvable*, pas
  « refusée », ce qui évite de confirmer son existence.

Écrit en HTTP plutôt qu'en pilotage de navigateur : déterministe, rapide, et il
vérifie ce qui compte — le rendu serveur et le cloisonnement — sans dépendre du
minutage de l'hydratation.

**Comptes de démonstration**

```
coordinateur@demo.coteris.local · correcteur1@… · correcteur2@…
mot de passe : demonstration-coteris
```

Le hachage vient de Better Auth (`hashPassword`), qui possède le format. L'inventer
aurait produit des comptes inutilisables.

**Limites connues**

- **Aucune image de copie n'est affichée** : la couche de stockage n'existe pas.
  La zone gauche affiche la référence de la zone plutôt qu'une illustration
  trompeuse.
- Pas de worker : la correction est produite par le seed, pas déclenchée depuis
  l'interface.
- Pas de création d'épreuve, pas d'import de copies, pas d'export.

---

### Étape 8 — Validation humaine — ✅

**La promesse centrale du produit est maintenant effective.** `points_awarded`
reste nul tant qu'aucun humain n'a tranché, et ces actions sont le seul chemin qui
le renseigne.

**Ce qui est refusé, et pourquoi**

| Situation | Comportement |
|---|---|
| Rôle sans permission `grading.review` | Refusé côté serveur, quelle que soit l'interface |
| Points supérieurs à la valeur du critère | Refusé |
| Écart à la proposition sans motif | **Refusé** — une note modifiée sans justification est indéfendable devant un jury |
| Modification d'une note déjà finalisée | Refusé : cela exige une nouvelle version, non encore implémentée |
| Validation groupée hors cas vert | Refusée — le cahier des charges la réserve aux cas à confiance élevée |

**Ce qui est conservé à chaque décision**

Valeur avant, valeur après, auteur, date, motif, version du barème, version du
corrigé, et si l'action était groupée. Rien n'est écrasé : chaque modification
ajoute une ligne dans `human_reviews`.

La décision, son historique et son événement d'audit **partagent une
transaction**. Une note modifiée dont la trace manquerait — ou l'inverse —
ruinerait la valeur probante du journal.

**Une incohérence du seed corrigée**

Le seed finalisait toutes les copies, y compris celles dont des décisions
attendaient encore validation. Une note ne peut pas être définitive si ses
critères ne le sont pas. Seules les copies dont **toutes** les analyses sont
vertes — donc validées — sont désormais finalisées.

**Architecture : service séparé de l'action serveur**

Une action serveur ne s'appelle qu'à travers le protocole de Next.js, donc ne se
teste pas directement. La logique vit dans `apps/web/src/lib/services/review.ts`,
sans dépendance à Next.js ni à React ; l'action n'est qu'une enveloppe qui valide
l'entrée et délègue.

**Vérification**

```
$ pnpm verify:review
```

15 vérifications contre la base réelle, toutes vertes. Elles couvrent les refus
ci-dessus, la conservation de la valeur précédente et du motif, l'ajout
d'**exactement un** événement d'audit, le recalcul de la note, et — le point
important — **la chaîne d'audit reste intègre après écriture**.

**Limites connues**

- Le refus, le report à un autre correcteur et le commentaire à l'étudiant ne sont
  pas encore exposés dans l'interface.
- La modification d'une note finalisée est refusée plutôt que gérée : le
  versionnement de note reste à implémenter.

---

### Étape 9 — Stockage des fichiers — ✅

**Deux pilotes, un seul chemin d'accès.**

`local` (disque, défaut et cible mutualisée) et `s3` (MinIO, R2, Scaleway). Le
choix est une variable d'environnement.

Décision qui mérite d'être explicitée : **aucune URL pré-signée du fournisseur
n'est remise au navigateur**, même en S3. Tous les fichiers passent par
`/api/fichiers/…`. Un schéma d'accès unique vaut mieux que deux à maintenir, et
il garantit que le contrôle de permission est traversé dans tous les cas.

**Trois contrôles à chaque fichier servi, aucun facultatif**

1. une session valide → sinon 401 ;
2. la permission `submissionContent.read` → un administrateur technique ne l'a
   pas, et reçoit **404 et non 403** : confirmer l'existence d'un fichier
   renseignerait déjà quelqu'un qui n'a pas à le savoir ;
3. un jeton signé, lié à la clé **et** à l'organisation, expirant.

Le jeton seul ne suffirait pas — une URL copiée dans un courriel resterait
exploitable. La session seule non plus — elle n'attache l'accès à aucun fichier
précis.

**Ce qui est refusé, et testé**

| Attaque | Défense |
|---|---|
| `../../.env` dans la clé | Validation syntaxique **et** vérification du chemin résolu |
| Exécutable renommé en `.png` | Type détecté aux octets d'en-tête, pas au nom ni au type déclaré |
| SVG (peut contenir du script) | Hors des formats acceptés |
| Jeton d'une autre copie | Lié à la clé |
| Jeton d'une autre organisation | Lié à l'organisation |
| Expiration rallongée dans le jeton | La date entre dans le HMAC |
| Jeton forgé et périmé | Signalé « invalide », pas « expiré » — distinguer les deux renseignerait un attaquant |

**Un détail d'ordre qui compte**

La signature est vérifiée **avant** l'expiration. L'inverse permettrait de
distinguer un jeton expiré d'un jeton forgé.

**Fichiers importants**

| Fichier | Contenu |
|---|---|
| `packages/storage/src/driver.ts` | Interface, validation des clés, détection du type réel |
| `packages/storage/src/local.ts` | Pilote disque, double barrière anti-remontée |
| `packages/storage/src/s3.ts` | Pilote compatible S3 |
| `packages/storage/src/signing.ts` | Jetons d'accès HMAC |
| `apps/web/src/app/api/fichiers/[...cle]/route.ts` | Service des fichiers |

**Tests** : 27 unitaires + 4 vérifications de fumée sur la route réelle.

**Limites connues**

- **Les copies de démonstration n'ont pas d'image** : elles sont simulées, et je
  n'en fabrique pas. La zone gauche l'indique explicitement plutôt que d'afficher
  une illustration trompeuse. Les images apparaîtront dès l'implémentation de
  l'import.
- Rien n'écrit encore dans le stockage : l'import de copies reste à faire.

---

### Étape 10 — Worker et file de travaux — ✅

**La propriété centrale de l'ADR 0003 est maintenant prouvée, pas seulement
argumentée.**

`pnpm verify:worker` met un job en file dans une transaction **qu'il annule
volontairement**, et vérifie qu'aucun job ne subsiste. C'est exactement ce
qu'une file externe ne peut pas garantir : avec Redis, la copie existerait en
base sans jamais être traitée, ou le job partirait pour une copie annulée.

**Ce qui a été construit**

| Élément | Contenu |
|---|---|
| `packages/jobs` | Catalogue des tâches, schémas de charge utile, politiques de reprise, `addJob` transactionnel |
| `apps/worker` | Processus autonome, pool de connexions **distinct** de celui du web |
| `analyser-reponse` | Lecture, analyse selon le barème verrouillé, écriture de la proposition et de son audit |
| `scripts/worker-watchdog.sh` | Surveillance par cron pour hébergement mutualisé |
| `docs/deployment.md` | Déploiement sur les trois cibles |

**Décisions notables**

- **`addJob` exige une transaction.** Aucune variante ne s'en passe.
- **Clé d'unicité** sur la ré-analyse : un correcteur qui clique deux fois ne
  déclenche pas deux appels d'IA facturés. Vérifié par un test.
- **Le worker préfère toujours une transcription existante à une nouvelle
  lecture.** Si un correcteur l'a corrigée à la main, relancer l'OCR effacerait
  son travail — et c'est précisément après une telle correction qu'on relance
  l'analyse.
- **Le worker n'écrit jamais `points_awarded`.** Il propose ; seul un humain
  attribue. Vérifié par un test.
- **Un critère resté en brouillon n'entre jamais dans une correction** : la
  requête filtre sur `validation_status`.
- Le contexte du worker **refuse de démarrer** avec un fournisseur d'IA autre que
  simulé, tant que le banc d'essai n'a pas tranché. Choisir avant de mesurer
  serait exactement ce que le cahier des charges interdit.

**Une conséquence qu'il a fallu traiter**

Une réponse peut désormais compter plusieurs analyses. L'écran de correction
affichait chaque question autant de fois qu'elle avait été analysée ; la requête
ne retient plus que la dernière, les précédentes restant en base pour comparaison.

**Un correctif de permission**

Le correcteur a reçu `grading.propose`. Le cahier des charges prévoit qu'il puisse
« demander une nouvelle analyse », typiquement après avoir corrigé une
transcription. Proposer n'est pas décider — il n'a toujours ni `finalize`, ni
`publish`.

**Tests** : 12 unitaires sur `@coteris/jobs`, 12 vérifications de bout en bout
contre la base et le worker réels.

**Limites connues**

- Une seule tâche est implémentée. Contrôle qualité, seconde vérification,
  recorrection et exports sont déclarés au catalogue mais sans exécutant.
- Aucun bouton dans l'interface ne déclenche encore de ré-analyse : le service
  existe, l'écran ne l'appelle pas.
- Le maintien d'un worker permanent sur mutualisé reste à valider auprès du
  support d'o2switch. La variante `once` par cron, documentée, s'en passe.

---

### Étape 11 — Exports — ✅

Deux exports au format CSV : **résultats** et **rapport d'audit**. Générés par des
fonctions pures dans `@coteris/exports`, écrits dans le stockage, enregistrés et
audités.

**Trois choses qu'on découvre en général en production**

1. **L'injection de formule.** Une cellule commençant par `=`, `+`, `-` ou `@` est
   interprétée comme une formule à l'ouverture. Une valeur comme
   `=HYPERLINK("http://x","cliquez")`, venue d'un nom importé, s'exécuterait sur le
   poste de l'enseignant. Les valeurs concernées sont préfixées d'une apostrophe,
   qui force le traitement en texte sans altérer ce qui est lu.
2. **Le CSV « français ».** Excel en configuration française attend le
   point-virgule comme séparateur ; une virgule ouvre le fichier dans une seule
   colonne et l'utilisateur conclut que l'export est cassé.
3. **La marque d'ordre des octets.** Sans elle, Excel lit le fichier dans
   l'encodage local et les accents deviennent illisibles. Le test l'inspecte sur
   les **octets bruts** : `TextDecoder` la retire silencieusement, ce qui ferait
   croire à tort qu'elle est absente.

**Une colonne ajoutée au cahier des charges**

« Proposée / validée ». Un relevé qui mélangerait des notes encore proposées et des
notes validées sans les distinguer serait trompeur — et c'est exactement le genre
de document qu'on transmet à un jury. Une copie n'est marquée « validée » que si
**chacune** de ses décisions l'est.

**Le rapport d'audit inclut l'empreinte de chaque événement**, ce qui permet de
confronter le document remis à un jury avec la chaîne restée en base. Sans elle,
ce ne serait qu'une liste d'affirmations.

**Un export est un document daté**, stocké et non régénéré au téléchargement :
deux membres d'un jury doivent travailler sur le même fichier. Ils expirent après
trente jours.

**Permissions** — un correcteur ne crée pas d'export ; un administrateur technique
n'en crée aucun et n'exporte aucune note. L'export d'audit exige en plus la
permission de lire le journal.

**Le bouton « Demander une nouvelle analyse »** est désormais câblé : il met un job
en file et son événement d'audit dans la même transaction.

**Une contrainte technique levée**

`server-only` s'appuie sur une condition d'export propre au compilateur de Next.js
et lève dès qu'on l'importe depuis un script Node — donc empêchait de vérifier les
services en ligne de commande, or ce sont précisément les modules à tester.
Remplacé par une garde équivalente qui fonctionne partout.

**Tests** : 28 unitaires, 17 vérifications contre la base et le stockage réels.

**Limites connues**

- Pas de XLSX : le cahier des charges demande « Excel **ou** CSV », et le CSV
  s'ouvre dans Excel. Un vrai classeur demanderait une bibliothèque supplémentaire.
- Pas de PDF corrigé.
- Aucun bouton d'import de copies : le stockage est prêt, l'écriture ne vient
  encore que des exports.

---

### Étape 12 — Import de copies — ✅

**La chaîne complète fonctionne désormais depuis l'interface** : importer une
copie → fichier écrit dans le stockage → zones créées → analyses mises en file →
worker → propositions avec preuves → validation humaine → export.

**Ce que l'import refuse, et pourquoi**

| Situation | Comportement |
|---|---|
| Rôle sans `submission.create` | Refusé |
| Fichier vide | Refusé |
| **Fichier déguisé** (script renommé `.png`) | Refusé **sur ses octets**, jamais sur son extension ni sur le type déclaré |
| Fichier au-delà de la limite | Refusé |
| PDF | **Refusé explicitement** : le découpage en pages n'est pas implémenté, et le dire vaut mieux que laisser l'enseignant attendre |
| Barème non verrouillé | Refusé à l'entrée, plutôt qu'une file de travaux qui échouerait un à un |

**Le doublon n'est pas une erreur**

Un ré-import du même fichier renvoie vers la copie existante, avec son code
anonyme, sans en créer une seconde. Un enseignant qui reclique après un délai
réseau ne doit pas se retrouver avec des doublons à démêler avant un jury.

**Une limite que je nomme au lieu de la masquer**

La segmentation est une **hypothèse de mise en page** — une zone de réponse par
question, dans l'ordre, réparties sur la hauteur — et **non une détection**. Elle
est vraie pour beaucoup de sujets à réponses courtes, fausse pour les autres.

Conséquences assumées : les zones portent une confiance de 0,3, la copie est
classée « vérification recommandée », et l'interface l'écrit noir sur blanc. La
détection réelle et la correction manuelle des zones restent à implémenter.

**Tout dans une transaction**

La copie, ses pages, ses zones, les jobs d'analyse et l'événement d'audit sont
validés ensemble. Une copie importée dont l'analyse ne serait jamais mise en file
resterait éternellement « en attente », sans que l'enseignant comprenne pourquoi.

**Tests** : 21 vérifications contre la base, le stockage et le worker réels.

**Limites connues**

- Images seulement (JPEG, PNG, WEBP). Pas de PDF.
- Une image = une page = une copie. Pas d'import multipage.
- Segmentation par hypothèse, pas par détection.
- Pas de contrôle qualité réel des scans : flou, page sombre et rotation ne sont
  pas détectés.

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
