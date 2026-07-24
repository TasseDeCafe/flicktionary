import { describe, expect, it } from 'vitest'
import type { LemmaRankInfo } from '../../transport/database/lemma-ranks/lemma-ranks-repository'
import {
  computeDifficulty,
  flooredCoveragePercent,
  labelForCoverage,
  type LemmaKnowledge,
  type ProfileTokenGroup,
} from './compute-difficulty'

const knowledge = (entries: Record<string, LemmaKnowledge>): Map<string, LemmaKnowledge> =>
  new Map(Object.entries(entries))
const ranks = (entries: Record<string, LemmaRankInfo>): Map<string, LemmaRankInfo> => new Map(Object.entries(entries))

describe('computeDifficulty', () => {
  it('blends P(known) per the design pins: known=1, retrievability for scheduled, 0 otherwise', () => {
    const groups: ProfileTokenGroup[] = [
      { tokenCount: 4, candidateLemmas: ['known1'] },
      { tokenCount: 2, candidateLemmas: ['scheduled1'] },
      { tokenCount: 2, candidateLemmas: ['savednew'] },
      { tokenCount: 2, candidateLemmas: ['stranger'] },
    ]
    const result = computeDifficulty({
      groups,
      knowledgeByLemma: knowledge({
        known1: { kind: 'known' },
        scheduled1: { kind: 'scheduled', retrievability: 0.5 },
        savednew: { kind: 'saved_not_started' },
      }),
      ranksByLemma: ranks({}),
    })
    // (4×1 + 2×0.5 + 2×0 + 2×0) / 10
    expect(result.expectedCoverage).toBeCloseTo(0.5)
    expect(result.matchedTokenCount).toBe(10)
    expect(result.unknownLemmas).toEqual(['stranger'])
    expect(result.savedNotStartedLemmas).toEqual(['savednew'])
    expect(result.knownLemmas).toEqual(['known1'])
  })

  it('conserves mass under ambiguity — an all-known ambiguous text can never exceed 100%', () => {
    // Every token has TWO known candidates; naive per-lemma summing would
    // count each token twice and report 200%.
    const groups: ProfileTokenGroup[] = [
      { tokenCount: 5, candidateLemmas: ['a', 'b'] },
      { tokenCount: 5, candidateLemmas: ['b', 'c'] },
    ]
    const result = computeDifficulty({
      groups,
      knowledgeByLemma: knowledge({
        a: { kind: 'known' },
        b: { kind: 'known' },
        c: { kind: 'known' },
      }),
      ranksByLemma: ranks({}),
    })
    expect(result.expectedCoverage).toBe(1)
  })

  it('takes max(P) across an ambiguous group, not the sum or the first', () => {
    const result = computeDifficulty({
      groups: [{ tokenCount: 10, candidateLemmas: ['weak', 'strong'] }],
      knowledgeByLemma: knowledge({
        weak: { kind: 'scheduled', retrievability: 0.2 },
        strong: { kind: 'scheduled', retrievability: 0.9 },
      }),
      ranksByLemma: ranks({}),
    })
    expect(result.expectedCoverage).toBeCloseTo(0.9)
  })

  it('a known candidate lifts a group even when another candidate is saved-not-started', () => {
    const result = computeDifficulty({
      groups: [{ tokenCount: 1, candidateLemmas: ['savednew', 'knownone'] }],
      knowledgeByLemma: knowledge({
        savednew: { kind: 'saved_not_started' },
        knownone: { kind: 'known' },
      }),
      ranksByLemma: ranks({}),
    })
    expect(result.expectedCoverage).toBe(1)
    // Not stuck at 0 → not in the saved-not-started bucket.
    expect(result.savedNotStartedLemmas).toEqual([])
  })

  it('saved-not-started keeps a group out of the unknown bucket', () => {
    const result = computeDifficulty({
      groups: [{ tokenCount: 3, candidateLemmas: ['savednew'] }],
      knowledgeByLemma: knowledge({ savednew: { kind: 'saved_not_started' } }),
      ranksByLemma: ranks({}),
    })
    expect(result.expectedCoverage).toBe(0)
    expect(result.unknownLemmas).toEqual([])
    expect(result.savedNotStartedLemmas).toEqual(['savednew'])
  })

  it('picks the highest-freq_mass candidate as the unknown representative and splits frequent by rank', () => {
    const result = computeDifficulty({
      groups: [
        { tokenCount: 1, candidateLemmas: ['rare', 'common'] },
        { tokenCount: 1, candidateLemmas: ['obscure'] },
      ],
      knowledgeByLemma: knowledge({}),
      ranksByLemma: ranks({
        rare: { rank: 40_000, freqMass: 0.000001 },
        common: { rank: 100, freqMass: 0.01 },
      }),
    })
    expect(result.unknownLemmas).toEqual(['common', 'obscure'])
    expect(result.frequentUnknownLemmas).toEqual(['common'])
  })

  it('ignores a known mark on an unranked candidate when the group has a ranked one', () => {
    // Pre-filtering sweeps marked junk homographs (musth next to must). The
    // junk P=1 must not mask the ranked lemma the user is actually studying.
    const result = computeDifficulty({
      groups: [{ tokenCount: 10, candidateLemmas: ['must', 'musth'] }],
      knowledgeByLemma: knowledge({
        must: { kind: 'scheduled', retrievability: 0.4 },
        musth: { kind: 'known' },
      }),
      ranksByLemma: ranks({ must: { rank: 50, freqMass: 0.001 } }),
    })
    expect(result.expectedCoverage).toBeCloseTo(0.4)
    expect(result.knownLemmas).toEqual([])
  })

  it('a junk-only known group with a ranked candidate counts as unknown, not covered', () => {
    const result = computeDifficulty({
      groups: [{ tokenCount: 5, candidateLemmas: ['must', 'musth'] }],
      knowledgeByLemma: knowledge({ musth: { kind: 'known' } }),
      ranksByLemma: ranks({ must: { rank: 50, freqMass: 0.001 } }),
    })
    expect(result.expectedCoverage).toBe(0)
    expect(result.unknownLemmas).toEqual(['must'])
  })

  it('keeps the known credit of an unranked candidate when no candidate is ranked', () => {
    // Sole-owner rare words stay creditable; a group entirely below the rank
    // floor is not the junk-homograph shape.
    const result = computeDifficulty({
      groups: [{ tokenCount: 2, candidateLemmas: ['musth'] }],
      knowledgeByLemma: knowledge({ musth: { kind: 'known' } }),
      ranksByLemma: ranks({}),
    })
    expect(result.expectedCoverage).toBe(1)
    expect(result.knownLemmas).toEqual(['musth'])
  })

  it('clamps out-of-range retrievability defensively', () => {
    const result = computeDifficulty({
      groups: [{ tokenCount: 1, candidateLemmas: ['weird'] }],
      knowledgeByLemma: knowledge({ weird: { kind: 'scheduled', retrievability: 1.7 } }),
      ranksByLemma: ranks({}),
    })
    expect(result.expectedCoverage).toBe(1)
  })

  it('returns null coverage for an empty profile', () => {
    const result = computeDifficulty({ groups: [], knowledgeByLemma: knowledge({}), ranksByLemma: ranks({}) })
    expect(result.expectedCoverage).toBeNull()
    expect(result.matchedTokenCount).toBe(0)
  })
})

describe('labels and display', () => {
  it('labels on the raw fraction with the extensive-reading thresholds', () => {
    expect(labelForCoverage(0.99)).toBe('comfortable')
    expect(labelForCoverage(0.98)).toBe('comfortable')
    expect(labelForCoverage(0.979)).toBe('challenging')
    expect(labelForCoverage(0.95)).toBe('challenging')
    expect(labelForCoverage(0.949)).toBe('frustrating')
  })

  it('floors the displayed percent so a shown 98% never carries a sub-0.98 label', () => {
    expect(flooredCoveragePercent(0.9799)).toBe(97)
    expect(labelForCoverage(0.9799)).toBe('challenging')
    expect(flooredCoveragePercent(0.981)).toBe(98)
    expect(flooredCoveragePercent(1)).toBe(100)
    expect(flooredCoveragePercent(0)).toBe(0)
  })
})
