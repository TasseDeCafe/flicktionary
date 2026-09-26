import { describe, expect, test, vi } from 'vitest'
import request from 'supertest'
import { buildAuthorizationHeaders, buildTestApp } from '../../test/test-utils'
import { MockAnthropicPasses } from '../../transport/third-party/anthropic/anthropic-passes'
import { LemmaLookupsRepository } from '../../transport/database/lemma-lookups/lemma-lookups-repository'
import { sql } from '../../transport/database/postgres-client'
import {
  insertWiktionaryLemma,
  saveAdhocTerm,
  setupCheckpointUser,
  uniqueCyrillicSuffix,
} from '../study-sessions-router/checkpoint-test-helpers'

// glosses.recordLookup end to end: explicit lookups become new-term demand.
// Words are unique nonsense Russian lemmas seeded into the shared wiktionary
// tables, so each test resolves only its own tokens.
describe('glosses-router: recordLookup', () => {
  const basicDataPass = vi.fn()
  const testApp = buildTestApp({
    anthropicPasses: MockAnthropicPasses({ basicDataPass: basicDataPass as never }),
  })

  const recordLookup = (token: string, selectionText: string) =>
    request(testApp)
      .post('/api/v1/glosses/record-lookup')
      .set(buildAuthorizationHeaders(token))
      .send({ selectionText, targetLanguage: 'ru' })

  // Pushes every clock a test controls back past the one-hour collapse
  // window, standing in for "a later day".
  const ageLookups = async (userId: string) => {
    await sql`
      UPDATE public.lemma_lookups SET last_looked_up_at = NOW() - INTERVAL '2 hours' WHERE user_id = ${userId}
    `
  }
  const ageTermDemand = async (userLookupId: string) => {
    await sql`
      UPDATE public.user_lookups SET last_demand_at = NOW() - INTERVAL '2 hours' WHERE id = ${userLookupId}
    `
  }
  const encounterCount = async (userLookupId: string): Promise<number> => {
    const [row] = (await sql`
      SELECT encounter_count FROM public.user_lookups WHERE id = ${userLookupId}
    `) as [{ encounter_count: number }]
    return row.encounter_count
  }

  test('returns 401 when unauthenticated', async () => {
    const response = await request(testApp)
      .post('/api/v1/glosses/record-lookup')
      .set({ Authorization: 'Bearer wrong-token' })
      .send({ selectionText: 'стол', targetLanguage: 'ru' })
    expect(response.status).toBe(401)
  })

  test('multi-word selections and unresolvable words record nothing', async () => {
    const { token } = await setupCheckpointUser(testApp)
    const suffix = uniqueCyrillicSuffix()
    await insertWiktionaryLemma(`слово${suffix}`, [`слова${suffix}`])

    const multi = await recordLookup(token, `слова${suffix} слова${suffix}`)
    expect(multi.status).toBe(200)
    expect(multi.body.data.lemmas).toEqual([])

    const unknown = await recordLookup(token, `нетслова${suffix}`)
    expect(unknown.body.data.lemmas).toEqual([])
  })

  test('earlier lookups are credited at save; the lookup that led to the save is not', async () => {
    const { userId, token } = await setupCheckpointUser(testApp)
    const suffix = uniqueCyrillicSuffix()
    const lemma = `метла${suffix}`
    await insertWiktionaryLemma(lemma, [`метлу${suffix}`])

    // Two earlier days, then the lookup right before saving.
    expect((await recordLookup(token, `метлу${suffix}`)).body.data.lemmas).toEqual([lemma])
    await ageLookups(userId)
    await recordLookup(token, `метлу${suffix}`)
    await ageLookups(userId)
    await recordLookup(token, `метлу${suffix}`)
    // A re-tap inside the hour is the same episode.
    await recordLookup(token, `Метлу${suffix}`)

    const termId = await saveAdhocTerm(testApp, token, basicDataPass, 'ru', lemma, 'broom')
    // 1 (the save) + 2 earlier episodes; the third episode led to the save.
    expect(await encounterCount(termId)).toBe(3)

    // A retry of the same crediting finds nothing uncredited.
    await LemmaLookupsRepository().creditLookupDemand([termId])
    expect(await encounterCount(termId)).toBe(3)
  })

  test('a later lookup of a saved term is demand, collapsed per hour, never double-counted', async () => {
    const { userId, token } = await setupCheckpointUser(testApp)
    const suffix = uniqueCyrillicSuffix()
    const lemma = `палочка${suffix}`
    await insertWiktionaryLemma(lemma, [`палочку${suffix}`])
    const termId = await saveAdhocTerm(testApp, token, basicDataPass, 'ru', lemma, 'wand')
    expect(await encounterCount(termId)).toBe(1)

    // Inside the save's hour: collapsed.
    await recordLookup(token, `палочку${suffix}`)
    expect(await encounterCount(termId)).toBe(1)

    // A checkpoint content encounter moves last_encountered_at but not the
    // demand clock, so a later lookup still counts.
    await ageTermDemand(termId)
    await ageLookups(userId)
    await sql`UPDATE public.user_lookups SET last_encountered_at = NOW() WHERE id = ${termId}`
    await recordLookup(token, `палочку${suffix}`)
    expect(await encounterCount(termId)).toBe(2)

    // That episode was credited directly, so crediting again adds nothing.
    await LemmaLookupsRepository().creditLookupDemand([termId])
    expect(await encounterCount(termId)).toBe(2)
  })
})
