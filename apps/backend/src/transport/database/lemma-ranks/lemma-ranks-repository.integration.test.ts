import { describe, expect, test } from 'vitest'
import { LemmaRanksRepository } from './lemma-ranks-repository'
import { sql } from '../postgres-client'
import { __generateUniqueId } from '../../../test/test-utils'

const repo = LemmaRanksRepository()

// A per-test unique fake language code keeps the shared test DB honest: the
// manifest row is the supported gate, so a synthetic language is fully valid.
const seedLanguage = async (ranks: Array<[string, number, number]>): Promise<string> => {
  const language = __generateUniqueId('zz')
  await sql`
    INSERT INTO public.lemma_rank_builds (target_language, version, wordfreq_version, row_count, mass_matched_pct)
    VALUES (${language}, 7, 'test', ${ranks.length}, 99.9)
  `
  for (const [lemma, rank, freqMass] of ranks) {
    await sql`
      INSERT INTO public.lemma_ranks (target_language, lemma, rank, freq_mass)
      VALUES (${language}, ${lemma}, ${rank}, ${freqMass})
    `
  }
  return language
}

describe('lemma-ranks coverage reads', () => {
  test("getCoverageData returns one build's totals, bands, and requested ranks", async () => {
    const language = await seedLanguage([
      ['a', 1, 0.4],
      ['b', 1000, 0.1],
      ['c', 2500, 0.2],
      ['d', 9000, 0.15],
      ['e', 12000, 0.05],
    ])
    const data = await repo.getCoverageData({
      targetLanguage: language,
      lemmas: ['a', 'd', 'missing'],
      bandUpperBounds: [1000, 3000, 10000],
    })
    expect(data).not.toBeNull()
    expect(data!.aggregate.version).toBe(7)
    expect(data!.aggregate.rowCount).toBe(5)
    expect(data!.aggregate.totalMass).toBeCloseTo(0.9)
    expect(data!.aggregate.bandMasses[0]).toBeCloseTo(0.5)
    expect(data!.aggregate.bandMasses[1]).toBeCloseTo(0.2)
    expect(data!.aggregate.bandMasses[2]).toBeCloseTo(0.15)
    expect(data!.aggregate.bandMasses[3]).toBeCloseTo(0.05)
    expect(data!.ranksByLemma).toEqual(
      new Map([
        ['a', { rank: 1, freqMass: 0.4 }],
        ['d', { rank: 9000, freqMass: 0.15 }],
      ])
    )
    const emptyVocabulary = await repo.getCoverageData({
      targetLanguage: language,
      lemmas: [],
      bandUpperBounds: [1000, 3000, 10000],
    })
    expect(emptyVocabulary?.aggregate.version).toBe(7)
    expect(emptyVocabulary?.ranksByLemma.size).toBe(0)
    expect(
      await repo.getCoverageData({
        targetLanguage: __generateUniqueId('zz'),
        lemmas: [],
        bandUpperBounds: [1000, 3000, 10000],
      })
    ).toBeNull()
  })

  test('getTopLemmasBuild returns the manifest version with its ranked head', async () => {
    const language = await seedLanguage([
      ['third', 3, 0.1],
      ['first', 1, 0.5],
      ['second', 2, 0.3],
      ['fourth', 4, 0.05],
    ])
    expect(await repo.getTopLemmasBuild({ targetLanguage: language, limit: 3 })).toEqual({
      version: 7,
      lemmas: ['first', 'second', 'third'],
    })
    expect(await repo.getTopLemmasBuild({ targetLanguage: __generateUniqueId('zz'), limit: 3 })).toBeNull()
  })
})
