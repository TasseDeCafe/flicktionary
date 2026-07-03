import { describe, expect, it } from 'vitest'
import type { RecapTerm } from './build-recap-questions'
import { buildRecapQuestions, buildRedrillQuestion } from './build-recap-questions'

// Deterministic rng: cycles through a fixed sequence so shuffles are stable.
const seededRng = (): (() => number) => {
  let n = 0
  return () => {
    n = (n * 9301 + 49297) % 233280
    return n / 233280
  }
}

const term = (overrides: Partial<RecapTerm> & { chunkId: string }): RecapTerm => ({
  cardId: `card-${overrides.chunkId}`,
  headword: `word-${overrides.chunkId}`,
  surfaceForm: `word-${overrides.chunkId}`,
  gloss: `gloss-${overrides.chunkId}`,
  pos: null,
  targetExample: null,
  ...overrides,
})

const manyTerms = (count: number, overrides: Partial<RecapTerm> = {}): RecapTerm[] =>
  Array.from({ length: count }, (_, i) => term({ chunkId: `t${i}`, ...overrides }))

describe('buildRecapQuestions', () => {
  it('produces one question per term, mixing MC and typed', () => {
    const terms = manyTerms(6)
    const questions = buildRecapQuestions(terms, seededRng())
    expect(questions).toHaveLength(6)
    expect(new Set(questions.map((q) => q.term.chunkId)).size).toBe(6)
    expect(questions.some((q) => q.kind === 'mc')).toBe(true)
    expect(questions.some((q) => q.kind === 'typed')).toBe(true)
    expect(questions.every((q) => !q.isRedrill)).toBe(true)
  })

  it('falls back to typed for a single term (no distractors possible)', () => {
    const questions = buildRecapQuestions([term({ chunkId: 'only' })], seededRng())
    expect(questions).toHaveLength(1)
    expect(questions[0]!.kind).toBe('typed')
  })

  it('allows a 3-option MC when only 2 usable distractors exist', () => {
    const questions = buildRecapQuestions(manyTerms(3), seededRng())
    const mc = questions.find((q) => q.kind === 'mc')
    expect(mc).toBeDefined()
    if (mc?.kind === 'mc') {
      expect(mc.options).toHaveLength(3)
      expect(mc.options[mc.answerIndex]).toBe(mc.term.gloss)
    }
  })

  it('never offers a distractor that normalizes to the correct gloss', () => {
    const terms = [
      term({ chunkId: 'a', gloss: 'to run' }),
      term({ chunkId: 'b', gloss: ' TO RUN ' }), // same answer, different casing
      term({ chunkId: 'c', gloss: 'to walk' }),
      term({ chunkId: 'd', gloss: 'to swim' }),
      term({ chunkId: 'e', gloss: 'to fly' }),
    ]
    for (const q of buildRecapQuestions(terms, seededRng())) {
      if (q.kind !== 'mc') continue
      const correct = q.options[q.answerIndex]!.trim().toLowerCase()
      const duplicates = q.options.filter((o) => o.trim().toLowerCase() === correct)
      expect(duplicates).toHaveLength(1)
    }
  })

  it('prefers same-POS distractors only when they can fill every slot', () => {
    const terms = [
      term({ chunkId: 'target', pos: 'verb', gloss: 'to arise' }),
      term({ chunkId: 'v1', pos: 'verb', gloss: 'to join' }),
      term({ chunkId: 'v2', pos: 'verb', gloss: 'to suit' }),
      term({ chunkId: 'v3', pos: 'verb', gloss: 'to improve' }),
      term({ chunkId: 'n1', pos: 'noun', gloss: 'a shortage' }),
    ]
    // Run several deterministic builds; whenever the target term comes out as
    // MC, its distractors must all be verb glosses (3 same-POS candidates
    // exist, so the noun must never appear).
    for (let seed = 0; seed < 10; seed++) {
      const rng = seededRng()
      for (let i = 0; i < seed; i++) rng()
      const questions = buildRecapQuestions(terms, rng)
      const q = questions.find((x) => x.term.chunkId === 'target')
      if (q?.kind === 'mc') {
        expect(q.options).not.toContain('a shortage')
      }
    }
  })

  it('finds the span via surface form, then headword, then gives up', () => {
    const bySurface = term({
      chunkId: 's',
      headword: 'возникать',
      surfaceForm: 'возникают',
      targetExample: 'Проблемы возникают внезапно.',
    })
    const byHeadword = term({
      chunkId: 'h',
      headword: 'прочный',
      surfaceForm: 'прочную',
      targetExample: 'Это прочный материал.',
    })
    const missing = term({
      chunkId: 'm',
      headword: 'устраивать',
      surfaceForm: 'устраивал',
      targetExample: 'Это меня не устроило.',
    })
    const questions = [bySurface, byHeadword, missing].map((t) => buildRecapQuestions([t], seededRng())[0]!)
    expect(questions[0]!.kind === 'typed' && questions[0]!.blanked).toMatchObject({ start: 9, end: 18 })
    expect(questions[1]!.kind === 'typed' && questions[1]!.blanked).toMatchObject({ start: 4, end: 11 })
    expect(questions[2]!.kind === 'typed' && questions[2]!.blanked).toBeNull()
  })

  it('dedupes accepted forms when the surface form equals the headword', () => {
    const q = buildRecapQuestions([term({ chunkId: 'x', headword: 'дом', surfaceForm: 'Дом' })], seededRng())[0]!
    expect(q.kind === 'typed' && q.acceptedForms).toEqual(['дом'])
  })
})

describe('buildRedrillQuestion', () => {
  const terms = manyTerms(5)

  it('flips a missed MC to typed', () => {
    const redrill = buildRedrillQuestion(terms[0]!, terms, 'mc', seededRng())
    expect(redrill.kind).toBe('typed')
    expect(redrill.isRedrill).toBe(true)
    expect(redrill.key).toBe(`${terms[0]!.chunkId}:redrill`)
  })

  it('flips a missed typed question to MC when distractors exist', () => {
    const redrill = buildRedrillQuestion(terms[0]!, terms, 'typed', seededRng())
    expect(redrill.kind).toBe('mc')
  })

  it('repeats typed when MC cannot be built', () => {
    const only = term({ chunkId: 'solo' })
    const redrill = buildRedrillQuestion(only, [only], 'typed', seededRng())
    expect(redrill.kind).toBe('typed')
  })
})
