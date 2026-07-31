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
| 2 | Modèle de données et migrations | ⬜ |
| 3 | Moteur de barème déterministe | ✅ |
| 4 | Journal d'audit à chaîne de hash | ⬜ |
| 5 | Authentification, organisations, rôles | ⬜ |
| 6 | Abstractions IA/OCR et benchmark | ⬜ |
| 7 | Tranche verticale de bout en bout | ⬜ |
| 8+ | Approfondissement des phases | ⬜ |

**Tests exécutés à ce jour : 102, tous verts.** Dernière exécution : 2026-07-31.

```
@coteris/shared    62 tests  (millipoints 30, confidence 15, env 17)
@coteris/grading   40 tests  (moteur de barème)
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
