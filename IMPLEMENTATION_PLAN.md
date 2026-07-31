# Plan d'implémentation — Coteris V1

## Principe directeur : la tranche verticale d'abord

Le cahier des charges décrit huit phases successives (fondations, épreuves, copies,
correction, interface, institutionnel, exports, durcissement). Construites dans cet ordre,
la chaîne complète ne fonctionnerait qu'après plusieurs mois — et tous les risques
d'intégration se révéleraient à la fin, au pire moment.

Nous inversons donc l'ordre sur un point : **après les fondations, nous construisons une
tranche verticale mince qui traverse toute la chaîne**, avec des fournisseurs d'IA simulés.
Puis nous approfondissons chaque phase.

```
   Approche du cahier des charges          Approche retenue

   ████ épreuves      (complet)            █ épreuves
   ░░░░ copies                             █ copies      ← tranche
   ░░░░ correction                         █ correction     verticale
   ░░░░ interface                          █ interface
   ░░░░ exports                            █ exports
                                           ↓
   puis, seulement :                       puis on épaissit chaque bande
   ████ copies        (complet)            ████ ████ ████ ████ ████
```

Ce que cela change concrètement :

- la chaîne de preuve — de l'image à la note finale — est vérifiable dès le début ;
- les erreurs de modèle de données apparaissent quand les corriger coûte encore peu ;
- il existe très tôt quelque chose de démontrable à un enseignant.

Ce que cela ne change pas : le contenu final de la V1, ni la définition de terminé.

---

## Définition de terminé

Une fonctionnalité n'est **jamais** déclarée terminée sans que tous ces points soient
vrais :

- [ ] elle fonctionne réellement, bout en bout ;
- [ ] les validations d'entrée sont implémentées (Zod, côté serveur) ;
- [ ] les permissions sont vérifiées **côté serveur** ;
- [ ] les erreurs sont gérées et affichées ;
- [ ] l'interface a ses états de chargement et d'erreur ;
- [ ] l'historique et l'audit sont écrits ;
- [ ] les tests sont écrits **et ont été exécutés et vus passer** ;
- [ ] aucune donnée sensible n'apparaît dans les journaux ;
- [ ] `pnpm lint`, `pnpm typecheck` et `pnpm build` passent ;
- [ ] la documentation concernée est à jour ;
- [ ] `PROGRESS.md` est mis à jour.

---

## Étape 1 — Fondations

**Objectif** : un dépôt sur lequel on peut travailler, avec une CI qui refuse le code cassé.

| Livrable | Détail |
|---|---|
| Monorepo | pnpm workspaces + Turborepo, TypeScript strict |
| Qualité | ESLint (règles de dépendance entre paquets incluses), Prettier, Vitest |
| Environnement | `.env.example`, validation Zod des variables **au démarrage** |
| Local | `docker-compose.yml` : PostgreSQL 17, MinIO |
| CI | GitHub Actions : install, lint, typecheck, tests, build, vérification des migrations, recherche de secrets |

**Vérification** : la CI passe sur un dépôt vide de métier. Un commit qui casse le typage
est refusé.

---

## Étape 2 — Modèle de données

**Objectif** : le schéma complet, migré, avec ses contraintes.

Points d'attention non négociables :

- points en `integer` (millièmes) — ADR 0006 ;
- `organization_id` sur **toute** table métier, non nul ;
- tables de version immuables (`assessment_versions`, `answer_key_versions`,
  `rubric_versions`) avec hash de contenu ;
- `audit_events` en append-only, `REVOKE UPDATE, DELETE` pour le rôle applicatif ;
- suppression logique là où l'historique doit survivre ;
- index sur tous les chemins de lecture chauds (copies par épreuve, décisions par copie,
  audit par organisation et date).

**Vérification** : migration appliquée sur une base neuve puis sur une base existante ;
tests d'intégration sur les contraintes (impossible d'écrire une décision sans barème
verrouillé, impossible de modifier un événement d'audit).

---

## Étape 3 — Moteur de barème déterministe

**Objectif** : le cœur du produit. Aucune I/O, aucune dépendance, testable en mémoire.

Entrée : les critères validés du barème verrouillé + les états détectés
(`present`, `partial`, `absent`, `contradiction`, `erreur factuelle`).
Sortie : les points par critère et le total, plus la trace de chaque règle appliquée.

Types d'attribution à couvrir : tout ou rien, partiel, points par élément, score manuel,
bonus, pénalité. Plus : plafonds, règles de cumul, règles d'exclusion, arrondis.

**Vérification** : tests unitaires exhaustifs, dont le scénario iode stable / MIBG du
cahier des charges, et des tests de propriété (la note reste dans `[0, max]`, l'ordre
d'évaluation des critères n'influence jamais le résultat).

C'est l'étape où l'on peut être le plus rigoureux pour le moins cher : elle ne nécessite ni
base de données, ni réseau, ni interface.

---

## Étape 4 — Journal d'audit

**Objectif** : rendre la traçabilité vérifiable, pas seulement déclarée.

- chaîne HMAC par organisation (pas de chaîne globale, qui sérialiserait toutes les
  écritures) ;
