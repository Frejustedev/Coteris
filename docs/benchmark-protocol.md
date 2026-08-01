# Protocole d'évaluation

## La question à laquelle ce banc d'essai doit répondre

> Coteris peut-il identifier correctement les critères d'un barème présents dans
> de vraies réponses manuscrites, même lorsque la transcription n'est pas
> parfaite ?

Tout le reste du produit en dépend. Si la réponse est non, aucune interface, aucun
journal d'audit et aucun moteur de barème ne sauvera le projet.

## Ce que l'on ne mesure pas

**Le taux de caractères OCR corrects n'est pas la métrique.** Une transcription
imparfaite peut donner une note juste — un correcteur humain lit aussi à travers
une écriture difficile. Une transcription parfaite peut donner une note fausse si
les critères sont mal identifiés.

Les deux étapes se mesurent donc **séparément**, faute de quoi on ne saurait pas
laquelle échoue.

## Deux portées de mesure, à ne jamais confondre

Chaque réponse du jeu déclare l'origine de sa transcription, et le rapport en tire
sa **portée** :

| Portée | Jeu | Ce que le résultat autorise |
|---|---|---|
| **Chaîne complète** | Réponses manuscrites, transcrites par un humain | Répond à la question du produit. Seule portée permettant de **choisir un fournisseur d'OCR**. |
| **Borne haute** | Réponses saisies : transcription parfaite par construction | Mesure l'identification des critères **seule**. |
| **Mixte** | Les deux mélangés | Rien. Les chiffres agrégés sont une moyenne entre deux choses différentes. |

### Pourquoi une borne haute vaut quand même le détour

Elle répond à une question éliminatoire :

> Si le système n'identifie pas correctement les critères sur du texte **parfait**,
> aucun OCR ne le sauvera.

Une borne haute médiocre est donc une réponse — négative — à l'hypothèse du
produit, obtenue à moindre coût. Une borne haute excellente ne prouve rien sur la
lecture manuscrite, mais indique que la suite vaut la peine d'être mesurée.

C'est aussi le seul type de jeu qu'on peut constituer **sans copies manuscrites**,
ce qui en fait un point de départ raisonnable.

`permetDeChoisirUnOcr()` refuse tout rapport qui ne serait pas de portée « chaîne
complète » **et** significatif. Le script l'affiche en clair : la confusion entre
une borne haute et une mesure réelle est le plus sûr moyen de choisir un mauvais
fournisseur.

## Métriques

Implémentées dans `packages/benchmark`, et **testées sur des cas construits à la
main** — c'est ce qui permet de faire confiance aux chiffres qu'elles produiront
sur de vraies copies.

| Métrique | Ce qu'elle dit |
|---|---|
| Accord IA-humain par critère | Part des états identiques entre proposition et décision |
| Précision de détection | Sur les critères où des points sont accordés, part de ceux que l'humain accorde aussi |
| Rappel de détection | Sur les critères que l'humain accorde, part de ceux que le système trouve |
| Erreur absolue moyenne | Écart de note, en points |
| **Biais** | Écart **signé** : le système est-il systématiquement trop généreux ? |
| Erreur maximale | Le pire cas observé |
| Taux de recours à la validation | Part des réponses signalées comme incertaines |
| **Fiabilité des verts** | Part des cas verts validés sans modification |
| Coût par réponse, page, copie | En millionièmes d'euro |
| Durée moyenne | En millisecondes |

### Les deux métriques décisives

**La fiabilité des verts.** Un cas vert est celui qu'un enseignant sera tenté de
valider sans relire. S'il s'y trouve des erreurs, la promesse du produit
s'effondre — bien plus sûrement qu'avec un rappel moyen.

**Les faux positifs.** Accorder des points que l'humain refuse avantage indûment
un candidat ; refuser des points que l'humain accorde est rattrapé à la relecture.
Ces deux erreurs n'ont pas la même gravité et ne doivent jamais être fondues dans
un score unique.

### Seuil de significativité

En dessous de **200 critères évalués**, aucune conclusion n'est tirée. Annoncer
« 94 % d'accord » sur douze réponses serait trompeur ; le script affiche
l'effectif à côté de chaque taux et refuse de conclure en deçà.

## Pipelines à comparer

