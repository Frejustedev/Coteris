import { describe, expect, it } from 'vitest'
import { canonicalize, computeEventHash, hashesMatch, type HashableEvent } from './hash'

const SECRET = 'secret-de-test-suffisamment-long-pour-passer'
const AUTRE_SECRET = 'un-autre-secret-tout-aussi-long-que-le-premier'

const événement: HashableEvent = {
  organizationId: '00000000-0000-4000-8000-000000000001',
  sequence: 1,
  actorId: '00000000-0000-4000-8000-0000000000aa',
  actorRole: 'coordinator',
  action: 'rubric.lock',
  objectType: 'rubric_version',
  objectId: '00000000-0000-4000-8000-0000000000bb',
  previousValue: null,
  newValue: { lockedAt: '2026-07-31T10:00:00.000Z' },
  reason: 'Barème validé en commission',
  metadata: { source: 'web' },
  requestId: 'req-1',
  occurredAt: new Date('2026-07-31T10:00:00.000Z'),
}

describe('sérialisation canonique', () => {
  it('trie les clés, quel que soit leur ordre d’insertion', () => {
    // Le même objet relu depuis une colonne jsonb peut avoir un ordre de clés
    // différent de celui construit en mémoire. Sans tri, le hash changerait.
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }))
    expect(canonicalize({ z: { y: 1, x: 2 } })).toBe(canonicalize({ z: { x: 2, y: 1 } }))
  })

  it('conserve l’ordre des tableaux, qui est signifiant', () => {
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]))
  })

  it('sérialise les dates en ISO 8601 UTC', () => {
    expect(canonicalize(new Date('2026-07-31T10:00:00.000Z'))).toBe('"2026-07-31T10:00:00.000Z"')
  })

  it('traite null et undefined de la même façon', () => {
    expect(canonicalize(null)).toBe('null')
    expect(canonicalize(undefined)).toBe('null')
    // Une clé absente et une clé à undefined doivent produire le même résultat.
    expect(canonicalize({ a: 1, b: undefined })).toBe(canonicalize({ a: 1 }))
  })

  it('refuse les nombres non finis, qui rendraient le hash irreproductible', () => {
    expect(() => canonicalize({ x: Number.NaN })).toThrow(TypeError)
    expect(() => canonicalize({ x: Number.POSITIVE_INFINITY })).toThrow(TypeError)
  })

  it('gère les structures imbriquées', () => {
    const a = { liste: [{ b: 1, a: 2 }], date: new Date(0) }
    const b = { date: new Date(0), liste: [{ a: 2, b: 1 }] }
    expect(canonicalize(a)).toBe(canonicalize(b))
  })
})

describe('calcul du hash', () => {
  it('est stable pour un même événement', () => {
    const h1 = computeEventHash(événement, null, SECRET)
    const h2 = computeEventHash(événement, null, SECRET)
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
  })

  it('change dès qu’un champ change', () => {
    const référence = computeEventHash(événement, null, SECRET)

    const variantes: HashableEvent[] = [
      { ...événement, action: 'rubric.unlock' },
      { ...événement, actorId: '00000000-0000-4000-8000-0000000000cc' },
      { ...événement, reason: 'Autre motif' },
      { ...événement, sequence: 2 },
      { ...événement, newValue: { lockedAt: '2026-07-31T10:00:01.000Z' } },
      { ...événement, occurredAt: new Date('2026-07-31T10:00:01.000Z') },
    ]

    for (const variante of variantes) {
      expect(computeEventHash(variante, null, SECRET)).not.toBe(référence)
    }
  })

  it('change si le hash du prédécesseur change', () => {
    const a = computeEventHash(événement, 'aaaa', SECRET)
    const b = computeEventHash(événement, 'bbbb', SECRET)
    expect(a).not.toBe(b)
  })

  it('change si le secret change', () => {
    const a = computeEventHash(événement, null, SECRET)
    const b = computeEventHash(événement, null, AUTRE_SECRET)
    expect(a).not.toBe(b)
  })

  it('refuse un secret trop court', () => {
    expect(() => computeEventHash(événement, null, 'court')).toThrow(/32 caractères/)
  })

  it('ne dépend pas de l’ordre des clés dans les valeurs jsonb', () => {
    const construit = { ...événement, metadata: { source: 'web', ip: 'x' } }
    const relu = { ...événement, metadata: { ip: 'x', source: 'web' } }
    expect(computeEventHash(construit, null, SECRET)).toBe(computeEventHash(relu, null, SECRET))
  })
})

describe('comparaison de hash', () => {
  it('reconnaît deux hash identiques', () => {
    const h = computeEventHash(événement, null, SECRET)
    expect(hashesMatch(h, h)).toBe(true)
  })

  it('distingue deux hash différents', () => {
    const a = computeEventHash(événement, null, SECRET)
    const b = computeEventHash({ ...événement, sequence: 2 }, null, SECRET)
    expect(hashesMatch(a, b)).toBe(false)
  })

  it('gère des longueurs différentes sans lever', () => {
    expect(hashesMatch('abc', 'abcdef')).toBe(false)
  })
})

describe('chaînage', () => {
  it('lie chaque événement au précédent', () => {
    // Trois événements enchaînés.
    const e1 = { ...événement, sequence: 1 }
    const h1 = computeEventHash(e1, null, SECRET)

    const e2 = { ...événement, sequence: 2, action: 'submission.import' }
    const h2 = computeEventHash(e2, h1, SECRET)

    const e3 = { ...événement, sequence: 3, action: 'grade.finalize' }
    const h3 = computeEventHash(e3, h2, SECRET)

    // Modifier e1 invalide tout ce qui suit : c'est la propriété recherchée.
    const e1Falsifié = { ...e1, reason: 'Motif réécrit après coup' }
    const h1Falsifié = computeEventHash(e1Falsifié, null, SECRET)
    expect(h1Falsifié).not.toBe(h1)

    const h2Recalculé = computeEventHash(e2, h1Falsifié, SECRET)
    expect(h2Recalculé).not.toBe(h2)

    const h3Recalculé = computeEventHash(e3, h2Recalculé, SECRET)
    expect(h3Recalculé).not.toBe(h3)
  })
})