- écriture dans la transaction de l'action décrite ;
- append-only appliqué au niveau SQL, pas seulement applicatif ;
- vérificateur d'intégrité exécutable en commande.

**Vérification** : test qui altère une ligne en base avec des droits élevés et vérifie que
le vérificateur détecte la rupture de chaîne à la bonne position.

---

## Étape 5 — Authentification, organisations, rôles

Better Auth, plugin `organization`, contrôle d'accès par ressource et action (ADR 0004).

**Vérification** : tests de sécurité obligatoires, écrits avant d'être verts —

- un membre de l'organisation A ne peut lire aucune donnée de B ;
- un correcteur ne peut pas modifier un barème ;
- un correcteur ne peut pas ouvrir une copie qui ne lui est pas attribuée ;
- un administrateur technique ne peut pas lire le contenu d'une copie ;
- une note finalisée ne peut pas être modifiée sans passer par une nouvelle version ;
- une levée d'anonymat sans permission est refusée **et** journalisée.

---

## Étape 6 — Abstractions IA et banc d'essai

- interfaces `OcrProvider`, `VisionAnalysisProvider`, `TextAnalysisProvider` ;
- implémentation **simulée déterministe** — celle qui permet de construire toute la suite
  sans dépenser un centime ni dépendre d'un réseau ;
- suivi des coûts par appel, avec quota vérifié **avant** l'appel et coupe-circuit ;
- `docs/benchmark-protocol.md`, importateur de données, calcul des métriques,
  `scripts/run-benchmark.ts`.

**Sur les résultats** : le dépôt ne contient aucune copie réelle. `docs/benchmark-results.md`
sera créé avec ses sections et la mention explicite qu'aucune mesure n'a été effectuée.
Aucun chiffre ne sera inventé.

---

## Étape 7 — Tranche verticale

**Objectif** : le scénario du cahier des charges (section 39, iode stable / MIBG) qui
fonctionne de bout en bout, avec fournisseurs simulés.

Chemin complet à faire fonctionner :

1. inscription, création de l'organisation ;
2. création de l'épreuve ;
3. import du sujet, découpage en questions ;
4. saisie du corrigé ;
5. structuration des critères, validation humaine de chacun ;
6. validation et verrouillage du barème, avec hash et signataire ;
7. import d'une copie ;
8. contrôle qualité, segmentation, OCR ;
9. analyse structurée, JSON strict validé par schéma ;
10. calcul déterministe des points, niveau de confiance ;
11. écran de correction à trois zones ;
12. modification humaine avec motif ;
13. finalisation de la note ;
14. export Excel ;
15. consultation du journal d'audit, chaîne vérifiée.

**Vérification** : un test de bout en bout Playwright qui parcourt ces quinze étapes.
C'est le test qui, à lui seul, dit si Coteris existe.

---

## Étapes suivantes — approfondissement

Une fois la tranche verticale verte, chaque bande est épaissie, dans cet ordre :

| Étape | Contenu |
|---|---|
| 8 | Épreuves : tous formats de sujet, tous types de questions, cycle de vie complet, recorrection |
| 9 | Copies : import en lot, contrôle qualité réel, anonymisation, segmentation avancée |
| 10 | OCR et fournisseurs réels : intégration, mesures, seconde vérification sélective |
| 11 | Correction : réponses correctes non prévues, commentaires, raccourcis clavier, filtres |
| 12 | Offre institutionnelle : invitations, répartition, avancement, harmonisation |
| 13 | Exports et statistiques : Excel, CSV, PDF corrigé, rapport d'audit, suivi des coûts |
| 14 | Durcissement : sécurité, performance, observabilité, déploiement o2switch |

---

## Ce que nous ne construisons pas

Rappel du périmètre exclu, pour éviter la dérive : recherche Internet pour le corrigé,
correction sans validation humaine, portail étudiant, réclamations, Moodle, Google
Classroom, application mobile, dissertation longue, mathématiques complexes, schémas,
oral, plagiat, prédiction de réussite, microservices, Kubernetes, blockchain, multi-région,
marketplace, API publique complète, génération autonome du corrigé.

Toute idée utile relevant de cette liste va dans `docs/roadmap.md`, pas dans le code.

---

## Risques suivis

| Risque | Gravité | Traitement |
|---|---|---|
| L'IA ne détecte pas assez fiablement les critères sur du manuscrit réel | **Critique** — c'est l'hypothèse du produit | Banc d'essai avant tout engagement ; le mode « sans IA » garantit que le produit reste utilisable |
| Absence de données réelles pour valider | Élevée | Protocole et importateur prêts ; aucun résultat inventé en attendant |
| Worker permanent refusé sur mutualisé | Moyenne | Portabilité (ADR 0005) ; VPS européen en repli, sans changement de code |
| Coût d'inférence supérieur au prix de vente | Élevée | Suivi par appel dès l'étape 6, quotas avec coupe-circuit, seconde vérification sélective |
| Périmètre V1 très large pour une équipe réduite | Élevée | Tranche verticale d'abord ; `PROGRESS.md` tenu honnêtement |
