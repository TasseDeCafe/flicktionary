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
import { sql } from '../../transport/database/postgres-client'

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

  test('everyday Practice introduces an enabled, never-reviewed pronunciation facet and previews it as new', async () => {
    const { token, userLookupId } = await userWithKeptTerm()
    const preview = async () => {
      const response = await request(testApp)
        .get('/api/v1/practice/queue/preview')
        .query({ targetLanguage: 'es' })
        .set(buildAuthorizationHeaders(token))
      expect(response.status).toBe(200)
      return response.body.data.counts.new as number
    }
    const newBefore = await preview()

    // An opted-in, ready pronunciation facet that has never been rated.
    const [{ user_id: userId }] = await sql`SELECT user_id FROM public.user_lookups WHERE id = ${userLookupId}`
    await sql`
      INSERT INTO public.study_facets (user_lookup_id, user_id, target_language, skill, target_form, data_status)
      VALUES (${userLookupId}, ${userId}, 'es', 'pronunciation', '', 'ready')
    `
    expect(await preview()).toBe(newBefore + 1)

    // The default filter (no Learn-new preset) serves it as a flashcard.
    const composed = await request(testApp)
      .post('/api/v1/practice/queue/compose')
      .set(buildAuthorizationHeaders(token))
      .send({ targetLanguage: 'es', filter: { render: 'flashcards_only' } })
    expect(composed.status).toBe(200)
    const flashcards = composed.body.data.items.filter((item: { type: string }) => item.type === 'flashcard')
    expect(flashcards.map((item: { card: { skill: string } }) => item.card.skill)).toEqual(['pronunciation'])
  })

  describe('review boost', () => {
    const boost = (token: string, userLookupId: string, action: 'boost' | 'unboost') =>
      request(testApp)
        .post(`/api/v1/practice/review-terms/${userLookupId}/${action}`)
        .set(buildAuthorizationHeaders(token))
        .send({ skill: 'meaning_recognition' })

    test('returns 401 when unauthenticated', async () => {
      const response = await boost('wrong-token', '00000000-0000-0000-0000-000000000000', 'boost')
      expect(response.status).toBe(401)
    })

    test('golden path: boosts a far-due card to tomorrow, flags it on the flashcard, and undoes it', async () => {
      const { token, userLookupId } = await userWithKeptTerm()
      // Never reviewed: nothing to pull forward.
      expect((await boost(token, userLookupId, 'boost')).body.data).toEqual({ boosted: false })

      await sql`
        UPDATE public.study_facets
        SET srs_state = 'review', srs_due = NOW() + INTERVAL '23 days', srs_stability = 20, srs_difficulty = 5,
            srs_reps = 3, srs_last_review = NOW() - INTERVAL '5 days', introduced_at = NOW() - INTERVAL '30 days'
        WHERE user_lookup_id = ${userLookupId} AND skill = 'meaning_recognition'
      `
      const boosted = await boost(token, userLookupId, 'boost')
      expect(boosted.status).toBe(200)
      expect(boosted.body.data).toEqual({ boosted: true })

      // Make the boosted card due now (the boost's day, one day early).
      await sql`
        UPDATE public.study_facets
        SET srs_due = srs_due - INTERVAL '1 day', boosted_at = boosted_at - INTERVAL '1 day'
        WHERE user_lookup_id = ${userLookupId} AND skill = 'meaning_recognition'
      `
      const composed = await request(testApp)
        .post('/api/v1/practice/queue/compose')
        .set(buildAuthorizationHeaders(token))
        .send({ targetLanguage: 'es', filter: { scope: 'due_only' } })
      expect(composed.status).toBe(200)
      const cards = composed.body.data.items.filter((item: { type: string }) => item.type === 'flashcard')
      expect(cards.map((item: { card: { boostActive: boolean } }) => item.card.boostActive)).toEqual([true])

      await sql`
        UPDATE public.study_facets
        SET srs_due = srs_due + INTERVAL '1 day', boosted_at = boosted_at + INTERVAL '1 day'
        WHERE user_lookup_id = ${userLookupId} AND skill = 'meaning_recognition'
      `
      expect((await boost(token, userLookupId, 'unboost')).body.data).toEqual({ restored: true })
      expect((await boost(token, userLookupId, 'unboost')).body.data).toEqual({ restored: false })
    })
  })
})
