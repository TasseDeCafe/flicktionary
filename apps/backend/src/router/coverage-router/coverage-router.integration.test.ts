import { describe, expect, test, vi } from 'vitest'
import request from 'supertest'
import { buildAuthorizationHeaders, buildTestApp, __generateUniqueId } from '../../test/test-utils'
import { MockAnthropicPasses } from '../../transport/third-party/anthropic/anthropic-passes'
import { UserTargetLanguagePrefsRepository } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import { KnownLemmasRepository } from '../../transport/database/known-lemmas/known-lemmas-repository'
import { PracticeRatingEventsRepository } from '../../transport/database/practice-rating-events/practice-rating-events-repository'
import { sql } from '../../transport/database/postgres-client'
import { setupCheckpointUser } from '../study-sessions-router/checkpoint-test-helpers'

// The whole-language coverage read over real HTTP. Each test seeds a per-test
// unique fake language (the lemma_rank_builds manifest row IS the supported
// gate, so synthetic codes are first-class citizens of the shared test DB).
describe('coverage router', () => {
  const testApp = buildTestApp({ anthropicPasses: MockAnthropicPasses({}) })

  // Saved terms are seeded directly (the adhoc endpoint validates target
  // languages, and the fake-language isolation is what makes exact mass
  // assertions possible on the shared test DB).
  const insertLookup = async (userId: string, targetLanguage: string, headword: string): Promise<string> => {
    const [row] = (await sql`
      INSERT INTO public.user_lookups (user_id, target_language, headword, sense, count)
      VALUES (${userId}, ${targetLanguage}, ${headword}, '', 1)
      RETURNING id
    `) as [{ id: string }]
    return row.id
  }

  const seedLanguage = async (ranks: Array<[string, number, number]>): Promise<string> => {
    const language = __generateUniqueId('zz')
    await sql`
      INSERT INTO public.lemma_rank_builds (target_language, version, wordfreq_version, row_count, mass_matched_pct)
      VALUES (${language}, 3, 'test', ${ranks.length}, 99.9)
    `
    for (const [lemma, rank, freqMass] of ranks) {
      await sql`
        INSERT INTO public.lemma_ranks (target_language, lemma, rank, freq_mass)
        VALUES (${language}, ${lemma}, ${rank}, ${freqMass})
      `
    }
    return language
  }

  test('returns 401 when unauthenticated', async () => {
    const coverage = await request(testApp).get('/api/v1/coverage').set({ Authorization: 'Bearer wrong-token' })
    expect(coverage.status).toBe(401)
    const lemmas = await request(testApp).get('/api/v1/coverage/ru/lemmas').set({ Authorization: 'Bearer wrong-token' })
    expect(lemmas.status).toBe(401)
  })

  test('golden path: blended headline, verified split, precedence, bands, snapshot', async () => {
    const { userId, token } = await setupCheckpointUser(testApp)
    // Four ranked lemmas: a verified studied term (rank 1), a known mark
    // (rank 2), an unverified studied term (rank 1500), an untouched one
    // (rank 3500). Total mass 1.0 for round percentages.
    const verifiedWord = __generateUniqueId('verified')
    const knownWord = __generateUniqueId('known')
    const unverifiedWord = __generateUniqueId('unverified')
    const language = await seedLanguage([
      [verifiedWord, 1, 0.4],
      [knownWord, 2, 0.3],
      [unverifiedWord, 1500, 0.2],
      [__generateUniqueId('untouched'), 3500, 0.1],
    ])
    await UserTargetLanguagePrefsRepository().upsertCefr(userId, language, 'B1')

    const verifiedLookupId = await insertLookup(userId, language, verifiedWord)
    await insertLookup(userId, language, unverifiedWord)
    // The verified term ALSO carries a known mark — studied must win the dot.
    await KnownLemmasRepository().bulkMarkKnown({
      userId,
      targetLanguage: language,
      lemmas: [knownWord, verifiedWord],
      source: 'bulk_text',
      sourceId: null,
      sweepBatchId: null,
    })
    // Verifying evidence: a live explicit good on the meaning skill.
    await PracticeRatingEventsRepository().insert({
      userId,
      userLookupId: verifiedLookupId,
      targetLanguage: language,
      pool: 'recognition',
      skill: 'meaning_recognition',
      targetForm: '',
      rating: 'good',
      wasIntroduction: false,
      wasExplicit: true,
      causedParking: false,
      practiceTextId: null,
      studySessionId: null,
      checkpointId: null,
      headword: verifiedWord,
      sense: 'sense',
      prevSrsState: 'review',
      prevSrsDue: new Date().toISOString(),
      prevSrsStability: 5,
      prevSrsDifficulty: 5,
      prevSrsLastReview: new Date().toISOString(),
      prevSrsReps: 1,
      prevSrsLapses: 0,
      prevSrsLearningSteps: 0,
    })

    const response = await request(testApp).get('/api/v1/coverage').set(buildAuthorizationHeaders(token))
    expect(response.status).toBe(200)
    const entry = response.body.data.languages.find((l: { targetLanguage: string }) => l.targetLanguage === language)
    expect(entry).toBeDefined()
    expect(entry.supported).toBe(true)
    expect(entry.denominator).toBe(4)
    expect(entry.buildVersion).toBe(3)
    expect(entry.studiedRanks).toEqual([1, 1500])
    expect(entry.knownRanks).toEqual([2])
    expect(entry.coveragePct).toBeCloseTo(90)
    expect(entry.verifiedPct).toBeCloseTo(40)
    expect(entry.mweCount).toBe(0)
    expect(entry.bands).toHaveLength(4)
    expect(entry.bands[0]).toMatchObject({ fromRank: 1, toRank: 1000 })
    expect(entry.bands[0].coveragePct).toBeCloseTo(100)
    expect(entry.bands[1].coveragePct).toBeCloseTo(100)
    expect(entry.bands[2].coveragePct).toBeCloseTo(0)
    expect(entry.bands[3]).toMatchObject({ fromRank: 10001, toRank: null })

    // The lazy snapshot is fire-and-forget — poll for it.
    await vi.waitFor(async () => {
      const rows = await sql`
        SELECT studied_count, known_count, coverage_pct FROM public.coverage_snapshots
        WHERE user_id = ${userId} AND target_language = ${language}
      `
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ studied_count: 2, known_count: 1 })
      expect(Number(rows[0].coverage_pct)).toBeCloseTo(90)
    })
  })

  test('a practiced language without a build row reports supported:false', async () => {
    const { userId, token } = await setupCheckpointUser(testApp)
    const unbuilt = __generateUniqueId('zz')
    await UserTargetLanguagePrefsRepository().upsertCefr(userId, unbuilt, 'B1')

    const response = await request(testApp).get('/api/v1/coverage').set(buildAuthorizationHeaders(token))
    expect(response.status).toBe(200)
    const entry = response.body.data.languages.find((l: { targetLanguage: string }) => l.targetLanguage === unbuilt)
    expect(entry).toMatchObject({
      supported: false,
      denominator: null,
      coveragePct: null,
      studiedRanks: [],
      knownRanks: [],
      bands: [],
    })
  })

  test('getTopLemmas returns the build-stamped head of the list; unknown language is 404', async () => {
    const { token } = await setupCheckpointUser(testApp)
    const language = await seedLanguage([
      ['beta', 2, 0.3],
      ['alpha', 1, 0.5],
    ])

    const response = await request(testApp)
      .get(`/api/v1/coverage/${language}/lemmas`)
      .set(buildAuthorizationHeaders(token))
    expect(response.status).toBe(200)
    expect(response.body.data).toEqual({ buildVersion: 3, lemmas: ['alpha', 'beta'] })

    const missing = await request(testApp)
      .get(`/api/v1/coverage/${__generateUniqueId('zz')}/lemmas`)
      .set(buildAuthorizationHeaders(token))
    expect(missing.status).toBe(404)
  })
})
