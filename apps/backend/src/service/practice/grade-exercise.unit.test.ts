import { describe, expect, it } from 'vitest'
import { gradeMcAnswer, gradeProductionClozeAnswer } from './grade-exercise'

// normalizeTypedAnswer / damerauLevenshtein are covered where they live:
// packages/core/src/utils/typed-answer-grading.unit.test.ts.

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
