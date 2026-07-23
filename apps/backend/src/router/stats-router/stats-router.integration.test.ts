import { describe, expect, test } from 'vitest'
import request from 'supertest'
import {
  buildAuthorizationHeaders,
  buildTestApp,
  __createUserInSupabaseAndGetHisIdAndToken,
  __generateUniqueId,
} from '../../test/test-utils'
import { MockAnthropicPasses } from '../../transport/third-party/anthropic/anthropic-passes'
import { KnownLemmasRepository } from '../../transport/database/known-lemmas/known-lemmas-repository'
import { sql } from '../../transport/database/postgres-client'
import { ACTIVITY_WINDOW_DAYS } from '../../service/stats/get-activity'

// The activity read over real HTTP. The contract has no domain errors (an
// empty history is a valid zero response), so 401 + golden path cover it.
describe('stats router', () => {
  const testApp = buildTestApp({ anthropicPasses: MockAnthropicPasses({}) })

  test('returns 401 when unauthenticated', async () => {
    const response = await request(testApp).get('/api/v1/stats/activity').set({ Authorization: 'Bearer wrong-token' })
    expect(response.status).toBe(401)
  })

  test('golden path: marked-known activity lands on today and starts a streak', async () => {
    const { id: userId, token } = await __createUserInSupabaseAndGetHisIdAndToken()
    await sql`SELECT 1` // warm the client before sql.array (first-query OID quirk)
    // A per-test unique fake language keeps assertions exact on the shared DB.
    const language = __generateUniqueId('zz')
    await KnownLemmasRepository().bulkMarkKnown({
      userId,
      targetLanguage: language,
      lemmas: [__generateUniqueId('one'), __generateUniqueId('two')],
      source: 'bulk_text',
      sourceId: null,
      sweepBatchId: null,
    })

    const response = await request(testApp).get('/api/v1/stats/activity').set(buildAuthorizationHeaders(token))
    expect(response.status).toBe(200)

    const { days, perLanguage, streakDays, activeDays, joinedDay } = response.body.data
    expect(days).toHaveLength(ACTIVITY_WINDOW_DAYS)
    const entry = perLanguage.find((l: { targetLanguage: string }) => l.targetLanguage === language)
    expect(entry).toBeDefined()
    expect(entry.markedKnown.at(-1)).toBe(2)
    expect(entry.newTerms.every((n: number) => n === 0)).toBe(true)
    expect(entry.practiced.every((n: number) => n === 0)).toBe(true)
    expect(streakDays).toBeGreaterThanOrEqual(1)
    // The known-mark just made today an active day.
    expect(activeDays).toContain(days.at(-1))
    expect(joinedDay).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  // The public.users row is created lazily by putUser — the auth-only account
  // (exactly what __createUser... seeds) must still get a full response.
  test('an auth-only account with no history gets a valid empty response', async () => {
    const { token } = await __createUserInSupabaseAndGetHisIdAndToken()

    const response = await request(testApp).get('/api/v1/stats/activity').set(buildAuthorizationHeaders(token))
    expect(response.status).toBe(200)

    const { perLanguage, streakDays, activeDays, joinedDay } = response.body.data
    expect(perLanguage).toEqual([])
    expect(streakDays).toBe(0)
    expect(activeDays).toEqual([])
    expect(joinedDay).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
