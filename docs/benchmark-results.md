# Résultats du banc d'essai

## Mesure du 1er août 2026 — étalon lexical

**Première mesure sur des données réelles.** Elle établit un plancher, pas une
évaluation du produit : le pipeline mesuré est un étalon lexical volontairement
rudimentaire, seul implémenté à ce jour.

### Conditions

| | |
|---|---|
| Date | 2026-08-01 |
| Jeu | GSS4408 EC1 — Gestion d'un service de santé |
| Copies | 13 |
| Réponses | 208 (16 questions × 13 copies) |
| Barème | 20 points — 9 QCM (8 pts), 7 questions ouvertes (12 pts) |
| Moyenne humaine | 11,03 / 20 |
| **Portée** | **Borne haute** — réponses saisies, transcription parfaite |
| **Granularité de la référence** | **Par question** — le correcteur n'a pas détaillé par critère |
| Accord entre correcteurs | **non mesuré** — un seul correcteur |
| Pipeline | `mock` — correspondance lexicale, vocabulaire tiré du corrigé |

### Résultats

| Métrique | Valeur |
|---|---|
| Accord IA-humain | 24,0 % |
| Précision de détection | 73,2 % |
| Rappel de détection | 18,4 % |
| Faux positifs | 11 |
| Faux négatifs | 133 |
| Erreur absolue moyenne | 0,680 pt |
| Biais | **−0,384 pt** (systématiquement trop sévère) |
| Erreur maximale | 2,000 pt |
| Notes exactes | 24,0 % |
| Cas verts / orange / rouges | 41 / 154 / 13 |
| Recours à la validation humaine | 80,3 % |
| **Fiabilité des verts** | **39,0 %** (25 des 41 cas verts corrigés par l'humain) |

### Ce que ces chiffres disent

**Le résultat le plus important est la fiabilité des verts : 39 %.**

Un cas vert est celui qu'un enseignant valide sans relire. Ici, **trois cas verts
sur cinq sont faux**. Avec cet étalon, la validation groupée ne serait pas un
gain de temps mais un accident : elle publierait des notes fausses sur des copies
présentées comme sûres.

Deux conclusions concrètes :

1. **La validation groupée doit rester désactivée** tant qu'un pipeline n'a pas
   démontré une fiabilité des verts très supérieure — le seuil de 98 % fixé par le
   protocole reste le bon.
2. **Le calcul de confiance est mal calibré pour ce type de pipeline.** Il produit
   du vert quand la correspondance lexicale est nette ; or la netteté d'une
   correspondance lexicale n'implique pas la justesse de la décision. La confiance
   ne doit pas être dérivée de la seule mécanique interne du pipeline.

Le reste est cohérent avec ce qu'on attend d'une approche lexicale : elle
reconnaît ce qu'elle a en vocabulaire (précision 73 %) et rate presque tout le
reste (rappel 18 %), d'où un biais négatif — elle est trop sévère, jamais trop
généreuse.

### Ce que ces chiffres ne disent pas

- **Rien sur le choix d'un fournisseur d'OCR.** Les transcriptions étaient
  parfaites. `permetDeChoisirUnOcr()` refuse ce rapport pour cet usage.
- **Rien sur Coteris avec un vrai modèle.** L'étalon lexical est un plancher, pas
  le produit.
- **Rien de fin sur les critères.** Le correcteur a noté par question ; la
  comparaison est donc faite sur les totaux. Répartir une note globale entre les
  critères aurait fabriqué la référence à laquelle on se compare.

### Limite méthodologique assumée

Un seul correcteur a noté ces copies. **L'accord entre correcteurs n'est donc pas
connu**, et c'est lui qui donne le plafond : si deux enseignants ne s'accordaient
qu'à 80 %, un accord IA-humain de 78 % serait excellent et non médiocre.

Faire double-noter trois ou quatre copies par un second correcteur reste le
préalable à toute interprétation fine.

## Ce qui reste à mesurer

| Pipeline | État |
|---|---|
| `mock` — correspondance lexicale | ✅ mesuré, plancher établi |
| **A** — OCR puis analyse textuelle | ⬜ exige un fournisseur réel |
| **B** — multimodal direct | ⬜ exige un fournisseur réel et des copies manuscrites |
| **C** — hybride ciblé | ⬜ n'a d'intérêt que si B dépasse nettement A |

Le jeu est prêt et les références existent : implémenter un fournisseur
d'analyse textuelle réel rendrait la mesure suivante immédiate.

Restera hors de portée jusqu'à disposer de **copies manuscrites** : tout ce qui
concerne la lecture, donc le choix de l'OCR et les pipelines B et C.
