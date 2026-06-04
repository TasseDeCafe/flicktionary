import { describe, expect, it } from 'vitest'
import {
  damerauLevenshtein,
  gradeMcAnswer,
  gradeProductionClozeAnswer,
  normalizeTypedAnswer,
} from './grade-exercise'

describe('normalizeTypedAnswer', () => {
  it('strips diacritics, lowercases, and trims', () => {
    expect(normalizeTypedAnswer('  Árbol ')).toBe('arbol')
    expect(normalizeTypedAnswer('STRAßE')).toBe('straße') // ß is not a combining mark — preserved
    expect(normalizeTypedAnswer('café')).toBe('cafe')
    expect(normalizeTypedAnswer('останься')).toBe('останься')
  })
})

describe('damerauLevenshtein', () => {
  it('computes classic edit distances', () => {
    expect(damerauLevenshtein('kitten', 'sitting')).toBe(3)
    expect(damerauLevenshtein('', 'abc')).toBe(3)
    expect(damerauLevenshtein('abc', 'abc')).toBe(0)
  })

  it('counts an adjacent transposition as one edit', () => {
    expect(damerauLevenshtein('abcd', 'abdc')).toBe(1)
    expect(damerauLevenshtein('ca', 'ac')).toBe(1)
  })
})

describe('gradeMcAnswer', () => {
  it('is index equality against the stored answerIndex', () => {
    expect(gradeMcAnswer({ answerIndex: 2 }, 2)).toBe(true)
    expect(gradeMcAnswer({ answerIndex: 2 }, 0)).toBe(false)
  })
})

describe('gradeProductionClozeAnswer', () => {
  const payload = { answer: 'aproveché', acceptedForms: ['aproveché'] }

  it('accepts the exact answer', () => {
    expect(gradeProductionClozeAnswer(payload, 'aproveché')).toBe(true)
  })

  it('accepts accent-stripped input', () => {
    expect(gradeProductionClozeAnswer(payload, 'aproveche')).toBe(true)
  })

  it('accepts one typo (substitution)', () => {
    expect(gradeProductionClozeAnswer(payload, 'aprobeche')).toBe(true)
  })

  it('accepts one adjacent transposition', () => {
    expect(gradeProductionClozeAnswer(payload, 'aporveche')).toBe(true)
  })

  it('accepts accent-stripped input PLUS one typo (normalization is free)', () => {
    // 'aprobeche' vs normalized answer 'aproveche': distance 1 after stripping.
    expect(gradeProductionClozeAnswer({ answer: 'aproveché', acceptedForms: [] }, ' Aprobeche ')).toBe(true)
  })

  it('rejects two edits', () => {
    expect(gradeProductionClozeAnswer(payload, 'aprobechi')).toBe(false)
  })

  it('rejects an empty answer even against a short form', () => {
    expect(gradeProductionClozeAnswer({ answer: 'a', acceptedForms: [] }, '  ')).toBe(false)
  })

  it('accepts a listed alternate form exactly', () => {
    const alt = { answer: 'colour', acceptedForms: ['color'] }
    expect(gradeProductionClozeAnswer(alt, 'color')).toBe(true)
  })
})
