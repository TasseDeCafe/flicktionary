import { describe, expect, it } from 'vitest'
import { countBookPartLemmas, lemmasNeedingRanks } from './book-lemma-counts'

const ranks = (entries: Record<string, number>) =>
  new Map(Object.entries(entries).map(([lemma, rank]) => [lemma, { rank, freqMass: 0 }]))

describe('countBookPartLemmas', () => {
  it('sums occurrences of a lemma across its inflected tokens', () => {
    const counts = countBookPartLemmas(
      [
        { foldedToken: 'метла', tokenCount: 3, candidateLemmas: ['метла'] },
        { foldedToken: 'метлу', tokenCount: 5, candidateLemmas: ['метла'] },
      ],
      ranks({})
    )
    expect(counts.get('метла')).toBe(8)
  })

  it('drops a guard-rejected homograph reading («при» never counts toward «переть»)', () => {
    const counts = countBookPartLemmas(
      [{ foldedToken: 'при', tokenCount: 40, candidateLemmas: ['при', 'переть'] }],
      ranks({ при: 25, переть: 20000 })
    )
    expect(counts.get('при')).toBe(40)
    expect(counts.has('переть')).toBe(false)
  })

  it('credits every surviving reading the full count, identity readings included', () => {
    const counts = countBookPartLemmas(
      [{ foldedToken: 'стали', tokenCount: 6, candidateLemmas: ['сталь', 'стать'] }],
      ranks({ стать: 150, сталь: 2900 })
    )
    expect(counts.get('стать')).toBe(6)
    expect(counts.get('сталь')).toBe(6)
  })

  it('keeps every reading of a token with no ranked candidate', () => {
    const counts = countBookPartLemmas(
      [{ foldedToken: 'шмыга', tokenCount: 2, candidateLemmas: ['шмыга', 'шмыгать'] }],
      ranks({})
    )
    expect(counts.get('шмыга')).toBe(2)
    expect(counts.get('шмыгать')).toBe(2)
  })
})

describe('lemmasNeedingRanks', () => {
  it('lists only the lemmas of ambiguous groups', () => {
    expect(
      lemmasNeedingRanks([
        { foldedToken: 'стол', tokenCount: 1, candidateLemmas: ['стол'] },
        { foldedToken: 'стали', tokenCount: 1, candidateLemmas: ['сталь', 'стать'] },
      ]).sort()
    ).toEqual(['сталь', 'стать'])
  })
})
