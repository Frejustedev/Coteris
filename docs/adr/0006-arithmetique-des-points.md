# ADR 0006 — Les points sont des entiers en millièmes

- **Statut** : accepté
- **Date** : 2026-07-31

## Contexte

Un barème manipule des valeurs comme 0,25 ; 0,5 ; 1/3 de point. Ces points sont additionnés
par critère, par question, puis par copie, avec des plafonds, des bonus et des pénalités.

Le résultat figure sur un document d'examen. Une note fausse au centième est un incident
académique, pas un défaut cosmétique.

En virgule flottante binaire, `0.1 + 0.2 !== 0.3`. Sur une copie à trente critères, les
erreurs d'arrondi s'accumulent et deviennent visibles. Pire : elles ne sont pas
reproductibles à l'identique selon l'ordre de sommation, ce qui contredit frontalement
l'exigence de déterminisme du moteur.

## Décision

**Aucun nombre à virgule flottante ne circule dans le moteur de barème ni dans la base.**

Les points sont représentés par des **entiers en millièmes de point** (`millipoints`).

```
0,25 point  →  250
0,5  point  →  500
1    point  →  1000
20   points →  20000
```

En base : `integer`, jamais `real`, `double precision` ni `numeric`.
En TypeScript : un type nominal, pour empêcher le mélange avec des points « humains ».

```ts
export type Millipoints = number & { readonly __brand: 'Millipoints' }

export const millipoints = (points: number): Millipoints => {
  const value = Math.round(points * 1000)
  if (!Number.isSafeInteger(value)) throw new RangeError(...)
  return value as Millipoints
}

export const toDisplayPoints = (mp: Millipoints): number => mp / 1000
```

La conversion vers un nombre décimal n'a lieu qu'au moment de l'affichage et de l'export.
Le formatage utilise `Intl.NumberFormat('fr-FR')` — donc une virgule décimale, comme
l'attend un enseignant francophone.

## Pourquoi les millièmes

Le dénominateur commun des barèmes réels rencontrés (demis, quarts, dixièmes, vingtièmes)
est couvert exactement. Les tiers de point ne le sont pas — `1/3` devient 333 — ce qui est
un choix assumé : la règle d'arrondi est explicite, appliquée **une seule fois**, au moment
de la répartition par élément, et jamais silencieusement.

Trois décimales suffisent largement, et un entier en millièmes reste très en deçà de
`Number.MAX_SAFE_INTEGER`, y compris pour une note cumulée d'établissement.

## Règles d'arrondi

Elles sont fixées ici parce qu'elles doivent être défendables devant un jury :

1. **L'arrondi n'a lieu qu'à la conversion en millièmes**, en entrée de barème. Ensuite,
   toute l'arithmétique est exacte.
2. **La répartition « points par élément »** (par exemple 1 point pour 3 éléments) répartit
   le reste sur les premiers éléments, en ordre stable, pour que la somme des parts égale
   exactement le total. Jamais de perte ni de gain d'un millième.
3. **Les plafonds sont appliqués après cumul**, avant les pénalités.
4. **L'arrondi d'affichage** (par exemple au quart de point) est un paramètre du barème,
   appliqué à la note finale de la question, et **journalisé** : la valeur exacte reste en
   base, la valeur arrondie est stockée à côté.

## Conséquences

**Positives**

- Le moteur est exactement reproductible : mêmes états de critères, même note, quel que soit
  l'ordre d'évaluation, la machine ou l'année.
- Les tests d'égalité sur les notes sont des comparaisons d'entiers, sans tolérance.
- Les sommes et moyennes SQL restent exactes.

**Négatives**

- Toute la base de code doit respecter la discipline. Atténuation : le type nominal fait
  échouer la compilation lorsqu'un `number` brut est passé là où un `Millipoints` est
  attendu, et une règle ESLint interdit `real`/`float` dans le schéma de barème.
- Les valeurs en base sont moins lisibles à l'œil nu (`250` plutôt que `0.25`). Atténuation :
  les vues de diagnostic exposent une colonne calculée en points décimaux.
