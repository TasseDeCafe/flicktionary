import { describe, expect, test } from 'vitest'
import type { LemmaRankInfo } from '../../transport/database/lemma-ranks/lemma-ranks-repository'
import { computeCoverage } from './coverage-math'

const ranks = (entries: Array<[string, number, number]>): Map<string, LemmaRankInfo> =>
  new Map(entries.map(([lemma, rank, freqMass]) => [lemma, { rank, freqMass }]))

describe('computeCoverage', () => {
  test('studied beats known for a shared lemma (read-time precedence)', () => {
    const result = computeCoverage({
      vocab: [{ headword: 'слово', hasVerifiedReview: false }],
      knownLemmas: ['слово', 'дом'],
      ranksByLemma: ranks([
        ['слово', 10, 0.5],
        ['дом', 20, 0.3],
      ]),
      targetLanguage: 'ru',
    })
    expect(result.studiedRanks).toEqual([10])
    expect(result.knownRanks).toEqual([20])
    // The shared lemma's mass counts exactly once.
    expect(result.coveredMass).toBeCloseTo(0.8)
  })

  test('verified mass counts only verified STUDIED lemmas — known marks stay claimed', () => {
    const result = computeCoverage({
      vocab: [
        { headword: 'один', hasVerifiedReview: true },
        { headword: 'два', hasVerifiedReview: false },
      ],
      knownLemmas: ['три'],
      ranksByLemma: ranks([
        ['один', 1, 0.4],
        ['два', 2, 0.2],
        ['три', 3, 0.1],
      ]),
      targetLanguage: 'ru',
    })
    expect(result.coveredMass).toBeCloseTo(0.7)
    expect(result.verifiedMass).toBeCloseTo(0.4)
  })

  test('a lemma is verified when ANY contributing saved sense is verified', () => {
    const result = computeCoverage({
      vocab: [
        { headword: 'банк', hasVerifiedReview: false },
        { headword: 'банк', hasVerifiedReview: true },
      ],
      knownLemmas: [],
      ranksByLemma: ranks([['банк', 5, 0.25]]),
      targetLanguage: 'ru',
    })
    expect(result.verifiedMass).toBeCloseTo(0.25)
    expect(result.studiedRanks).toEqual([5])
  })

  test('unranked lemmas contribute no dot and no mass', () => {
    const result = computeCoverage({
      vocab: [{ headword: 'редчайшее', hasVerifiedReview: true }],
      knownLemmas: ['небывалое'],
      ranksByLemma: ranks([]),
      targetLanguage: 'ru',
    })
    expect(result.studiedRanks).toEqual([])
    expect(result.knownRanks).toEqual([])
    expect(result.coveredMass).toBe(0)
    expect(result.verifiedMass).toBe(0)
  })

  test('band split respects the 1000/3000/10000 boundaries inclusively', () => {
    const entries: Array<[string, number, number]> = [
      ['a', 1000, 0.1],
      ['b', 1001, 0.2],
      ['c', 3000, 0.3],
      ['d', 3001, 0.4],
      ['e', 10000, 0.5],
      ['f', 10001, 0.6],
    ]
    const result = computeCoverage({
      vocab: entries.map(([lemma]) => ({ headword: lemma, hasVerifiedReview: false })),
      knownLemmas: [],
      ranksByLemma: ranks(entries),
      targetLanguage: 'en',
    })
    expect(result.bandCoveredMasses).toHaveLength(4)
    expect(result.bandCoveredMasses[0]).toBeCloseTo(0.1)
    expect(result.bandCoveredMasses[1]).toBeCloseTo(0.5)
    expect(result.bandCoveredMasses[2]).toBeCloseTo(0.9)
    expect(result.bandCoveredMasses[3]).toBeCloseTo(0.6)
  })

  test('en "to run" is a dot (particle strips away), not an expression', () => {
    const result = computeCoverage({
      vocab: [{ headword: 'to run', hasVerifiedReview: false }],
      knownLemmas: [],
      ranksByLemma: ranks([['run', 100, 0.2]]),
      targetLanguage: 'en',
    })
    expect(result.mweCount).toBe(0)
    expect(result.studiedRanks).toEqual([100])
  })

  test('true MWEs count as distinct folded expressions, deduped across senses', () => {
    const result = computeCoverage({
      vocab: [
        { headword: 'kick the bucket', hasVerifiedReview: false },
        { headword: 'Kick the Bucket', hasVerifiedReview: true },
        { headword: 'by and large', hasVerifiedReview: false },
      ],
      knownLemmas: [],
      ranksByLemma: ranks([]),
      targetLanguage: 'en',
    })
    expect(result.mweCount).toBe(2)
    // Expressions never enter the dot/mass space.
    expect(result.studiedRanks).toEqual([])
    expect(result.coveredMass).toBe(0)
  })

  test('duplicate known lemmas dedupe to one dot', () => {
    const result = computeCoverage({
      vocab: [],
      knownLemmas: ['дом', 'дом'],
      ranksByLemma: ranks([['дом', 7, 0.3]]),
      targetLanguage: 'ru',
    })
    expect(result.knownRanks).toEqual([7])
    expect(result.coveredMass).toBeCloseTo(0.3)
  })

  test('counts mirror the rank arrays', () => {
    const result = computeCoverage({
      vocab: [{ headword: 'один', hasVerifiedReview: false }],
      knownLemmas: ['два'],
      ranksByLemma: ranks([
        ['один', 1, 0.4],
        ['два', 2, 0.2],
      ]),
      targetLanguage: 'ru',
    })
    expect(result.studiedCount).toBe(1)
    expect(result.knownCount).toBe(1)
  })
})
