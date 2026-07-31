import { describe, expect, it } from 'vitest'
import {
  MillipointsError,
  ZERO,
  add,
  clamp,
  distribute,
  formatPoints,
  fromMillipoints,
  isNegative,
  millipoints,
  percentOf,
  roundToStep,
  STEP,
  subtract,
  sum,
  times,
  toDisplayPoints,
  type Millipoints,
} from './millipoints'

describe('millipoints — conversion', () => {
  it('convertit les valeurs de barème courantes', () => {
    expect(millipoints(0)).toBe(0)
    expect(millipoints(0.25)).toBe(250)
    expect(millipoints(0.5)).toBe(500)
    expect(millipoints(1)).toBe(1000)
    expect(millipoints(2.75)).toBe(2750)
    expect(millipoints(20)).toBe(20000)
  })

  it("échappe à l'erreur de représentation binaire", () => {
    // 0.29 * 1000 vaut 289.99999999999994 en virgule flottante.
    expect(millipoints(0.29)).toBe(290)
    expect(millipoints(1.005)).toBe(1005)
    expect(millipoints(8.11)).toBe(8110)
  })

  it('accepte les valeurs négatives, pour les pénalités', () => {
    expect(millipoints(-0.5)).toBe(-500)
    expect(isNegative(millipoints(-0.5))).toBe(true)
  })

  it('rejette les valeurs non finies', () => {
    expect(() => millipoints(Number.NaN)).toThrow(MillipointsError)
    expect(() => millipoints(Number.POSITIVE_INFINITY)).toThrow(MillipointsError)
  })

  it('rejette les millièmes non entiers lus depuis la base', () => {
    expect(() => fromMillipoints(250.5)).toThrow(MillipointsError)
    expect(fromMillipoints(250)).toBe(250)
  })

  it('revient aux points décimaux', () => {
    expect(toDisplayPoints(millipoints(0.25))).toBe(0.25)
    expect(toDisplayPoints(millipoints(17.5))).toBe(17.5)
  })
})

describe('millipoints — le problème que tout ceci résout', () => {
  it('additionne exactement là où la virgule flottante échoue', () => {
    // La démonstration du problème.
    expect(0.1 + 0.2).not.toBe(0.3)

    // Et sa disparition.
    expect(add(millipoints(0.1), millipoints(0.2))).toBe(millipoints(0.3))
  })

  it('donne le même total quel que soit l’ordre de sommation', () => {
    const critères = [0.25, 0.5, 0.25, 1, 0.75, 0.1, 0.05].map(millipoints)
    const inversé = [...critères].reverse()
    const mélangé = [critères[3], critères[0], critères[6], critères[2], critères[5], critères[1], critères[4]]

    expect(sum(critères)).toBe(millipoints(2.9))
    expect(sum(inversé)).toBe(millipoints(2.9))
    expect(sum(mélangé as Millipoints[])).toBe(millipoints(2.9))
  })

  it('reste exact sur une copie longue', () => {
    const trenteCritères = Array.from({ length: 30 }, () => millipoints(0.1))
    expect(sum(trenteCritères)).toBe(millipoints(3))
    // En virgule flottante, la même somme donne 2.9999999999999996.
  })
})

describe('millipoints — opérations', () => {
  it('additionne et soustrait', () => {
    expect(add(millipoints(1), millipoints(0.5))).toBe(1500)
    expect(subtract(millipoints(1), millipoints(0.25))).toBe(750)
  })

  it('somme une liste vide à zéro', () => {
    expect(sum([])).toBe(ZERO)
  })

  it('multiplie par un entier', () => {
    expect(times(millipoints(0.5), 3)).toBe(1500)
    expect(times(millipoints(0.25), 0)).toBe(0)
  })

  it('refuse un facteur fractionnaire, dont la règle d’arrondi serait implicite', () => {
    expect(() => times(millipoints(1), 0.5)).toThrow(MillipointsError)
  })

  it('applique un pourcentage', () => {
    expect(percentOf(millipoints(1), 50)).toBe(500)
    expect(percentOf(millipoints(0.75), 50)).toBe(375)
    // 1/3 de point : l'arrondi est explicite et n'a lieu qu'ici.
    expect(percentOf(millipoints(1), 33.333)).toBe(333)
  })

  it('rejette un pourcentage négatif', () => {
    expect(() => percentOf(millipoints(1), -10)).toThrow(MillipointsError)
  })
})

