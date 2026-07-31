# ADR 0001 — Monolithe modulaire en monorepo TypeScript

- **Statut** : accepté
- **Date** : 2026-07-31

## Contexte

Coteris doit servir deux offres commerciales (individuelle et institutionnelle) avec un
seul moteur métier. Le produit comporte une interface web riche, une couche métier
substantielle (versionnement, barèmes, audit) et des traitements asynchrones coûteux
(OCR, analyse par IA, génération de PDF, exports).

L'équipe de développement est très réduite. Le volume de la V1 est déjà important :
une trentaine de tables, une vingtaine d'écrans.

## Décision

Un **monolithe modulaire** dans un **monorepo TypeScript** géré par pnpm workspaces et
Turborepo.

Deux applications déployables :

- `apps/web` — Next.js (App Router). Interface et couche serveur.
- `apps/worker` — processus Node autonome consommant la file de travaux.

Le métier vit dans `packages/*`, jamais dans `apps/*`. Les deux applications importent les
mêmes paquets métier. Cela garantit qu'une règle de barème ou une écriture d'audit se
comporte identiquement, qu'elle soit déclenchée par une requête HTTP ou par un job.

Règles de dépendance, vérifiées par ESLint :

```
apps/web ──┐
           ├──> packages/{auth,audit,ai,grading,database,shared,ui}
apps/worker┘

packages/grading ──> packages/shared          (et rien d'autre)
packages/audit   ──> packages/{database,shared}
packages/ai      ──> packages/{database,shared}
packages/auth    ──> packages/{database,shared,audit}
packages/database──> packages/shared
packages/shared  ──> (rien)
```

`packages/grading` ne dépend ni de la base de données, ni du réseau, ni d'une horloge.
C'est une contrainte forte et délibérée : le calcul des points doit être testable en
mémoire, en millisecondes, et reproductible à l'identique dans dix ans.

## Alternatives écartées

**Microservices.** Explicitement hors périmètre. Aucun besoin de mise à l'échelle
indépendante à ce stade, et le coût opérationnel (déploiement, observabilité, cohérence
transactionnelle entre services) serait sans commune mesure avec le bénéfice. Le cahier
des charges l'exclut, à raison.

**Next.js + API NestJS séparée.** NestJS apporterait une structure et OpenAPI, mais au
prix d'un second artefact à déployer, d'une duplication des types entre le client et le
serveur, et d'une contrainte forte sur les hébergements visés (voir ADR 0005). La couche
serveur de Next.js, organisée en services explicites appelés depuis des route handlers,
suffit. Si une API publique devient nécessaire, elle sera ajoutée comme un adaptateur
au-dessus des mêmes services métier — sans réécriture.

**Application unique sans worker.** Impossible : l'OCR et l'analyse d'une copie prennent
des dizaines de secondes à plusieurs minutes. Ces traitements ne peuvent pas vivre dans le
cycle de vie d'une requête HTTP.

## Conséquences

**Positives**

- Une seule transaction de base de données peut couvrir une écriture métier, son événement
  d'audit et la mise en file du job correspondant. C'est déterminant pour la correction du
  produit (voir ADR 0003).
- Les types traversent tout le système sans sérialisation intermédiaire.
- Un développeur peut lancer l'ensemble avec `docker compose up` et `pnpm dev`.

**Négatives**

- Le worker et l'application web partagent le même code : une régression dans un paquet
  partagé touche les deux. Atténuation : `packages/grading` et `packages/audit` sont
  couverts par des tests unitaires exhaustifs, et la CI bloque toute fusion sans tests
  verts.
- Turborepo ajoute une couche d'outillage à comprendre. Jugé acceptable pour le gain de
  cache sur les builds.
