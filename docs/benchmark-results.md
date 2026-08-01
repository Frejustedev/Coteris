# Résultats du banc d'essai

## Aucune mesure n'a été effectuée

**Ce document ne contient aucun résultat, parce qu'aucune donnée réelle n'est
disponible.**

Le jeu d'évaluation — 150 à 200 copies anonymisées, 1 000 à 2 000 réponses
courtes, barèmes validés et décisions humaines de référence — n'a pas été fourni.

Le laboratoire est prêt : protocole, importateur, métriques testées, script
d'exécution. Il attend des copies.

Inventer des chiffres ici fausserait la décision la plus importante du projet —
le choix du fournisseur d'OCR et d'analyse — et donnerait une confiance
injustifiée dans un produit qui promet précisément l'inverse.

## En attendant : une borne haute est possible dès maintenant

Des réponses **saisies** — tapées plutôt que manuscrites — suffisent pour une
première mesure. La transcription est alors parfaite par construction, ce qui
isole l'étape d'identification des critères.

Ce que cela permet :

- **répondre à la question éliminatoire** — si les critères sont mal identifiés
  sur du texte parfait, aucun OCR ne le rattrapera ;
- **évaluer et implémenter un fournisseur d'analyse textuelle** sans dépendre de
  copies manuscrites ;
- établir la référence de comparaison pour, plus tard, chiffrer exactement ce que
  la lecture manuscrite fait perdre.

Ce que cela ne permet pas : **choisir un fournisseur d'OCR**. Le script le dit
explicitement, et `permetDeChoisirUnOcr()` refuse tout rapport de cette portée.

## Ce qui est prêt

| Élément | État |
|---|---|
| [Protocole](benchmark-protocol.md) | ✅ |
| Importateur avec refus des données personnelles | ✅ 25 tests |
| Métriques (accord, précision, rappel, erreur, biais, verts, coûts) | ✅ testées |
| `pnpm benchmark` | ✅ |
| Pipeline **mock** (référence basse) | ✅ |
| Pipeline **A** — OCR puis analyse textuelle | ⬜ |
| Pipeline **B** — multimodal direct | ⬜ |
| Pipeline **C** — hybride ciblé | ⬜ |

Les pipelines A, B et C exigent un fournisseur réel. Le worker **refuse de
démarrer** avec un fournisseur autre que simulé, tant que ce banc d'essai n'a pas
tranché : choisir avant de mesurer serait exactement ce que le cahier des charges
interdit.

## Modèle de rapport

À remplir lorsque les données seront disponibles. Un résultat sans ses conditions
n'est pas un résultat.

### Conditions

| | |
|---|---|
| Date | |
| Jeu utilisé | |
| Copies / réponses / critères | |
| Accord entre correcteurs de référence | |
| Fournisseur, modèle, version | |
| Version du jeu de prompts | |

### Résultats par pipeline

| Métrique | A | B | C |
|---|---|---|---|
| Accord IA-humain par critère | | | |
| Précision de détection | | | |
| Rappel de détection | | | |
| Faux positifs | | | |
| Faux négatifs | | | |
| Erreur absolue moyenne | | | |
| Biais | | | |
| Erreur maximale | | | |
| **Fiabilité des verts** | | | |
| Taux de recours à l'humain | | | |
| Coût par page | | | |
| Coût par copie | | | |
| Durée moyenne | | | |

### Ventilation

Par qualité de scan (bonne / moyenne / mauvaise) et par style d'écriture
(lisible / moyen / difficile). Un fournisseur excellent sur des scans nets et
mauvais sur une écriture difficile n'est pas utilisable dans un examen réel, où
les deux coexistent.

### Exemples d'échec

Trois à cinq cas commentés, avec l'image, la transcription, la décision proposée
et la décision humaine. Ce sont eux qui font comprendre où le système se trompe —
plus qu'un taux agrégé.

### Recommandation

À rédiger après lecture des chiffres, en répondant explicitement aux trois
questions du protocole : fiabilité des verts, coût par copie, gain de temps réel.
