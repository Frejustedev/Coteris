# Modèle de données

38 tables, PostgreSQL 17, schéma défini avec Drizzle dans
`packages/database/src/schema/`.

Ce document décrit les principes. Le schéma TypeScript fait autorité sur les noms
exacts de tables et de colonnes ; les migrations SQL générées sont dans
`packages/database/drizzle/`.

## Cinq règles qui traversent tout le schéma

### 1. Toute table métier porte `organization_id`, non nul

C'est la base du cloisonnement entre établissements. Une table sans cette colonne ne
peut être protégée ni par le code, ni par une politique de sécurité au niveau ligne.

Six tables en sont légitimement dépourvues, et la liste est close : `user`,
`session`, `account`, `verification` (un utilisateur appartient à plusieurs
organisations), `organization` elle-même, et `subscription_plans` (catalogue
global).

**Cette règle est vérifiée par un test** (`schema.test.ts`) qui parcourt toutes les
tables déclarées. Ajouter une table sans `organization_id` fait échouer la CI.

### 2. Les points sont des entiers, en millièmes

Jamais `real`, jamais `numeric`. `0,25 point` se stocke `250`. Voir
[ADR 0006](adr/0006-arithmetique-des-points.md).

Un test parcourt toutes les colonnes dont le nom contient `points` ou `cap` et
échoue si l'une d'elles est en virgule flottante. Les coûts d'inférence suivent la
même règle, en millionièmes d'euro.

### 3. Les versions sont immuables

`assessment_versions`, `answer_key_versions`, `rubric_versions` ne sont jamais
modifiées après création. Toute évolution crée une nouvelle version, avec son
`content_hash`, son `locked_at` et son `locked_by`.

Une contrainte SQL garantit qu'un verrouillage porte toujours à la fois une date et
un signataire :

```sql
CHECK ((locked_at IS NULL AND locked_by IS NULL)
    OR (locked_at IS NOT NULL AND locked_by IS NOT NULL))
```

Un barème ne se verrouille pas tout seul.

### 4. Rien n'est écrasé

Les transcriptions, les notes et les décisions de correction sont versionnées. La
suppression est logique (`deleted_at`) partout où l'historique doit survivre : un
examen se conteste parfois des mois après.

### 5. Le journal d'audit est en ajout seul, au niveau de la base

Pas seulement dans l'application. Trois déclencheurs bloquent `UPDATE`, `DELETE`
**et `TRUNCATE`** sur `audit_events`.

Le cas `TRUNCATE` mérite d'être signalé : il ne déclenche pas les triggers de ligne.
Sans un déclencheur de niveau instruction, une seule commande aurait effacé tout le
journal sans rien rencontrer. Les trois vecteurs ont été testés contre une base
réelle.

## La chaîne de preuve

C'est la raison d'être du modèle. Pour tout point attribué, on peut remonter :

```
grades
  └── grading_decisions          points proposés et attribués, séparés
        ├── rubric_criteria      le critère du barème verrouillé
        ├── grading_evidence     l'extrait justificatif
        │     └── ocr_spans      sa position exacte sur l'image
        ├── grading_runs         versions du corrigé, du barème et du prompt
        │     ├── answer_regions la zone recadrée de la copie
        │     │     └── submission_pages → submissions
        │     └── transcription_versions
        └── human_reviews        qui a décidé, quand, pourquoi
```

Trois colonnes rendent cette chaîne opérante :

| Colonne | Sans elle |
|---|---|
| `grading_runs.rubric_version_id` | On ignore quel barème a servi |
| `grading_runs.answer_key_version_id` | On ignore quel corrigé a servi |
| `grading_runs.prompt_version` | La proposition n'est pas reproductible |

La troisième est souvent oubliée. Un prompt d'analyse modifié change les résultats ;
sans sa version, rejouer une correction de l'an dernier ne donnerait pas le même
résultat, et la traçabilité serait une façade.

## Points proposés, points attribués

`grading_decisions` porte deux colonnes distinctes :

- `points_proposed` — calculé par le moteur déterministe, jamais par le modèle ;
- `points_awarded` — **nul tant qu'aucun humain n'a tranché**.

