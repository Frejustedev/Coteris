# ADR 0003 — File de travaux dans PostgreSQL, sans Redis

- **Statut** : accepté
- **Date** : 2026-07-31

## Contexte

Coteris exécute des traitements longs hors du cycle des requêtes HTTP : extraction du
sujet, contrôle qualité des fichiers, OCR, segmentation, analyse, seconde vérification,
recorrection, génération de PDF, exports.

La pile classique dans l'écosystème Node est Redis + BullMQ. Elle est bonne. Elle n'est pas
la bonne ici.

## Décision

La file de travaux vit dans **PostgreSQL**, via **Graphile Worker**. Redis n'est pas une
dépendance de Coteris.

## Justification

### La raison déterminante : la mise en file transactionnelle

Avec une file externe, ce code contient une faute de correction irréductible :

```ts
await db.insert(submissions).values(copie)   // transaction validée
await queue.add('ocr', { submissionId })     // et si ça échoue ici ?
```

Si le processus meurt entre les deux lignes, la copie existe en base et ne sera jamais
traitée. L'enseignant voit une copie importée qui reste éternellement « en attente ». Le
symétrique est pire encore : le job part, la transaction est annulée, le worker traite une
copie inexistante.

Avec une file dans la même base, le problème disparaît :

```ts
await db.transaction(async (tx) => {
  const copie = await tx.insert(submissions).values(...).returning()
  await tx.insert(auditEvents).values(...)
  await addJob(tx, 'ocr', { submissionId: copie.id })   // même transaction
})
```

Les trois écritures sont validées ensemble ou aucune ne l'est. Sur un produit dont la
promesse est la traçabilité intégrale, un événement d'audit qui survit à l'annulation de
l'action qu'il décrit — ou l'inverse — n'est pas acceptable.

### Les raisons secondaires

**Une brique de moins.** Redis, c'est un service à héberger, superviser, sauvegarder et
sécuriser. Postgres est déjà là, déjà sauvegardé, déjà supervisé.

**Portabilité.** Certains hébergements cibles n'offrent pas Redis, ou l'offrent avec des
limites de mémoire mal documentées (ADR 0005). Postgres est partout.

**Inspection.** Une file en SQL s'inspecte avec `SELECT`. Diagnostiquer pourquoi une copie
est bloquée revient à lire une ligne, en production, sans outil supplémentaire.

**Durabilité par défaut.** Les jobs sont dans une table WAL-loguée et sauvegardée. Une
configuration Redis par défaut peut perdre des travaux à la coupure.

## Alternative écartée : Redis + BullMQ

BullMQ est plus performant et offre un tableau de bord mature. Ces avantages ne pèsent pas
face à la perte de la mise en file transactionnelle. Nos volumes sont modestes — un examen
de 200 copies représente quelques milliers de jobs, très majoritairement en attente
d'appels réseau vers des API d'IA, pas de débit de file. Postgres traite cela sans effort.

## Conséquences

**Positives**

- Cohérence entre l'action métier, son audit et son traitement asynchrone, garantie par la
  base.
- L'inventaire d'infrastructure de production se réduit à : Postgres, un espace de
  stockage, deux processus Node.
- Le développement local ne requiert que Postgres.

**Négatives**

- La file consomme des connexions Postgres. Atténuation : le worker utilise un pool séparé
  et dimensionné ; `LISTEN/NOTIFY` évite l'interrogation active.
- Un débit très élevé finirait par saturer la base. Le seuil est très au-dessus de nos
  besoins ; si nous l'atteignons, l'interface `JobQueue` de `packages/shared` permet de
  substituer une implémentation BullMQ sans toucher au métier.
- Pas de tableau de bord tout fait. Une page de supervision interne sera construite — elle
  est de toute façon exigée par le cahier des charges (« suivi des traitements »).

## Règle d'application

Aucun job n'est mis en file en dehors d'une transaction qui contient également l'écriture
métier qu'il concerne. La fonction `addJob` exige un objet transaction en premier
paramètre ; il n'existe pas de variante qui s'en passe.
