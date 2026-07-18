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

describe('lemma-ranks aggregates', () => {
  test('listBuildAggregates returns exact totals and per-band masses (incl. tail)', async () => {
    const language = await seedLanguage([
      ['a', 1, 0.4],
      ['b', 1000, 0.1],
      ['c', 2500, 0.2],
      ['d', 9000, 0.15],
      ['e', 12000, 0.05],
    ])
    const aggregates = await repo.listBuildAggregates([1000, 3000, 10000])
    const aggregate = aggregates.get(language)
    expect(aggregate).toBeDefined()
    expect(aggregate!.version).toBe(7)
    expect(aggregate!.rowCount).toBe(5)
    expect(aggregate!.totalMass).toBeCloseTo(0.9)
    expect(aggregate!.bandMasses[0]).toBeCloseTo(0.5)
    expect(aggregate!.bandMasses[1]).toBeCloseTo(0.2)
    expect(aggregate!.bandMasses[2]).toBeCloseTo(0.15)
    expect(aggregate!.bandMasses[3]).toBeCloseTo(0.05)
  })

  test('findBuildManifest returns the build row, null for unknown languages', async () => {
    const language = await seedLanguage([['a', 1, 0.5]])
    expect(await repo.findBuildManifest(language)).toEqual({ version: 7, rowCount: 1 })
    expect(await repo.findBuildManifest(__generateUniqueId('zz'))).toBeNull()
  })

  test('listTopLemmas returns the head of the list in rank order', async () => {
    const language = await seedLanguage([
      ['third', 3, 0.1],
      ['first', 1, 0.5],
      ['second', 2, 0.3],
      ['fourth', 4, 0.05],
    ])
    expect(await repo.listTopLemmas({ targetLanguage: language, limit: 3 })).toEqual(['first', 'second', 'third'])
  })
})
