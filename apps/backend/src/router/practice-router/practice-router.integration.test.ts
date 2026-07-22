import { describe, expect, test, vi } from 'vitest'
import request from 'supertest'
import {
  __createOrGetUserWithOurApi,
  __createUserInSupabaseAndGetHisIdAndToken,
  buildAuthorizationHeaders,
  buildTestApp,
} from '../../test/test-utils'
import { MockAnthropicPasses } from '../../transport/third-party/anthropic/anthropic-passes'
import { UsersRepository } from '../../transport/database/users/users-repository'
import { UserTargetLanguagePrefsRepository } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'

// Minimal scripted basicDataPass row for the adhoc save that seeds the term
// under practice (see cards-router.integration.test.ts for the convention).
const scriptedChunk = {
  source: 'highlight' as const,
  headword: 'gato',
  sense: 'animal',
  surfaceForm: 'gato',
  segmentId: 'rebound-to-the-real-segment',
  translation: 'cat',
  surfaceTranslation: null,
  definition: 'felino doméstico',
  targetExample: 'El gato duerme.',
  nativeExample: 'The cat sleeps.',
  grammar: { pos: 'noun' },
  belowCefr: false,
  zipf: 4.2,
}

// Drives the rate → summary → undo flashcard flow over real HTTP through
// buildApp: the FSRS write + rating-event insert commit in one transaction and
// surface in the due summary. Golden path + one auth failure + one domain
// failure; scenario coverage stays in the unit tests.
describe('practice-router', () => {
  const basicDataPass = vi.fn().mockResolvedValue([scriptedChunk])
  const testApp = buildTestApp({
    anthropicPasses: MockAnthropicPasses({
      basicDataPass: basicDataPass as never,
    }),
  })

  // An onboarded user with one kept Spanish term (adhoc save creates the
  // user_lookup + citation recognition facet).
  const userWithKeptTerm = async () => {
    const { id, token } = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token, referral: null })
    await UsersRepository().setNativeLanguage(id, 'en')
    await UserTargetLanguagePrefsRepository().upsertCefr(id, 'es', 'B1')

    const created = await request(testApp).post('/api/v1/cards/adhoc').set(buildAuthorizationHeaders(token)).send({
      targetLanguage: 'es',
      headword: 'gato',
      context: null,
    })
    expect(created.status).toBe(200)

    const card = await request(testApp)
      .get(`/api/v1/cards/${created.body.data.cardId}`)
      .set(buildAuthorizationHeaders(token))
    expect(card.status).toBe(200)
    return { token, userLookupId: card.body.data.userLookupId as string }
  }

  test('returns 401 when unauthenticated', async () => {
    const response = await request(testApp)
      .get('/api/v1/practice/due-summary')
      .set({ Authorization: 'Bearer wrong-token' })

    expect(response.status).toBe(401)
  })

  test('golden path: rates a new term (introduction), sees it in the due summary, and undoes the rating', async () => {
    const { token, userLookupId } = await userWithKeptTerm()

    // A fresh keep is unseen: the due summary counts it as new, nothing due.
    const before = await request(testApp).get('/api/v1/practice/due-summary').set(buildAuthorizationHeaders(token))
    expect(before.status).toBe(200)
    const beforeEs = before.body.data.perLanguage.find(
      (entry: { targetLanguage: string }) => entry.targetLanguage === 'es'
    )
    expect(beforeEs).toMatchObject({ totalKept: 1, newCount: 1, reviewDueCount: 0, lastPracticedAt: null })

    // First 'good' rating introduces the term (daily-cap guard) and applies
    // FSRS + the rating-event log atomically; the eventId is the undo handle.
    const rated = await request(testApp)
      .post(`/api/v1/practice/review-terms/${userLookupId}/ratings`)
      .set(buildAuthorizationHeaders(token))
      .send({ rating: 'good', pool: 'recognition', skill: 'meaning_recognition', targetForm: '' })
    expect(rated.status).toBe(201)
    expect(rated.body.data).toMatchObject({
      accepted: true,
      introducedNew: true,
      dailyCapReached: false,
      parked: false,
    })
    const eventId = rated.body.data.eventId
    expect(eventId).not.toBeNull()

    // The introduction consumed today's new budget and left the term scheduled.
    const after = await request(testApp).get('/api/v1/practice/due-summary').set(buildAuthorizationHeaders(token))
    const afterEs = after.body.data.perLanguage.find(
      (entry: { targetLanguage: string }) => entry.targetLanguage === 'es'
    )
    expect(afterEs.newCount).toBe(0)
    expect(afterEs.newIntroducedTodayCount).toBe(1)
    expect(afterEs.lastPracticedAt).not.toBeNull()

    // Undo restores the pre-rating snapshot: the term is unseen again.
    const undone = await request(testApp)
      .post(`/api/v1/practice/review-terms/${userLookupId}/undo`)
      .set(buildAuthorizationHeaders(token))
      .send({ pool: 'recognition', skill: 'meaning_recognition', targetForm: '', eventId })
    expect(undone.status).toBe(200)
    expect(undone.body.data.undone).toBe(true)

    const restored = await request(testApp).get('/api/v1/practice/due-summary').set(buildAuthorizationHeaders(token))
    const restoredEs = restored.body.data.perLanguage.find(
      (entry: { targetLanguage: string }) => entry.targetLanguage === 'es'
    )
    // The undo reverted the only rating event, so recency is gone too.
    expect(restoredEs).toMatchObject({ newCount: 1, newIntroducedTodayCount: 0, lastPracticedAt: null })
  })

  test('returns 400 for an illegal (pool, skill) pairing', async () => {
    const { token, userLookupId } = await userWithKeptTerm()

    const response = await request(testApp)
      .post(`/api/v1/practice/review-terms/${userLookupId}/ratings`)
      .set(buildAuthorizationHeaders(token))
      .send({ rating: 'good', pool: 'production', skill: 'pronunciation', targetForm: '' })

    expect(response.status).toBe(400)
  })
})
