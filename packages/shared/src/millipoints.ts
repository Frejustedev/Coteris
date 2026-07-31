/**
 * Arithmétique des points de barème.
 *
 * Voir docs/adr/0006-arithmetique-des-points.md.
 *
 * Les points ne sont JAMAIS représentés par des nombres à virgule flottante.
 * `0.1 + 0.2 !== 0.3` en binaire ; sur une copie à trente critères, l'erreur
 * s'accumule et devient visible sur un document d'examen. Pire, le résultat
 * dépend alors de l'ordre de sommation, ce qui contredit l'exigence de
 * déterminisme du moteur de barème.
 *
 * Un point vaut 1000 millièmes. Toute l'arithmétique est entière et exacte.
 * La conversion en décimal n'a lieu qu'à l'affichage et à l'export.
 */

declare const brand: unique symbol

/** Un nombre entier de millièmes de point. 0,25 point = 250. */
export type Millipoints = number & { readonly [brand]: 'Millipoints' }

/** Le plus grand total manipulable sans perte : très au-delà de tout besoin réel. */
const MAX_MILLIPOINTS = Number.MAX_SAFE_INTEGER

export class MillipointsError extends RangeError {
  constructor(message: string) {
    super(message)
    this.name = 'MillipointsError'
  }
}

/**
 * Convertit des points « humains » en millièmes.
 *
 * C'est le SEUL endroit où un arrondi a lieu en entrée. Ensuite, toute
 * l'arithmétique est exacte.
 *
 * @example millipoints(0.25) === 250
 */
export function millipoints(points: number): Millipoints {
  if (!Number.isFinite(points)) {
    throw new MillipointsError(`Valeur de points non finie : ${points}`)
  }
  const value = Math.round(shiftByThousand(points))
  if (!Number.isSafeInteger(value)) {
    throw new MillipointsError(`Valeur de points hors des entiers sûrs : ${points}`)
  }
  return value as Millipoints
}

/**
 * Multiplie par 1000 sans subir l'erreur de représentation binaire.
 *
 * `0.29 * 1000` vaut 289.99999999999994, ce qui donnerait 289 millièmes après
 * troncature. Déplacer l'exposant dans la notation décimale donne exactement 290.
 * Les valeurs déjà en notation exponentielle ne peuvent pas être décalées ainsi ;
 * elles sont hors du domaine des barèmes réels et retombent sur le calcul direct.
 */
function shiftByThousand(points: number): number {
  const text = `${points}`
  if (text.includes('e') || text.includes('E')) return points * 1000
  return Number(`${text}e3`)
}

/** Construit une valeur déjà exprimée en millièmes (lecture depuis la base). */
export function fromMillipoints(value: number): Millipoints {
  if (!Number.isSafeInteger(value)) {
    throw new MillipointsError(`Millièmes non entiers : ${value}`)
  }
  return value as Millipoints
}

export const ZERO = 0 as Millipoints

/** Convertit en points décimaux. À n'utiliser que pour l'affichage et l'export. */
export function toDisplayPoints(value: Millipoints): number {
  return value / 1000
}

/**
 * Formate pour un lecteur francophone : virgule décimale, pas de zéros inutiles.
 *
 * @example formatPoints(millipoints(0.25)) === '0,25'
 * @example formatPoints(millipoints(2))    === '2'
 */
export function formatPoints(value: Millipoints, locale = 'fr-FR'): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(toDisplayPoints(value))
}

function guard(value: number): Millipoints {
  if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_MILLIPOINTS) {
    throw new MillipointsError(`Dépassement de capacité sur les points : ${value}`)
  }
  return value as Millipoints
}

export function add(a: Millipoints, b: Millipoints): Millipoints {
  return guard(a + b)
}

export function subtract(a: Millipoints, b: Millipoints): Millipoints {
  return guard(a - b)
}

export function sum(values: readonly Millipoints[]): Millipoints {
  let total = 0
  for (const value of values) total += value
  return guard(total)
}

/** Multiplie par un entier — par exemple 3 éléments à 0,5 point. */
export function times(value: Millipoints, factor: number): Millipoints {
  if (!Number.isInteger(factor)) {
    throw new MillipointsError(
      `Le facteur doit être entier (reçu ${factor}). Pour une fraction, utilisez ` +
        `percentOf ou distribute, dont la règle d'arrondi est explicite.`,
    )
  }
  return guard(value * factor)
}

/**
 * Applique un pourcentage, en arrondissant au millième le plus proche.
 *
 * Sert notamment aux plafonds relatifs : « plafonner le critère à 50 % en cas
 * de contradiction majeure ».
 */
export function percentOf(value: Millipoints, percent: number): Millipoints {
  if (!Number.isFinite(percent) || percent < 0) {
    throw new MillipointsError(`Pourcentage invalide : ${percent}`)
  }
  return guard(Math.round((value * percent) / 100))
}

export function min(a: Millipoints, b: Millipoints): Millipoints {
  return (a < b ? a : b) as Millipoints
}

export function max(a: Millipoints, b: Millipoints): Millipoints {
  return (a > b ? a : b) as Millipoints
}

/** Contraint une valeur dans un intervalle. Utilisé pour les plafonds et planchers. */
export function clamp(value: Millipoints, lower: Millipoints, upper: Millipoints): Millipoints {
  if (lower > upper) {
    throw new MillipointsError(`Intervalle inversé : [${lower}, ${upper}]`)
  }
  return min(max(value, lower), upper)
}

export function isZero(value: Millipoints): boolean {
  return value === 0
}

export function isNegative(value: Millipoints): boolean {
  return value < 0
}

/**
 * Répartit un total entre N parts égales, sans perdre ni créer un seul millième.
 *
 * C'est la règle du barème « points par élément » : par exemple 1 point pour
 * 3 éléments attendus. 1000 / 3 ne tombe pas juste ; le reste est distribué sur
 * les premières parts, dans un ordre stable.
 *
 * La somme des parts est TOUJOURS exactement égale au total : un étudiant qui
 * cite les trois éléments obtient le point entier, pas 0,999.
 *
 * @example distribute(millipoints(1), 3) → [334, 333, 333]
 */
export function distribute(total: Millipoints, parts: number): Millipoints[] {
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new MillipointsError(`Nombre de parts invalide : ${parts}`)
  }
  const base = Math.trunc(total / parts)
  const remainder = total - base * parts
  const sign = remainder < 0 ? -1 : 1
  const extras = Math.abs(remainder)

  return Array.from({ length: parts }, (_, index) =>
    guard(index < extras ? base + sign : base),
  )
}

/**
 * Arrondit à un pas donné — par exemple au quart de point.
 *
 * N'est appliqué qu'à la note finale d'une question, jamais aux calculs
 * intermédiaires, et la valeur exacte reste conservée à côté (ADR 0006).
 */
export function roundToStep(value: Millipoints, step: Millipoints): Millipoints {
  if (step <= 0) {
    throw new MillipointsError(`Pas d'arrondi invalide : ${step}`)
  }
  return guard(Math.round(value / step) * step)
}

/** Valeurs de pas courantes, pour l'arrondi d'affichage des notes. */
export const STEP = {
  QUARTER: 250 as Millipoints,
  HALF: 500 as Millipoints,
  WHOLE: 1000 as Millipoints,
  TENTH: 100 as Millipoints,
} as const
