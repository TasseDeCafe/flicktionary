import { describe, expect, it } from 'vitest'
import { damerauLevenshtein, isTypedAnswerAccepted, normalizeTypedAnswer } from './typed-answer-grading'

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

describe('isTypedAnswerAccepted', () => {
  it('accepts the exact answer', () => {
    expect(isTypedAnswerAccepted(['aproveché'], 'aproveché')).toBe(true)
  })

  it('accepts accent-stripped input', () => {
    expect(isTypedAnswerAccepted(['aproveché'], 'aproveche')).toBe(true)
  })

  it('accepts accent-stripped input PLUS one typo (normalization is free)', () => {
    expect(isTypedAnswerAccepted(['aproveché'], ' Aprobeche ')).toBe(true)
  })

  it('rejects two edits', () => {
    expect(isTypedAnswerAccepted(['aproveché'], 'aprobechi')).toBe(false)
  })

  it('rejects an empty answer even against a short form', () => {
    expect(isTypedAnswerAccepted(['a'], '  ')).toBe(false)
  })

  it('accepts any listed form', () => {
    expect(isTypedAnswerAccepted(['colour', 'color'], 'color')).toBe(true)
  })
})
