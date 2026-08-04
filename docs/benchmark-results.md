# Résultats du banc d'essai

## Mesure du 4 août 2026 — `claude-opus-5`, effort medium

**Première mesure du produit lui-même**, et non plus de son plancher. 208 réponses,
effectif au-dessus du seuil de significativité du protocole.

### Conditions

| | |
|---|---|
| Date | 2026-08-04 |
| Jeu | GSS4408 EC1 — 13 copies, 16 questions, 208 réponses |
| Pipeline | **A** — analyse textuelle, `claude-opus-5`, sorties structurées, raisonnement adaptatif |
| Effort | `medium` |
| **Portée** | **Borne haute** — réponses saisies, donc sans incertitude de lecture |
| Granularité de la référence | par question |
| Accord entre correcteurs | **non mesuré** — un seul correcteur |
| Échecs | **0** |
| Réparations appliquées à la sortie du modèle | **0** |

### Résultats

| Métrique | Étalon lexical | **`claude-opus-5`** |
|---|---|---|
| Accord IA-humain | 24,0 % | **77,9 %** |
| Précision de détection | 74,4 % | **100,0 %** |
| Rappel de détection | 19,6 % | **74,2 %** |
| **Faux positifs** | 11 | **0** |
| Faux négatifs | 131 | **42** |
| Erreur absolue moyenne | 0,675 pt | **0,177 pt** |
| Biais | −0,360 pt | **−0,148 pt** |
| Erreur maximale | 2,000 pt | **1,750 pt** |
| Notes exactes | 24,0 % | **71,6 %** |
| Cas verts / orange / rouges | 43 / 154 / 11 | **117 / 59 / 32** |
| Recours à la validation attentive | 79,3 % | **43,8 %** |
| **Fiabilité des verts** | 37,2 % | **95,7 %** (5 des 117 corrigés) |
| Durée moyenne par réponse | 12 ms | **6 134 ms** |
| **Coût par copie** | 0,0000 € | **0,5097 €** |

### Ce que ces chiffres disent

**Zéro faux positif sur 208 réponses.** C'est le résultat le plus important, parce
que c'est la catégorie la plus grave : des points accordés à tort sur une copie
présentée comme sûre. Le modèle ne se montre jamais plus généreux que le
correcteur. Le biais reste négatif — il est encore trop sévère, 2,4 fois moins
que l'étalon.

**La fiabilité des verts passe de 37,2 % à 95,7 %.** Cinq cas verts sur 117 ont
été corrigés par l'humain. C'est un changement de nature, pas de degré.

**Et pourtant, la validation groupée reste désactivée.** Le protocole fixe le
seuil à 98 %. À 95,7 %, activer la validation en masse publierait environ une
note fausse toutes les vingt-trois copies présentées comme sûres. L'écart entre
95,7 % et 98 % semble mince ; sur une épreuve de 200 copies, c'est la différence
entre neuf notes fausses et quatre.

**Le gain de temps réel est ailleurs, et il est franc.** Le recours à la
validation attentive tombe de 79,3 % à 43,8 %. Un correcteur relit de près moins
d'une réponse sur deux au lieu de quatre sur cinq. Toute note continue de passer
par une validation humaine — c'est un principe du produit, pas un réglage.

**Le coût par copie est de 0,51 €.** Pour une épreuve de 200 copies : 102 €. L'API
Batches, non encore câblée, le ramènerait à environ 0,25 € — 51 € pour la même
épreuve. C'est le chiffre qui décide d'un prix de vente.

**Aucune réparation n'a été nécessaire.** Sur 208 réponses, le fournisseur n'a
retiré aucune citation introuvable dans la copie, tronqué aucune explication,
écarté aucun identifiant hors barème, et n'a jamais eu à redemander une analyse.
Les garde-fous n'ont pas servi — ce qui ne les rend pas inutiles : ils sont ce qui
permet d'affirmer qu'ils n'ont pas servi.

### Ce que ces chiffres ne disent toujours pas

- **Le plafond reste inconnu.** Un seul correcteur a noté ces copies. À 77,9 %
  d'accord, on ne sait pas si le modèle frôle l'accord inter-correcteurs ou s'il
  en est loin. Deux enseignants qui ne s'accorderaient qu'à 80 % feraient de ce
  résultat un excellent score ; s'ils s'accordent à 95 %, il reste du chemin.
  **Faire double-noter trois ou quatre copies reste le préalable à toute
  interprétation fine.**