C'est la traduction en base de « la note ne devient définitive qu'après validation
humaine ». Une contrainte impose qu'une décision validée porte toujours son
validateur et sa date :

```sql
CHECK (points_awarded IS NULL
    OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
```

Et une note publiée a nécessairement été finalisée :

```sql
CHECK (published_at IS NULL
    OR (finalized_at IS NOT NULL AND finalized_by IS NOT NULL))
```

## Anonymisation

`submissions` ne porte qu'un `anonymous_code`. Aucun nom, aucun identifiant
d'étudiant.

La correspondance vit dans `submission_identities`, table distincte et minimale,
dont toute lecture produit un événement `identity.reveal`. Un correcteur n'y a
jamais accès.

Masquer un nom dans l'interface tout en le laissant sur la même ligne de la base ne
protège de rien : le premier export mal filtré, la première requête de débogage le
révèle. Un test vérifie que `submissions` ne contient ni `student_id`, ni
`first_name`, ni `last_name`.

## Zones de réponse

`answer_regions` stocke des coordonnées **relatives** (0 à 1), pas des pixels : elles
restent valides quand l'image est redimensionnée ou remplacée par sa version
améliorée. Une contrainte vérifie que la zone tient dans la page.

Chaque zone porte sa `cropped_image_key`. C'est elle qu'on envoie au modèle, jamais
la page entière — moins coûteux et moins intrusif.

## Idempotence des imports

`submissions.idempotency_key`, unique par organisation. Deux envois du même lot ne
créent pas deux copies. Un enseignant qui reclique après un délai réseau ne doit pas
se retrouver avec des doublons à trier avant un jury.

`file_hash` sert en complément à repérer les doublons de contenu.

## Coûts et quotas

`ai_runs` enregistre chaque appel : fournisseur, modèle, type de tâche, version du
prompt, jetons, durée, coût en millionièmes d'euro, statut.

`usage_records` agrège par organisation et par mois. Cette table existe pour une
raison précise : le coupe-circuit doit lire la consommation courante **en une
ligne, avant chaque appel**. Agréger des centaines de milliers de lignes d'`ai_runs`
à chaque requête serait intenable.

`subscription_plans.monthly_budget_micro_eur` n'admet aucune valeur signifiant
« illimité ». Une offre illimitée adossée à un coût d'inférence variable est un
risque financier non borné.

## Cycle de vie d'une épreuve

`assessment_status` est une énumération PostgreSQL. Les transitions autorisées sont
contrôlées côté application, pas par la base — une machine à états en SQL serait
rigide et difficile à faire évoluer.

```
DRAFT → SUBJECT_REVIEW → ANSWER_KEY_REVIEW → RUBRIC_REVIEW
      → READY_FOR_SUBMISSIONS → SUBMISSIONS_PROCESSING
      → GRADING → HUMAN_REVIEW → FINALIZED → PUBLISHED → ARCHIVED
```

La règle « aucune correction sans barème validé » se vérifie à l'entrée du pipeline :
une `grading_run` référence obligatoirement une `rubric_version`, et le service
refuse d'en créer une si `locked_at` est nul.

## Index

Les index couvrent les chemins de lecture chauds de l'interface de correction :

| Index | Requête servie |
|---|---|
| `submissions(assessment_id, status)` | Liste des copies filtrée par état |
| `grading_runs(organization_id, needs_human_review)` | File de validation du correcteur |
| `grading_decisions(submission_id, question_id)` | Panneau de notation |
| `answer_regions(submission_id, question_id)` | Zones d'une réponse |
| `audit_events(organization_id, occurred_at)` | Consultation de l'historique |
| `assignments(grader_id, assessment_id)` | Copies attribuées à un correcteur |

## Ce qui reste à faire

- Politiques de sécurité au niveau ligne (RLS) en défense en profondeur, avec
  `SET LOCAL app.current_org_id` par transaction. Le cloisonnement applicatif est en
  place et testé ; RLS viendra le doubler à l'étape de durcissement.
- Table de file de travaux : créée par Graphile Worker à son initialisation, pas par
  nos migrations.
