# Journal d'audit

## Ce que c'est, et ce que ce n'est pas

Coteris **n'utilise pas de blockchain** et ne le prétendra jamais. Le journal est
une table PostgreSQL protégée par une **chaîne de HMAC-SHA256** : chaque événement
inclut le hash du précédent.

| Garantie | Fournie ? |
|---|---|
| Détecter qu'un événement a été modifié | Oui |
| Détecter qu'un événement a été supprimé au milieu de la chaîne | Oui |
| Détecter qu'un événement a été inséré | Oui |
| Empêcher l'écriture par l'application | Oui, déclencheurs SQL |
| Empêcher un attaquant possédant le secret **et** un accès complet à la base de reforger la chaîne | **Non** |

La dernière ligne est la limite honnête d'une chaîne de hash locale. Trois mesures
la réduisent :

1. La table est en ajout seul **au niveau de la base**, pas seulement de
   l'application.
2. `AUDIT_HASH_SECRET` est distinct de `AUTH_SECRET` — une contrainte de
   configuration l'impose en production. La compromission de l'un ne suffit pas.
3. La vérification périodique peut archiver hors base le dernier hash validé.
   Reforger la chaîne devient alors détectable par comparaison.

## Fonctionnement

```
événement N-1 ──hash──┐
                      ▼
événement N : { organisation, séquence, acteur, action, objet,
                valeur avant, valeur après, motif, métadonnées,
                requête, horodatage, previousHash }
                      │
                   HMAC-SHA256(secret)
                      ▼
                   hash de N
```

### Sérialisation canonique

Le hash doit être reproductible des années plus tard, sur une autre machine,
après relecture depuis la base. Deux pièges ont été traités explicitement :

- **L'ordre des clés JSON n'est pas garanti.** Un objet construit en mémoire et le
  même objet relu depuis une colonne `jsonb` peuvent avoir un ordre différent.
  `canonicalize` trie les clés récursivement.
- **Les dates.** Sérialisées en ISO 8601 UTC, jamais en horodatage local.

Les nombres non finis (`NaN`, `Infinity`) sont rejetés : ils rendraient le hash
irreproductible.

### Une chaîne par organisation

Pas une chaîne globale. Une chaîne unique sérialiserait toutes les écritures de la
plateforme derrière un seul verrou ; deux facultés qui corrigent en même temps se
bloqueraient mutuellement.

L'écriture prend un verrou consultatif de portée transactionnelle :

```sql
SELECT pg_advisory_xact_lock(hashtext($organizationId))
```

Sans lui, deux transactions simultanées liraient la même « dernière séquence » et
produiraient deux événements chaînés au même prédécesseur — la chaîne deviendrait
un arbre. Le verrou est relâché automatiquement au COMMIT ou au ROLLBACK, y compris
si le processus meurt.

### Écriture transactionnelle obligatoire

`appendAuditEvent` **exige** un objet transaction en premier paramètre. Il n'existe
pas de variante qui s'en passe.

```ts
await db.transaction(async (tx) => {
  const copie = await tx.insert(submissions).values(...).returning()
  await appendAuditEvent(tx, { action: 'submission.import', ... }, secret)
  await addJob(tx, 'ocr', { submissionId: copie.id })
})
```

Les trois écritures sont validées ensemble ou aucune ne l'est. Un journal qui
conserverait la trace d'une action annulée — ou perdrait celle d'une action
effectuée — serait pire qu'aucun journal, puisqu'on lui ferait confiance.

## Verrou en ajout seul

Trois vecteurs, trois protections, **tous testés contre une base réelle** :

| Vecteur | Protection |
|---|---|
| `UPDATE` | Déclencheur `BEFORE UPDATE ... FOR EACH ROW` |
| `DELETE` | Même déclencheur |
| `TRUNCATE` | Déclencheur **séparé**, `BEFORE TRUNCATE ... FOR EACH STATEMENT` |

Le troisième mérite d'être signalé. `TRUNCATE` ne déclenche pas les triggers de
ligne : sans un déclencheur de niveau instruction, une seule commande aurait effacé
tout le journal sans rien rencontrer. Le trou a été trouvé en testant, pas en
relisant.

## Vérification

```bash
pnpm audit:verify
```

`verifyChain` recalcule chaque hash et s'arrête à la première rupture, en indiquant
sa nature et sa position :

| Type | Signification |
|---|---|
| `content_modified` | Le hash recalculé diffère : le contenu a changé |
| `chain_broken` | Le `previousHash` ne correspond pas : insertion ou remplacement |
| `sequence_gap` | Un numéro manque : suppression |
| `invalid_genesis` | Le premier événement référence un prédécesseur inexistant |

Ce qui suit une rupture n'est pas exploitable : tout hash ultérieur dépend du hash
rompu. `lastValidSequence` indique jusqu'où le journal reste probant.

### Limite connue : la suppression du dernier événement

Supprimer le **dernier** événement d'une chaîne ne crée ni trou de séquence, ni
rupture de chaînage. La chaîne restante est parfaitement cohérente.

C'est une limite structurelle de toute chaîne de hash locale, et elle est
explicitement couverte par un test qui documente le comportement plutôt que de le
masquer. La parade — archiver périodiquement hors base le dernier hash et la
dernière séquence — est prévue à l'étape de durcissement.

## Événements obligatoires

Définis dans `AUDIT_ACTIONS` (`packages/database/src/schema/audit.ts`). La liste
fait foi :

```
auth.login · auth.logout
assessment.create · assessment.status_change · subject.import · question.update
answer_key.create · answer_key.validate
rubric.create · rubric.validate · rubric.lock
submission.import · ocr.run · transcription.edit
grade.propose · grade.review · grade.modify · grade.finalize · grade.publish
export.create · identity.reveal · permission.change · assignment.change
```

`identity.reveal` mérite une mention : toute levée d'anonymat est journalisée, sans
exception. C'est l'événement le plus sensible du système.

## Ce qui n'est jamais journalisé

- Aucune chaîne de pensée d'un modèle. Seule une justification structurée, courte
  et vérifiable est conservée.
- Aucune donnée personnelle superflue dans `previousValue` / `newValue`.
- Aucun secret, jeton ou mot de passe.

## Tests

| Fichier | Portée |
|---|---|
| `packages/audit/src/hash.test.ts` | 16 tests, sans base : canonicalisation, chaînage, sensibilité au secret |
| `packages/audit/src/audit.integration.test.ts` | 12 tests, base réelle : numérotation, verrous, détection d'altération, annulation de transaction |

Les tests de détection d'altération désactivent temporairement le déclencheur pour
simuler un attaquant disposant d'un accès complet à la base — la seule menace que
la chaîne de hash adresse réellement.
