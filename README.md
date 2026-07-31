# Coteris

Plateforme de correction académique assistée par intelligence artificielle.

Coteris permet à un enseignant ou à une institution d'importer des copies manuscrites,
d'appliquer un corrigé et un barème validés, puis d'obtenir une **proposition** de note
justifiée par des preuves — que l'enseignant valide, modifie ou refuse.

**Coteris ne remplace jamais l'enseignant.** Une note ne devient définitive qu'après
validation humaine par une personne autorisée.

## Les trois principes non négociables

1. **Aucune note sans preuve.** Chaque point proposé est relié à un extrait exact de la
   réponse de l'étudiant.
2. **Aucune correction sans barème validé.** Le barème doit être verrouillé par un humain
   avant qu'une seule copie ne soit analysée.
3. **Aucune modification sans historique.** Toute valeur modifiée conserve son ancienne
   version, son auteur, sa date et son motif.

Pour tout point attribué, le système peut reconstruire cette chaîne :

```
épreuve → question → image originale → réponse manuscrite → transcription
       → critère du barème → extrait justificatif → points proposés
       → niveau de confiance → décision humaine → note finale
```

## Séparation des responsabilités entre l'IA et le moteur

C'est la décision d'architecture centrale du produit :

| Rôle | Qui | Conséquence |
|---|---|---|
| Lire l'écriture manuscrite | Fournisseur OCR | Sortie contrôlée, confiance mesurée |
| Décider si un critère est présent, partiel ou absent | Modèle d'IA | Sortie JSON stricte, validée par schéma |
| **Calculer les points** | **Moteur déterministe** | Pur, testé, reproductible, sans appel réseau |
| Valider la note | **Humain** | Obligatoire, journalisé |

Le modèle d'IA ne calcule jamais une note. Il identifie des états ; le moteur de règles
applique le barème. Deux exécutions du moteur sur les mêmes états produisent toujours le
même résultat.

## Démarrage rapide

Prérequis : Node.js 22 ou 24, pnpm 10+, Docker (pour Postgres et le stockage local).

```bash
pnpm install
```

```bash
cp .env.example .env
```

```bash
docker compose up -d
```

```bash
pnpm db:migrate && pnpm db:seed
```

```bash
pnpm dev
```

L'application est alors disponible sur http://localhost:3000.
Les comptes de démonstration sont affichés à la fin du seed.

Le détail (dépannage, réinitialisation de la base, exécution du worker seul) est dans
[docs/local-development.md](docs/local-development.md).

## Commandes

| Commande | Effet |
|---|---|
| `pnpm dev` | Application web + worker en mode développement |
| `pnpm build` | Build de production de tous les paquets |
| `pnpm lint` | ESLint sur tout le dépôt |
| `pnpm typecheck` | Vérification TypeScript stricte |
| `pnpm test` | Tests unitaires (Vitest) |
| `pnpm test:integration` | Tests d'intégration (nécessite Docker) |
| `pnpm test:e2e` | Tests de bout en bout (Playwright) |
| `pnpm db:migrate` | Applique les migrations |
| `pnpm db:seed` | Charge les données de démonstration fictives |

## Structure

```
coteris/
  apps/
    web/          Next.js — interface et couche serveur
    worker/       Traitements asynchrones (OCR, analyse, exports)
  packages/
    database/     Schéma Drizzle, migrations, accès aux données
    auth/         Authentification, organisations, rôles, permissions
    audit/        Journal append-only à chaîne de hash
    ai/           Abstractions OCR et analyse, suivi des coûts
    grading/      Moteur de barème déterministe (pur, sans I/O)
    shared/       Types, schémas Zod, utilitaires communs
    ui/           Composants d'interface
  docs/           Documentation et décisions d'architecture
  scripts/        Benchmark, maintenance, déploiement
  tests/          Tests d'intégration et de bout en bout
  infrastructure/ Docker, configuration de déploiement
```

## Documentation

| Document | Contenu |
|---|---|
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Découpage du travail et ordre de construction |
| [PROGRESS.md](PROGRESS.md) | État réel d'avancement, mis à jour à chaque étape |
| [docs/architecture.md](docs/architecture.md) | Vue d'ensemble technique |
| [docs/data-model.md](docs/data-model.md) | Modèle de données |
| [docs/grading-engine.md](docs/grading-engine.md) | Règles de calcul des points |
| [docs/ai-pipeline.md](docs/ai-pipeline.md) | Pipeline d'analyse |
| [docs/ocr-pipeline.md](docs/ocr-pipeline.md) | Lecture des copies manuscrites |
| [docs/audit-trail.md](docs/audit-trail.md) | Journal d'audit et intégrité |
| [docs/security.md](docs/security.md) | Modèle de menace et contrôles |
| [docs/privacy.md](docs/privacy.md) | Données personnelles et RGPD |
| [docs/cost-model.md](docs/cost-model.md) | Suivi des coûts d'inférence |
| [docs/benchmark-protocol.md](docs/benchmark-protocol.md) | Protocole d'évaluation technique |
| [docs/deployment.md](docs/deployment.md) | Déploiement (o2switch, VPS, Vercel) |
| [docs/adr/](docs/adr/) | Décisions d'architecture motivées |

## Statut

Coteris est en cours de construction. `PROGRESS.md` est la source de vérité sur ce qui
fonctionne réellement. Aucune fonctionnalité n'y est déclarée terminée sans que ses tests
aient été exécutés et vus passer.