describe('millipoints — plafonds', () => {
  it('contraint dans un intervalle', () => {
    const plancher = ZERO
    const plafond = millipoints(1)
    expect(clamp(millipoints(1.5), plancher, plafond)).toBe(1000)
    expect(clamp(millipoints(-0.5), plancher, plafond)).toBe(0)
    expect(clamp(millipoints(0.75), plancher, plafond)).toBe(750)
  })

  it('rejette un intervalle inversé', () => {
    expect(() => clamp(millipoints(1), millipoints(2), millipoints(0))).toThrow(MillipointsError)
  })

  it('plafonne le cas du cahier des charges : 0,5 point par indication, maximum 1 point', () => {
    const parIndication = millipoints(0.5)
    const plafond = millipoints(1)
    const troisIndications = times(parIndication, 3)
    expect(clamp(troisIndications, ZERO, plafond)).toBe(1000)
  })
})

describe('millipoints — répartition par élément', () => {
  it('répartit sans perdre ni créer un millième', () => {
    const parts = distribute(millipoints(1), 3)
    expect(parts).toEqual([334, 333, 333])
    expect(sum(parts)).toBe(millipoints(1))
  })

  it('répartit exactement quand la division tombe juste', () => {
    expect(distribute(millipoints(1), 4)).toEqual([250, 250, 250, 250])
    expect(distribute(millipoints(2), 2)).toEqual([1000, 1000])
  })

  it('conserve le total pour tout nombre de parts', () => {
    const total = millipoints(1)
    for (let parts = 1; parts <= 20; parts++) {
      expect(sum(distribute(total, parts))).toBe(total)
    }
  })

  it('répartit correctement un total négatif', () => {
    const parts = distribute(millipoints(-1), 3)
    expect(parts).toEqual([-334, -333, -333])
    expect(sum(parts)).toBe(millipoints(-1))
  })

  it('répartit zéro', () => {
    expect(distribute(ZERO, 3)).toEqual([0, 0, 0])
  })

  it('rejette un nombre de parts invalide', () => {
    expect(() => distribute(millipoints(1), 0)).toThrow(MillipointsError)
    expect(() => distribute(millipoints(1), -2)).toThrow(MillipointsError)
    expect(() => distribute(millipoints(1), 1.5)).toThrow(MillipointsError)
  })
})

describe('millipoints — arrondi d’affichage', () => {
  it('arrondit au quart de point', () => {
    expect(roundToStep(millipoints(0.6), STEP.QUARTER)).toBe(500)
    expect(roundToStep(millipoints(0.63), STEP.QUARTER)).toBe(750)
    expect(roundToStep(millipoints(0.875), STEP.QUARTER)).toBe(1000)
  })

  it('arrondit au demi-point et au point', () => {
    expect(roundToStep(millipoints(1.3), STEP.HALF)).toBe(1500)
    expect(roundToStep(millipoints(1.4), STEP.WHOLE)).toBe(1000)
    expect(roundToStep(millipoints(1.6), STEP.WHOLE)).toBe(2000)
  })

  it('rejette un pas nul ou négatif', () => {
    expect(() => roundToStep(millipoints(1), ZERO)).toThrow(MillipointsError)
  })
})

describe('millipoints — formatage francophone', () => {
  it('utilise la virgule décimale', () => {
    expect(formatPoints(millipoints(0.25))).toBe('0,25')
    expect(formatPoints(millipoints(1.5))).toBe('1,5')
  })

  it('n’affiche pas de décimales inutiles', () => {
    expect(formatPoints(millipoints(2))).toBe('2')
    expect(formatPoints(ZERO)).toBe('0')
  })

  it('formate les pénalités', () => {
    expect(formatPoints(millipoints(-0.5))).toBe('-0,5')
  })
})