| | Stratégie | État |
|---|---|---|
| **A** | OCR → transcription → analyse textuelle selon le barème | à implémenter |
| **B** | Modèle multimodal analysant directement la zone manuscrite | à implémenter |
| **C** | Hybride : OCR, repérage des mots incertains, analyse multimodale ciblée | à implémenter |
| **mock** | Correspondance lexicale | implémenté — référence basse et vérification du harnais |

Seul le simulateur existe aujourd'hui. Les trois autres exigent un fournisseur
réel, dont le choix est précisément ce que ce banc d'essai doit éclairer.
**Les déclarer comme implémentés serait mentir sur ce qui est mesurable.**

Le pipeline C n'a d'intérêt que si B est nettement meilleur que A **et** nettement
plus cher. Si A suffit, C est une complication inutile ; si B est bon marché, C
n'apporte rien. On ne l'implémentera qu'après avoir mesuré A et B.

## Données attendues

- 150 à 200 copies anonymisées
- 1 000 à 2 000 réponses courtes
- barèmes validés
- **décisions humaines de référence** — sans elles, il n'y a rien à comparer

### Le jeu n'entre jamais dans le dépôt

`benchmark/data/` est exclu par `.gitignore`. Un jeu d'évaluation circule entre
postes, se copie dans des rapports, et finit par traîner : mieux vaut qu'il ne
contienne rien d'identifiant dès le départ.

L'importateur **refuse** un jeu contenant :

- un champ nommé `nom`, `prenom`, `email`, `matricule`, `adresse`… ;
- une adresse électronique ou une suite de chiffres ressemblant à un numéro,
  **dans n'importe quel texte libre** — c'est là qu'ils se glissent au moment de
  l'extraction.

Il refuse également les incohérences qui fausseraient les mesures : une décision
portant sur un critère absent du barème, un critère sans décision de référence
(qui fausserait le rappel), un total incohérent avec la somme des critères.

### Format

```json
{
  "version": 1,
  "description": "Épreuve de médecine nucléaire, session anonymisée",
  "réponses": [
    {
      "id": "r-001",
      "submissionId": "c-001",
      "questionId": "q-01",
      "question": "Pourquoi administre-t-on de l'iode stable avant une MIBG ?",
      "corrigé": "L'iode stable sature la thyroïde afin de réduire sa captation.",
      "transcriptionRéférence": "Pour protéger la thyroïde avant l'injection.",
      "critères": [
        { "id": "k1", "label": "Iode stable", "maxPoints": 250, "acceptableAnswers": ["iode stable"] }
      ],
      "décisionsRéférence": [
        { "criterionId": "k1", "référence": "absent", "pointsRéférence": 0 }
      ],
      "totalRéférence": 0,
      "pointsMax": 1000,
      "qualitéScan": "moyenne",
      "styleÉcriture": "difficile"
    }
  ]
}
```

`qualitéScan` et `styleÉcriture` permettent de ventiler les résultats : un
fournisseur excellent sur des scans nets et mauvais sur une écriture difficile
n'est pas utilisable dans un examen réel, où les deux coexistent.

## Marche à suivre

```bash
pnpm benchmark -- --jeu ./benchmark/data/jeu.json
```

Sans jeu, la commande explique ce qui manque et sort. **Elle ne produit jamais de
chiffres à partir de données inventées.**

## Établir la référence humaine

Point le plus coûteux, et le plus déterminant.

1. Deux correcteurs annotent indépendamment le même sous-ensemble.
2. Leur **accord entre eux** est mesuré en premier. C'est le plafond : le système
   ne peut pas être plus fiable que la référence à laquelle on le compare.
3. Les désaccords sont arbitrés et documentés.
4. Le reste du jeu est annoté par un seul correcteur.

Sans l'étape 2, un accord IA-humain de 85 % est ininterprétable : il peut être
excellent si les humains eux-mêmes ne s'accordent qu'à 87 %.

## Décider

Le rapport doit permettre de trancher trois questions :

1. **La fiabilité des verts est-elle suffisante** pour qu'un enseignant valide en
   lot sans y perdre ? En dessous de 98 %, la validation groupée doit être
   désactivée.
2. **Le coût par copie est-il compatible** avec un prix de vente ?
3. **Le taux de recours à l'humain** laisse-t-il un gain de temps réel ? Si
   80 % des réponses partent en validation attentive, Coteris fait perdre du temps.

Une réponse négative à l'une des trois n'invalide pas le produit, mais impose de
changer quelque chose — de fournisseur, de périmètre ou de promesse commerciale —
avant d'aller plus loin.