- **On compare des totaux, pas des critères.** Le correcteur a noté par question.
  Un modèle peut atteindre le bon total par le mauvais chemin, et ce banc ne le
  verrait pas.
- **Rien sur la lecture.** Les réponses sont saisies.
  `permetDeChoisirUnOcr()` refuse ce rapport pour choisir un OCR, et il a raison.

### Effort : mesuré, pas supposé

Balayage sur les 16 questions de la copie 01 :

| Effort | Accord | Fiabilité des verts | Coût par copie |
|---|---|---|---|
| `low` | 75,0 % | 88,9 % | 0,5194 € |
| `medium` | 81,3 % | 100,0 % | 0,5484 € |

**Baisser l'effort ne fait pas d'économie.** 5 % de coût en moins pour six points
d'accord perdus. Le poste dominant n'est pas le raisonnement mais la sortie
structurée elle-même : chaque état de critère traîne ses extraits justificatifs.
La remise de 50 % de l'API Batches est le seul levier à la hauteur.

---

## Note de correction du 4 août 2026

**La mesure du 1er août portait sur un jeu corrompu.** Un audit des 208
transcriptions contre les PDF source a établi que **137 d'entre elles ne
restituaient pas fidèlement la copie** : 134 polluées par un jeton de colonne du
tableau Moodle injecté au milieu du texte de l'étudiant, une amputée de son
premier caractère, et deux entièrement perdues alors qu'elles étaient imprimées
deux fois dans le PDF — et notées 1250 et 1750 millièmes par le correcteur.

Deux causes, une seule racine : l'historique Moodle est un **tableau à cinq
colonnes** que le convertisseur lisait comme du texte plat, puis tentait de
nettoyer par expressions régulières ; et son découpage était strictement
intra-page, si bien qu'une page dépourvue d'en-tête de question était sautée en
silence. Les deux réponses perdues étaient exactement les deux pages de ce corpus
portant un « Enregistré : » sans en-tête au-dessus.

Le convertisseur lit désormais la colonne « Action » par ses coordonnées, conserve
la question courante d'une page à l'autre, et **abandonne la conversion** si une
transcription vide porte une note non nulle ou ne s'accompagne pas de l'état
« Non répondue » dans le PDF. Cette dernière contradiction était détectable en
une ligne dès la première exécution.

**Les chiffres n'ont presque pas bougé, et il faut dire pourquoi.** L'étalon
lexical cherche des sigles d'un mot et des syntagmes courts tirés du corrigé ; un
jeton injecté ailleurs dans la phrase ne casse aucune de ces correspondances. Il
était donc quasiment aveugle à la corruption. **Un vrai modèle ne l'aurait pas
été** : il lit l'intégralité de la transcription. Le jeu corrompu aurait flatté
l'étalon et handicapé son successeur — précisément l'asymétrie que ce protocole
existe pour éviter.

La conclusion centrale, elle, en sort **renforcée** : la fiabilité des cas verts
se dégrade de 39,0 % à 37,2 %, parce que les deux réponses récupérées deviennent
des cas verts que l'humain corrige.

---

## Mesure du 4 août 2026 — étalon lexical, jeu corrigé

Elle établit un plancher, pas une évaluation du produit : le pipeline mesuré est
un étalon lexical volontairement rudimentaire.

### Conditions

| | |
|---|---|
| Date | 2026-08-04 |
| Jeu | GSS4408 EC1 — Gestion d'un service de santé |
| Copies | 13 |
| Réponses | 208 (16 questions × 13 copies) |
| Barème | 20 points — 9 QCM (8 pts), 7 questions ouvertes (12 pts) |
| Moyenne humaine | 11,03 / 20 |
| **Portée** | **Borne haute** — réponses saisies, donc sans incertitude de lecture |
| **Fidélité de l'extraction** | vérifiée : 0 transcription polluée, 11 vides confirmées par l'état Moodle |
| **Granularité de la référence** | **Par question** — le correcteur n'a pas détaillé par critère |
| Accord entre correcteurs | **non mesuré** — un seul correcteur |
| Pipeline | `mock` — correspondance lexicale, vocabulaire tiré du corrigé |

### Résultats

