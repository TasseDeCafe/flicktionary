import { describe, expect, it } from 'vitest'
import { countBookPartLemmas, lemmasNeedingRanks, mostLikelyReading } from './book-lemma-counts'

// freq_mass falls as rank grows, like the real build.
const ranks = (entries: Record<string, number>) =>
  new Map(Object.entries(entries).map(([lemma, rank]) => [lemma, { rank, freqMass: 1 / rank }]))

describe('countBookPartLemmas', () => {
  it('sums occurrences of a lemma across its inflected tokens', () => {
    const counts = countBookPartLemmas(
      [
        { foldedToken: 'метла', tokenCount: 3, candidateLemmas: ['метла'] },
        { foldedToken: 'метлу', tokenCount: 5, candidateLemmas: ['метла'] },
      ],
      ranks({})
    )
    expect(counts.get('метла')).toEqual({ occurrences: 8, primaryOccurrences: 8 })
  })

  it('drops a guard-rejected homograph reading («при» never counts toward «переть»)', () => {
    const counts = countBookPartLemmas(
      [{ foldedToken: 'при', tokenCount: 40, candidateLemmas: ['при', 'переть'] }],
      ranks({ при: 25, переть: 20000 })
    )
    expect(counts.get('при')).toEqual({ occurrences: 40, primaryOccurrences: 40 })
    expect(counts.has('переть')).toBe(false)
  })

  it('credits every surviving reading the full count, but only the most likely one the primary count', () => {
    const counts = countBookPartLemmas(
      [
        { foldedToken: 'стали', tokenCount: 6, candidateLemmas: ['сталь', 'стать'] },
        { foldedToken: 'сталь', tokenCount: 2, candidateLemmas: ['сталь'] },
      ],
      ranks({ стать: 150, сталь: 2900 })
    )
    expect(counts.get('стать')).toEqual({ occurrences: 6, primaryOccurrences: 6 })
    expect(counts.get('сталь')).toEqual({ occurrences: 8, primaryOccurrences: 2 })
  })

  it('keeps every reading of a token with no ranked candidate', () => {
    const counts = countBookPartLemmas(
      [{ foldedToken: 'шмыга', tokenCount: 2, candidateLemmas: ['шмыга', 'шмыгать'] }],
      ranks({})
    )
    expect(counts.get('шмыга')).toEqual({ occurrences: 2, primaryOccurrences: 2 })
    expect(counts.get('шмыгать')).toEqual({ occurrences: 2, primaryOccurrences: 0 })
  })
})

describe('mostLikelyReading', () => {
  it('picks the most frequent reading, unranked ones weighing nothing', () => {
    expect(mostLikelyReading(['полк', 'полка', 'полок'], ranks({ полка: 3037, полк: 2164, полок: 15434 }))).toBe('полк')
    expect(mostLikelyReading(['шмыгать', 'шмыга'], ranks({}))).toBe('шмыга')
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
