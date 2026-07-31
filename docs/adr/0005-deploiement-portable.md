# ADR 0005 — Déploiement portable, o2switch comme cible par défaut

- **Statut** : accepté
- **Date** : 2026-07-31

## Contexte

La cible de déploiement souhaitée est **o2switch**, hébergeur mutualisé français
(Perpignan), avec Vercel comme solution de repli.

Coteris traite des copies d'examen d'étudiants : données personnelles au sens du RGPD,
parfois nominatives, dans un contexte académique où la confidentialité est une exigence
contractuelle vis-à-vis des établissements.

### Ce que permet réellement o2switch (vérifié)

| Besoin | Disponibilité |
|---|---|
| Node.js 22 et 24 | Oui, via Phusion Passenger, configuré depuis cPanel |
| PostgreSQL | Oui, géré depuis cPanel |
| Redis | Oui, instance privée activable |
| Accès SSH | Oui |
| Tâches cron | Oui |
| Ressources | CloudLinux LVE, jusqu'à 12 vCPU / 48 Go (24 threads / 64 Go en offre Pro) |
| Stockage disque | Sans limite contractuelle |
| Localisation | France |

### Les contraintes réelles

1. **Le build Next.js échoue en mémoire sur le serveur.** C'est le problème le plus
   fréquemment rapporté sur cette plateforme.
2. **Pas de processus persistant garanti.** Passenger maintient l'application *web*
   vivante, pas un worker.
3. **Pas de Docker, pas de root, pas d'installation de binaires système.** Ni `poppler`
   (`pdftoppm`), ni `tesseract`.

### Ce que Vercel ne résout pas

Vercel ne peut pas héberger le worker : les traitements OCR et d'analyse dépassent les
limites de durée d'exécution des fonctions. Un déploiement Vercel imposerait donc Vercel
(web) + une base gérée + un stockage objet + un hébergeur tiers pour le worker. Quatre
fournisseurs, quatre facturations, et des données de copies sortant de l'Union européenne
sauf configuration soignée.

Vercel n'est pas plus simple pour ce produit. Il est plus simple pour un produit sans
worker.

## Décision

**Ne pas choisir d'hébergeur au niveau de l'architecture.** Chaque dépendance
d'infrastructure passe derrière une interface, avec une implémentation par défaut qui
fonctionne partout.

| Brique | Interface | o2switch | VPS | Vercel |
|---|---|---|---|---|
| Base de données | `DATABASE_URL` (Postgres nu) | cPanel | Docker | Neon / Scaleway |
| File de travaux | Graphile Worker (Postgres) | ✓ | ✓ | ✓ |
| Stockage | `StorageDriver` : `local` \| `s3` | disque | MinIO | R2 / Scaleway |
| Cache, limitation de débit | mémoire + Postgres | ✓ | ✓ | ✓ |
| Courriel | `MailDriver` : `smtp` \| `resend` | SMTP inclus | — | Resend |

**Aucune dépendance à Redis** (ADR 0003), **aucun binaire natif** (ADR 0002), **aucun
binaire système** : la rasterisation des PDF se fait en JavaScript (`pdfjs-dist` +
`@napi-rs/canvas`, qui fournit des binaires précompilés), et l'OCR est intégralement
délégué à des API distantes.

La cible de déploiement devient une variable d'environnement, pas une décision
d'architecture.

**Cible par défaut : o2switch.** France, coût marginal nul pour le propriétaire du projet,
et argument de conformité solide auprès d'un établissement français ou francophone.

### Modalités sur o2switch

1. **Build en intégration continue, jamais sur le serveur.** GitHub Actions produit
   `output: 'standalone'` de Next.js ; l'artefact est transféré par rsync. Cela contourne
   la limite mémoire et constitue de toute façon la bonne pratique.
2. **Worker maintenu par une tâche cron de surveillance.** Chaque minute, un script vérifie
   sous verrou `flock` que le worker tourne, et le relance sinon. C'est une béquille, elle
   est assumée et documentée dans `docs/deployment.md`.
3. **Fichiers hors de `public_html`.** Les copies ne sont jamais servies directement par
   Apache. L'application délivre des URL signées à durée de vie courte.

## Risques acceptés

- **Un worker permanent sur mutualisé est dans une zone grise du contrat d'usage.** À
  valider auprès du support o2switch avant la mise en production. Si le refus est opposé,
  la porte de sortie est un VPS européen à faible coût, sans changement de code.
- **Passenger tamponne les réponses en flux.** L'affichage de progression n'utilisera donc
  pas d'événements serveur poussés, mais une interrogation périodique. Choix moins élégant,
  mais qui fonctionne sur les trois cibles.
- **Pas de mise à l'échelle horizontale, pas de haute disponibilité.** Acceptable pour une
  V1 et un pilote. Inacceptable pour un examen national — ce sera une décision à revoir.

## Conséquences

**Positives**

- Le pari sur l'hébergeur est réversible. Nous n'avons pas à trancher avant de connaître
  les volumes réels d'OCR, ce qui est précisément ce que la phase de benchmark doit mesurer.
- Le développement local (Docker) et la production (mutualisé) partagent le même code, la
  même version majeure de Postgres et la même version de Node.
- Les données restent en France par défaut.

**Négatives**

- La couche d'adaptateurs représente environ une journée de travail. Coût jugé faible au
  regard du risque évité — et l'abstraction des fournisseurs d'IA était déjà exigée.
- Le développement se fait sous Docker, la production non. Divergence réelle. Atténuation :
  la CI exécute les tests d'intégration sur la même version majeure de Postgres que la
  production, et un script `scripts/check-deploy-target.ts` vérifie au démarrage que
  l'environnement fournit ce que la configuration déclare.