| Métrique | 1er août (jeu corrompu) | **4 août (jeu corrigé)** |
|---|---|---|
| Accord IA-humain | 24,0 % | **24,0 %** |
| Précision de détection | 73,2 % | **74,4 %** |
| Rappel de détection | 18,4 % | **19,6 %** |
| Faux positifs | 11 | **11** |
| Faux négatifs | 133 | **131** |
| Erreur absolue moyenne | 0,680 pt | **0,675 pt** |
| Biais | −0,384 pt | **−0,360 pt** |
| Erreur maximale | 2,000 pt | **2,000 pt** |
| Notes exactes | 24,0 % | **24,0 %** |
| Cas verts / orange / rouges | 41 / 154 / 13 | **43 / 154 / 11** |
| Recours à la validation humaine | 80,3 % | **79,3 %** |
| **Fiabilité des verts** | 39,0 % | **37,2 %** (27 des 43 corrigés) |
| Coût par copie | 0,0000 € | **0,0000 €** (l'étalon ne coûte rien) |

Le plafond de confiance de lecture est passé de 0,95 à 1 sur ce jeu, une
transcription saisie n'ayant aucune incertitude de lecture. Ce changement **n'a
déplacé aucun niveau** — vérifié : les valeurs de netteté produites par l'étalon,
0,95 et 0,6, restent du même côté des seuils avant comme après. L'écart entre les
deux colonnes vient donc entièrement de la correction du jeu.

### Ce que ces chiffres disent

**Le résultat le plus important reste la fiabilité des verts : 37,2 %.**

Un cas vert est celui qu'un enseignant valide sans relire. Ici, **près de deux cas
verts sur trois sont faux**. Avec cet étalon, la validation groupée ne serait pas
un gain de temps mais un accident : elle publierait des notes fausses sur des
copies présentées comme sûres.

Deux conclusions concrètes, inchangées et confortées :

1. **La validation groupée doit rester désactivée** tant qu'un pipeline n'a pas
   démontré une fiabilité des verts très supérieure — le seuil de 98 % fixé par le
   protocole reste le bon.
2. **Le calcul de confiance est mal calibré pour ce type de pipeline.** Il produit
   du vert quand la correspondance lexicale est nette ; or la netteté d'une
   correspondance lexicale n'implique pas la justesse de la décision. La confiance
   ne doit pas être dérivée de la seule mécanique interne du pipeline.

Le reste est cohérent avec ce qu'on attend d'une approche lexicale : elle
reconnaît ce qu'elle a en vocabulaire (précision 74 %) et rate presque tout le
reste (rappel 20 %), d'où un biais négatif — elle est trop sévère, jamais trop
généreuse.

### Ce que ces chiffres ne disent pas

- **Rien sur le choix d'un fournisseur d'OCR.** Les réponses sont saisies.
  `permetDeChoisirUnOcr()` refuse ce rapport pour cet usage.
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

### Ce que l'incident enseigne sur le banc lui-même

Le jeu annonçait « transcription parfaite » dans ses conditions de mesure. Cette
étiquette n'était pas seulement fausse : elle rendait le défaut **impensable**.
Personne ne cherche une corruption d'extraction dans un jeu déclaré parfait par
construction.

Trois enseignements ont été appliqués :

1. Le libellé de portée dit maintenant « transcriptions fidèles », et la fidélité
   est une propriété **vérifiée**, pas déduite de la nature de la source.
2. Le convertisseur **échoue** au lieu d'informer. Les deux pertes avaient
   traversé tout le pipeline, avaient été comptées dans « dont N sans réponse
   d'étudiant », puis publiées, sans qu'aucun signal ne soit émis.
3. Une seconde source indépendante existait — la réponse est imprimée en clair
   sous l'énoncé, en plus de l'historique — et n'était pas exploitée. Un
   recoupement aurait rendu la perte impossible.

## Ce qui reste à mesurer

| Pipeline | État |
|---|---|
| `mock` — correspondance lexicale | ✅ mesuré, plancher établi |
| **A** — analyse textuelle seule | ✅ mesuré sur 208 réponses, `claude-opus-5` |
| **A** — OCR puis analyse textuelle | ⬜ la moitié « OCR » exige des copies manuscrites |
| **B** — multimodal direct | ⬜ exige des copies manuscrites |
| **C** — hybride ciblé | ⬜ n'a d'intérêt que si B dépasse nettement A |

Restera hors de portée jusqu'à disposer de **copies manuscrites** : tout ce qui
concerne la lecture, donc le choix de l'OCR et les pipelines B et C.
