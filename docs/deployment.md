# Déploiement

Coteris se déploie sur trois cibles sans changement de code : la cible est une
variable d'environnement (voir [ADR 0005](adr/0005-deploiement-portable.md)).

| Cible | Statut | Pour qui |
|---|---|---|
| **o2switch** (mutualisé, France) | Cible par défaut | Enseignant seul, petite faculté |
| **VPS européen** (Docker) | Porte de sortie | Volume d'OCR important |
| **Vercel + base gérée** | Possible | Si l'on accepte un worker hébergé ailleurs |

## Règle commune : le build n'a jamais lieu sur le serveur

L'artefact de production est produit par l'intégration continue, jamais sur la
machine de destination. Sur mutualisé, un build Next.js épuise la mémoire —
c'est le problème le plus fréquemment rapporté sur cette plateforme. Mais la
raison de fond vaut partout : **ce qui est déployé doit être exactement ce qui a
été testé**.

```bash
pnpm install --frozen-lockfile && pnpm build
```

Le résultat utile est `apps/web/.next/standalone`.

## Deux processus, pas un

| Processus | Rôle | Commande |
|---|---|---|
| Web | Interface et couche serveur | `node apps/web/.next/standalone/server.js` |
| Worker | OCR, analyse, exports | `pnpm --filter @coteris/worker start` |

Le worker est **obligatoire**. Sans lui, les copies importées restent en attente
indéfiniment et l'enseignant ne comprend pas pourquoi.

---

## o2switch

### Ce que la plateforme fournit

Node.js 22 et 24 via Phusion Passenger, PostgreSQL, SSH, tâches cron, CloudLinux
LVE (jusqu'à 12 vCPU et 48 Go), espace disque sans limite contractuelle, et des
données hébergées en France — un argument de conformité solide auprès d'un
établissement.

### Ce qu'elle ne fournit pas, et comment on s'en passe

| Manque | Contournement |
|---|---|
| Docker | Aucun n'est nécessaire : Postgres est fourni, Redis n'est pas utilisé |
| Binaires système (`poppler`, `tesseract`) | Rasterisation PDF en JavaScript, OCR délégué à des API |
| Processus permanent garanti | Tâche cron de surveillance, ci-dessous |
| Mémoire suffisante pour builder | Build en intégration continue |

### Mise en place

1. **Base de données** — créer une base PostgreSQL depuis cPanel, noter l'URL.
2. **Application Node** — « Setup Node.js App », version 22 ou 24, racine
   applicative **hors de `public_html`**.
3. **Variables d'environnement** — depuis l'interface cPanel, jamais dans un
   fichier commité. Voir `.env.example`.
4. **Stockage** — `STORAGE_DRIVER=local`, `STORAGE_LOCAL_PATH` pointant vers un
   répertoire **hors de `public_html`**. Une copie d'examen accessible par URL
   directe, sans passer par l'application, serait une fuite.
5. **Migrations** — en SSH : `pnpm db:migrate` puis `pnpm jobs:migrate`.
6. **Déploiement** — `rsync` de l'artefact produit en CI.

### Le worker : tâche cron de surveillance

Passenger maintient l'application *web* en vie, pas un worker. C'est une béquille,
elle est assumée et documentée plutôt que dissimulée.

```bash
* * * * * /home/UTILISATEUR/coteris/scripts/worker-watchdog.sh
```

Le script prend un verrou `flock` — indispensable, sinon deux exécutions
concurrentes lanceraient deux workers — et relance le processus s'il est absent.

**Variante plus sobre**, si le support d'o2switch s'oppose à un processus
permanent : remplacer la surveillance par un traitement périodique, qui vide la
file puis s'arrête.

```bash
* * * * * cd /home/UTILISATEUR/coteris && pnpm --filter @coteris/worker once
```

La latence passe à une minute au pire. Pour une correction de copies, c'est sans
conséquence.

> **À valider avant la mise en production.** Un worker permanent sur mutualisé se
> situe dans une zone grise du contrat d'usage. Interrogez le support d'o2switch.
> En cas de refus, la variante `once` ci-dessus suffit ; et si le volume dépasse
> ce que le mutualisé accepte, le repli sur un VPS ne demande **aucun changement
> de code**.

### Limites acceptées

- Pas de mise à l'échelle horizontale, pas de haute disponibilité.
- Passenger tamponne les réponses en flux : l'affichage de progression utilise une
  interrogation périodique plutôt que des événements poussés. Moins élégant, mais
  fonctionnel sur les trois cibles.
- Convient à un enseignant seul ou à un pilote. **Pas à un examen national.**

---

## VPS européen

La cible la plus simple techniquement. `docker compose up -d` fournit Postgres ;
deux processus Node tournent sous systemd.

Intérêt : binaires système installables, donc prétraitement d'images local
possible si le banc d'essai le justifie. Coût : de 5 à 20 € par mois chez un
hébergeur européen, ce qui préserve l'argument RGPD.

---

## Vercel

Vercel héberge l'application web, mais **pas le worker** : les traitements
dépassent les limites de durée d'exécution des fonctions. Il faut donc Vercel +
une base gérée + un stockage objet + un hébergeur tiers pour le worker.

Quatre fournisseurs, quatre facturations, et des données de copies sortant de
l'Union européenne sauf configuration soignée. C'est possible, ce n'est pas plus
simple.

---

## Avant chaque mise en production

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` verts en intégration continue
- [ ] `pnpm build` réussi, artefact `standalone` produit
- [ ] `AUTH_SECRET` et `AUDIT_HASH_SECRET` **distincts** — la contrainte de
      configuration l'impose en production, mais vérifiez-le
- [ ] `APP_URL` en HTTPS
- [ ] `STORAGE_LOCAL_PATH` hors de tout répertoire public
- [ ] Migrations appliquées, y compris celles de la file
- [ ] Worker démarré et **vu traiter un job**
- [ ] `pnpm audit:verify` : chaîne d'audit intègre
- [ ] Sauvegarde de la base configurée et **restauration testée**

Le dernier point n'est pas de la forme. Une sauvegarde jamais restaurée n'est pas
une sauvegarde.
