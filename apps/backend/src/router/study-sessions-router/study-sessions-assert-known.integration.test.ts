import { randomUUID } from 'node:crypto'
import { describe, expect, test, vi } from 'vitest'
import request from 'supertest'
import { buildAuthorizationHeaders, buildTestApp } from '../../test/test-utils'
import { MockAnthropicPasses } from '../../transport/third-party/anthropic/anthropic-passes'
import { PracticeRatingEventsRepository } from '../../transport/database/practice-rating-events/practice-rating-events-repository'
import { sql } from '../../transport/database/postgres-client'
import {
  appendSegment,
  createReadingSession,
  getRecognitionFacet,
  insertWiktionaryLemma,
  patchRecognitionFacet,
  saveAdhocTerm,
  setupCheckpointUser,
  uniqueCyrillicSuffix,
} from './checkpoint-test-helpers'

// The backlog known-assertion action (docs/SRS.md §6c) over real HTTP:
// collect → assert-known (both write paths) → undo-assertions, plus the
// budget-neutrality and lane-isolation invariants.
describe('study-sessions assert-known', () => {
  const basicDataPass = vi.fn()
  const testApp = buildTestApp({
    anthropicPasses: MockAnthropicPasses({ basicDataPass: basicDataPass as never }),
  })

  // Seed a session whose single segment contains the given words' inflected
  // forms, collect a checkpoint over it, and return the checkpoint id.
  const collectWithWords = async (userId: string, token: string, words: string[]) => {
    const session = await createReadingSession(userId, 'ru')
    const lastIndex = await appendSegment(session.text_track_id, `Вот ${words.map((w) => `${w}а`).join(' и ')}.`)
    const collected = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/checkpoints`)
      .set(buildAuthorizationHeaders(token))
      .send({ toSegmentIndex: lastIndex, previewedSpans: [] })
    expect(collected.status).toBe(200)
    return { session, collected: collected.body.data }
  }

  const reviewBudget = (userId: string) =>
    PracticeRatingEventsRepository().countReviewBudgetConsumedToday({
      userId,
      targetLanguage: 'ru',
      pool: 'recognition',
    })

  test('returns 401 when unauthenticated', async () => {
    const response = await request(testApp)
      .post(
        '/api/v1/study-sessions/00000000-0000-0000-0000-000000000001/checkpoints/00000000-0000-0000-0000-000000000002/assert-known'
      )
      .set({ Authorization: 'Bearer wrong-token' })
      .send({ userLookupIds: [] })
    expect(response.status).toBe(401)
  })

  test('NULL path: seeds review state ~21 days out without stamping introduced_at or touching budgets', async () => {
    const suf = uniqueCyrillicSuffix()
    const { userId, token } = await setupCheckpointUser(testApp)
    const word = `сапог${suf}`
    const id = await saveAdhocTerm(testApp, token, basicDataPass, 'ru', word, 'boot')
    await insertWiktionaryLemma(word, [`${word}а`])
    const { session, collected } = await collectWithWords(userId, token, [word])
    expect(collected.backlogCandidates).toEqual([{ userLookupId: id, headword: word, sense: 'boot' }])
    const checkpointId = collected.checkpointId as string

    // Not in the checkpoint's candidate set — must count as skipped.
    const unknownId = randomUUID()
    const asserted = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/checkpoints/${checkpointId}/assert-known`)
      .set(buildAuthorizationHeaders(token))
      .send({ userLookupIds: [id, unknownId] })
    expect(asserted.status).toBe(200)
    expect(asserted.body.data).toEqual({ asserted: 1, skipped: 1 })

    const facet = await getRecognitionFacet(id)
    expect(facet!.srs_state).toBe('review')
    expect(facet!.srs_stability).toBe(10)
    expect(facet!.introduced_at).toBeNull()
    const dueInDays = (new Date(facet!.srs_due!).getTime() - Date.now()) / (24 * 60 * 60 * 1000)
    expect(dueInDays).toBeGreaterThan(20)
    expect(dueInDays).toBeLessThan(22)

    // Budget neutrality: no review-budget slot consumed, and a normal
    // same-day introduction still works (the daily-new count saw nothing).
    expect(await reviewBudget(userId)).toBe(0)
    const otherWord = `ботинок${suf}`
    const otherId = await saveAdhocTerm(testApp, token, basicDataPass, 'ru', otherWord, 'shoe')
    const rated = await request(testApp)
      .post(`/api/v1/practice/review-terms/${otherId}/ratings`)
      .set(buildAuthorizationHeaders(token))
      .send({ rating: 'good', pool: 'recognition', skill: 'meaning_recognition', targetForm: '' })
    expect(rated.status).toBe(201)
    expect(rated.body.data.introducedNew).toBe(true)
    const introducedToday = (await sql`
      SELECT COUNT(*)::int AS count
      FROM public.study_facets f
      JOIN public.user_lookups ul ON ul.id = f.user_lookup_id
      WHERE ul.user_id = ${userId} AND f.introduced_at >= CURRENT_DATE
    `) as [{ count: number }]
    expect(introducedToday[0].count).toBe(1)

    // Undo restores the never-introduced state.
    const undone = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/checkpoints/${checkpointId}/undo-assertions`)
      .set(buildAuthorizationHeaders(token))
      .send({})
    expect(undone.status).toBe(200)
    expect(undone.body.data).toEqual({ reverted: 1, skipped: 0 })
    const restored = await getRecognitionFacet(id)
    expect(restored!.srs_state).toBeNull()
    expect(restored!.srs_stability).toBeNull()
    expect(restored!.introduced_at).toBeNull()
  })

  test('onboarding-parked path: unparks with partial rehab progress and undo re-parks the EXACT prior state', async () => {
    const suf = uniqueCyrillicSuffix()
    const { userId, token } = await setupCheckpointUser(testApp)
    const word = `шарф${suf}`
    const id = await saveAdhocTerm(testApp, token, basicDataPass, 'ru', word, 'scarf')
    // Onboarding-parked: srs_state NULL, parked, introduced_at stamped at
    // park time, PARTIAL rehab progress (warm-up gates advance rehab days).
    await sql`
      UPDATE public.study_facets
      SET srs_state = NULL, srs_due = NULL, srs_stability = NULL, srs_difficulty = NULL,
          srs_last_review = NULL, srs_reps = 0,
          leech_parked_at = NOW() - INTERVAL '3 days',
          leech_rehab_correct_days = 2,
          leech_rehab_last_correct_on = CURRENT_DATE - 1,
          introduced_at = NOW() - INTERVAL '3 days'
      WHERE user_lookup_id = ${id} AND skill = 'meaning_recognition' AND target_form = ''
    `
    const parkedBefore = await getRecognitionFacet(id)
    await insertWiktionaryLemma(word, [`${word}а`])
    const { session, collected } = await collectWithWords(userId, token, [word])
    expect(collected.backlogCandidates.map((c: { userLookupId: string }) => c.userLookupId)).toEqual([id])
    const checkpointId = collected.checkpointId as string

    const asserted = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/checkpoints/${checkpointId}/assert-known`)
      .set(buildAuthorizationHeaders(token))
      .send({ userLookupIds: [id] })
    expect(asserted.body.data).toEqual({ asserted: 1, skipped: 0 })

    const afterAssert = await getRecognitionFacet(id)
    expect(afterAssert!.srs_state).toBe('review')
    expect(afterAssert!.leech_parked_at).toBeNull()
    expect(afterAssert!.leech_rehab_correct_days).toBe(0)
    expect(afterAssert!.leech_rehab_last_correct_on).toBeNull()
    // Not a second introduction: the park-time stamp survives.
    expect(afterAssert!.introduced_at).toEqual(parkedBefore!.introduced_at)

    const events = (await sql`
      SELECT was_introduction, caused_unparking, prev_leech_rehab_correct_days
      FROM public.practice_rating_events
      WHERE checkpoint_id = ${checkpointId} AND was_explicit = TRUE
    `) as Array<{ was_introduction: boolean; caused_unparking: boolean; prev_leech_rehab_correct_days: number }>
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      was_introduction: false,
      caused_unparking: true,
      prev_leech_rehab_correct_days: 2,
    })
    // Parked-path assertions never charge the review budget either.
    expect(await reviewBudget(userId)).toBe(0)

    const undone = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/checkpoints/${checkpointId}/undo-assertions`)
      .set(buildAuthorizationHeaders(token))
      .send({})
    expect(undone.body.data).toEqual({ reverted: 1, skipped: 0 })
    const restored = await getRecognitionFacet(id)
    expect(restored).toEqual(parkedBefore)
  })

  test('stale candidates are skipped: already-scheduled and leech-parked-with-history', async () => {
    const suf = uniqueCyrillicSuffix()
    const { userId, token } = await setupCheckpointUser(testApp)
    const wordA = `плащ${suf}`
    const wordB = `пояс${suf}`
    const idA = await saveAdhocTerm(testApp, token, basicDataPass, 'ru', wordA, 'coat')
    const idB = await saveAdhocTerm(testApp, token, basicDataPass, 'ru', wordB, 'belt')
    await insertWiktionaryLemma(wordA, [`${wordA}а`])
    await insertWiktionaryLemma(wordB, [`${wordB}а`])
    const { session, collected } = await collectWithWords(userId, token, [wordA, wordB])
    expect(collected.backlogCandidates).toHaveLength(2)
    const checkpointId = collected.checkpointId as string

    // State moved on AFTER the checkpoint: A got introduced, B leech-parked
    // with history — both must be skipped by the seed guards.
    await patchRecognitionFacet(idA, { state: 'review', dueOffsetDays: 3 })
    await patchRecognitionFacet(idB, { state: 'review', dueOffsetDays: 3, leechParked: true })

    const asserted = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/checkpoints/${checkpointId}/assert-known`)
      .set(buildAuthorizationHeaders(token))
      .send({ userLookupIds: [idA, idB] })
    expect(asserted.body.data).toEqual({ asserted: 0, skipped: 2 })
  })

  test('claims rehydration: 401 unauthenticated and 404 unknown session', async () => {
    const unauth = await request(testApp)
      .get('/api/v1/study-sessions/00000000-0000-0000-0000-000000000001/checkpoint-claims')
      .set({ Authorization: 'Bearer wrong-token' })
    expect(unauth.status).toBe(401)

    const { token } = await setupCheckpointUser(testApp)
    const missing = await request(testApp)
      .get(`/api/v1/study-sessions/${randomUUID()}/checkpoint-claims`)
      .set(buildAuthorizationHeaders(token))
    expect(missing.status).toBe(404)
  })

  test('claims rehydration: re-fetch mirrors the collect response, minus moved-on and asserted candidates', async () => {
    const suf = uniqueCyrillicSuffix()
    const { userId, token } = await setupCheckpointUser(testApp)
    const wordA = `сундук${suf}`
    const wordB = `фонар${suf}`
    const idA = await saveAdhocTerm(testApp, token, basicDataPass, 'ru', wordA, 'chest')
    const idB = await saveAdhocTerm(testApp, token, basicDataPass, 'ru', wordB, 'lantern')
    await insertWiktionaryLemma(wordA, [`${wordA}а`])
    await insertWiktionaryLemma(wordB, [`${wordB}а`])

    const session = await createReadingSession(userId, 'ru')
    // No checkpoint yet — nothing to rehydrate.
    const before = await request(testApp)
      .get(`/api/v1/study-sessions/${session.id}/checkpoint-claims`)
      .set(buildAuthorizationHeaders(token))
    expect(before.status).toBe(200)
    expect(before.body.data).toEqual({ checkpointId: null, candidates: [] })

    const lastIndex = await appendSegment(session.text_track_id, `Вот ${wordA}а и ${wordB}а.`)
    const collected = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/checkpoints`)
      .set(buildAuthorizationHeaders(token))
      .send({ toSegmentIndex: lastIndex, previewedSpans: [] })
    expect(collected.status).toBe(200)
    const checkpointId = collected.body.data.checkpointId as string
    expect(collected.body.data.backlogCandidates).toHaveLength(2)

    // What a reloaded client sees: the same batch the collect returned.
    const claims = await request(testApp)
      .get(`/api/v1/study-sessions/${session.id}/checkpoint-claims`)
      .set(buildAuthorizationHeaders(token))
    expect(claims.status).toBe(200)
    expect(claims.body.data.checkpointId).toBe(checkpointId)
    expect(claims.body.data.candidates).toEqual(collected.body.data.backlogCandidates)

    // A facet whose state moved on since the checkpoint drops out of the offer.
    await patchRecognitionFacet(idA, { state: 'review', dueOffsetDays: 3 })
    const afterMove = await request(testApp)
      .get(`/api/v1/study-sessions/${session.id}/checkpoint-claims`)
      .set(buildAuthorizationHeaders(token))
    expect(afterMove.body.data.candidates).toEqual([{ userLookupId: idB, headword: wordB, sense: 'lantern' }])

    // Asserting the rest empties the offer while the checkpoint stays live.
    const asserted = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/checkpoints/${checkpointId}/assert-known`)
      .set(buildAuthorizationHeaders(token))
      .send({ userLookupIds: [idB] })
    expect(asserted.body.data.asserted).toBe(1)
    const afterAssert = await request(testApp)
      .get(`/api/v1/study-sessions/${session.id}/checkpoint-claims`)
      .set(buildAuthorizationHeaders(token))
    expect(afterAssert.body.data).toEqual({ checkpointId, candidates: [] })
  })

  test('lane isolation: checkpoint undo leaves assertions live, and vice versa', async () => {
    const suf = uniqueCyrillicSuffix()
    const { userId, token } = await setupCheckpointUser(testApp)
    const dueWord = `котел${suf}`
    const backlogWord = `ковер${suf}`
    const dueId = await saveAdhocTerm(testApp, token, basicDataPass, 'ru', dueWord, 'kettle')
    const backlogId = await saveAdhocTerm(testApp, token, basicDataPass, 'ru', backlogWord, 'carpet')
    await patchRecognitionFacet(dueId, { state: 'review', dueOffsetDays: -1 })
    await insertWiktionaryLemma(dueWord, [`${dueWord}а`])
    await insertWiktionaryLemma(backlogWord, [`${backlogWord}а`])
    const { session, collected } = await collectWithWords(userId, token, [dueWord, backlogWord])
    expect(collected.creditedCount).toBe(1)
    expect(collected.backlogCandidates.map((c: { userLookupId: string }) => c.userLookupId)).toEqual([backlogId])
    const checkpointId = collected.checkpointId as string

    const asserted = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/checkpoints/${checkpointId}/assert-known`)
      .set(buildAuthorizationHeaders(token))
      .send({ userLookupIds: [backlogId] })
    expect(asserted.body.data.asserted).toBe(1)

    // Checkpoint (implicit-lane) undo: the credit reverts, the assertion
    // survives untouched.
    const checkpointUndo = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/checkpoints/${checkpointId}/undo`)
      .set(buildAuthorizationHeaders(token))
      .send({})
    expect(checkpointUndo.body.data).toMatchObject({ undone: true, reverted: 1 })
    const assertedFacet = await getRecognitionFacet(backlogId)
    expect(assertedFacet!.srs_state).toBe('review')
    expect(assertedFacet!.srs_stability).toBe(10)

    // Assertion undo still works after the checkpoint was reverted.
    const assertionUndo = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/checkpoints/${checkpointId}/undo-assertions`)
      .set(buildAuthorizationHeaders(token))
      .send({})
    expect(assertionUndo.body.data).toEqual({ reverted: 1, skipped: 0 })
    const restored = await getRecognitionFacet(backlogId)
    expect(restored!.srs_state).toBeNull()
  })
})
