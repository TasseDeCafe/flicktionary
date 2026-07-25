import { describe, expect, test, vi } from 'vitest'
import request from 'supertest'
import { buildAuthorizationHeaders, buildTestApp } from '../../test/test-utils'
import { MockAnthropicPasses } from '../../transport/third-party/anthropic/anthropic-passes'
import type {
  CheckpointSenseItem,
  CheckpointSensePick,
} from '../../transport/third-party/anthropic/passes/checkpoint-sense-pass'
import { UserTargetLanguagePrefsRepository } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import { StudySessionsRepository } from '../../transport/database/study-sessions/study-sessions-repository'
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

// Checkpoint reviews over real HTTP (docs/SRS.md §6b): preview → collect
// (implicit goods, provenance, budget, pointer) → undo. Shared fixtures in
// checkpoint-test-helpers.ts.
describe('study-sessions checkpoints', () => {
  const basicDataPass = vi.fn()
  const senseMock = vi.fn()
  const testApp = buildTestApp({
    anthropicPasses: MockAnthropicPasses({
      basicDataPass: basicDataPass as never,
      checkpointSensePass: senseMock as never,
    }),
  })

  test('returns 401 when unauthenticated', async () => {
    const response = await request(testApp)
      .get('/api/v1/study-sessions/00000000-0000-0000-0000-000000000001/checkpoint-preview?toSegmentIndex=5')
      .set({ Authorization: 'Bearer wrong-token' })
    expect(response.status).toBe(401)
  })

  test('collect returns UNSUPPORTED_LANGUAGE for a non-kaikki language and preview reports unsupported', async () => {
    const { userId, token } = await setupCheckpointUser(testApp)
    await UserTargetLanguagePrefsRepository().upsertCefr(userId, 'fr', 'B1')
    const frSession = await createReadingSession(userId, 'fr')

    const preview = await request(testApp)
      .get(`/api/v1/study-sessions/${frSession.id}/checkpoint-preview?toSegmentIndex=50`)
      .set(buildAuthorizationHeaders(token))
    expect(preview.status).toBe(200)
    expect(preview.body.data).toEqual({ pendingCount: 0, backlogCount: 0, supported: false })

    const collected = await request(testApp)
      .post(`/api/v1/study-sessions/${frSession.id}/checkpoints`)
      .set(buildAuthorizationHeaders(token))
      .send({ toSegmentIndex: 50, previewedSpans: [] })
    expect(collected.status).toBe(422)
    expect(collected.body.data.errors[0].code).toBe('UNSUPPORTED_LANGUAGE')
  })

  test('golden path: preview → collect credits due terms, splits lanes, stamps provenance, moves the pointer', async () => {
    const suf = uniqueCyrillicSuffix()
    const { userId, token } = await setupCheckpointUser(testApp)

    // Vocabulary: A due review (credited), B not due (skipped), C leech-parked
    // (excluded), D never-introduced (backlog), P multi-sense pair spanning
    // lanes (stove sense due review, bake sense never-introduced).
    const wordA = `стол${suf}`
    const wordB = `окно${suf}`
    const wordC = `дом${suf}`
    const wordD = `река${suf}`
    const wordP = `печь${suf}`
    const idA = await saveAdhocTerm(testApp, token, basicDataPass, 'ru', wordA, 'table')
    const idB = await saveAdhocTerm(testApp, token, basicDataPass, 'ru', wordB, 'window')
    const idC = await saveAdhocTerm(testApp, token, basicDataPass, 'ru', wordC, 'house')
    const idD = await saveAdhocTerm(testApp, token, basicDataPass, 'ru', wordD, 'river')
    const idPStove = await saveAdhocTerm(testApp, token, basicDataPass, 'ru', wordP, 'stove')
    const idPBake = await saveAdhocTerm(testApp, token, basicDataPass, 'ru', wordP, 'to bake')

    await patchRecognitionFacet(idA, { state: 'review', dueOffsetDays: -1 })
    await patchRecognitionFacet(idB, { state: 'review', dueOffsetDays: 5 })
    await patchRecognitionFacet(idC, { state: 'review', dueOffsetDays: -1, leechParked: true })
    await patchRecognitionFacet(idD, { state: null })
    await patchRecognitionFacet(idPStove, { state: 'review', dueOffsetDays: -1 })
    await patchRecognitionFacet(idPBake, { state: null })

    // Wiktionary: every word has an inflected form (lemma + 'а') used in the
    // crafted segment below.
    for (const word of [wordA, wordB, wordC, wordD, wordP]) {
      await insertWiktionaryLemma(word, [`${word}а`])
    }

    const session = await createReadingSession(userId, 'ru')
    await appendSegment(session.text_track_id, `Вот ${wordA}а и ${wordB}а и ${wordC}а.`)
    const lastIndex = await appendSegment(session.text_track_id, `Тут ${wordD}а и ${wordP}а.`)

    // Preview counts optimistically (both P senses creditable-shaped rows
    // collapse into: stove due → creditable, bake NULL → backlog) without the
    // sense pass.
    const preview = await request(testApp)
      .get(`/api/v1/study-sessions/${session.id}/checkpoint-preview?toSegmentIndex=${lastIndex}`)
      .set(buildAuthorizationHeaders(token))
    expect(preview.status).toBe(200)
    expect(preview.body.data.supported).toBe(true)
    expect(preview.body.data.pendingCount).toBe(2)
    expect(preview.body.data.backlogCount).toBe(2)
    expect(senseMock).not.toHaveBeenCalled()

    // Collect: the scripted sense pass picks the stove sense, so the bake
    // sense must NOT surface in the backlog lane (lane isolation).
    senseMock.mockImplementationOnce((params: { items: CheckpointSenseItem[] }): Promise<CheckpointSensePick[]> =>
      Promise.resolve(
        params.items.map((item) => ({
          headword: item.headword,
          pickedUserLookupId: item.senses.find((s) => s.userLookupId === idPStove)?.userLookupId ?? null,
        }))
      )
    )
    // toSegmentIndex is deliberately past the end — the server clamps it.
    const collected = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/checkpoints`)
      .set(buildAuthorizationHeaders(token))
      .send({ toSegmentIndex: lastIndex + 500, previewedSpans: [] })
    expect(collected.status).toBe(200)
    expect(collected.body.data.checkpointId).not.toBeNull()
    expect(collected.body.data.fromSegmentIndex).toBeNull()
    expect(collected.body.data.toSegmentIndex).toBe(lastIndex)
    expect(collected.body.data.creditedCount).toBe(2)
    expect(collected.body.data.suppressedCount).toBe(0)
    expect(collected.body.data.backlogCandidates).toEqual([{ userLookupId: idD, headword: wordD, sense: 'river' }])
    expect(senseMock).toHaveBeenCalledTimes(1)

    // Event rows: implicit, checkpoint-stamped, budget-counted.
    const events = (await sql`
      SELECT user_lookup_id, was_explicit, was_introduction, prev_srs_state, study_session_id, checkpoint_id, import_batch_id
      FROM public.practice_rating_events
      WHERE checkpoint_id = ${collected.body.data.checkpointId}
      ORDER BY rated_at ASC
    `) as Array<Record<string, unknown>>
    expect(events).toHaveLength(2)
    expect(new Set(events.map((e) => e.user_lookup_id))).toEqual(new Set([idA, idPStove]))
    for (const event of events) {
      expect(event.was_explicit).toBe(false)
      expect(event.was_introduction).toBe(false)
      expect(event.prev_srs_state).toBe('review')
      expect(event.study_session_id).toBe(session.id)
      expect(event.import_batch_id).toBeNull()
    }
    const budget = await PracticeRatingEventsRepository().countReviewBudgetConsumedToday({
      userId,
      targetLanguage: 'ru',
      pool: 'recognition',
    })
    expect(budget).toBe(2)

    // Pointer moved; content encounters bumped WITHOUT touching
    // encounter_count; the parked/not-due terms got encounters too.
    const refreshed = await StudySessionsRepository().findByIdForUser(session.id, userId)
    expect(refreshed!.reviewed_until_segment_index).toBe(lastIndex)
    const lookups = (await sql`
      SELECT id, encounter_count, content_encounter_count FROM public.user_lookups
      WHERE id = ANY(${[idA, idB, idC, idD]}::uuid[])
    `) as Array<{ id: string; encounter_count: number; content_encounter_count: number }>
    for (const lookup of lookups) {
      expect(lookup.encounter_count).toBe(1)
      expect(lookup.content_encounter_count).toBe(1)
    }

    // The credited facets moved out of due; same-span re-press credits 0 and
    // writes nothing.
    const again = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/checkpoints`)
      .set(buildAuthorizationHeaders(token))
      .send({ toSegmentIndex: lastIndex, previewedSpans: [] })
    expect(again.status).toBe(200)
    expect(again.body.data.checkpointId).toBeNull()
    expect(again.body.data.creditedCount).toBe(0)
  })

  test('previewed gloss spans suppress the credit (never a downgrade)', async () => {
    const suf = uniqueCyrillicSuffix()
    const { userId, token } = await setupCheckpointUser(testApp)
    const word = `трава${suf}`
    const id = await saveAdhocTerm(testApp, token, basicDataPass, 'ru', word, 'grass')
    await patchRecognitionFacet(id, { state: 'review', dueOffsetDays: -1 })
    await insertWiktionaryLemma(word, [`${word}у`])
    const session = await createReadingSession(userId, 'ru')
    const lastIndex = await appendSegment(session.text_track_id, `Вижу ${word}у здесь.`)

    const collected = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/checkpoints`)
      .set(buildAuthorizationHeaders(token))
      .send({
        toSegmentIndex: lastIndex,
        previewedSpans: [{ segmentIndex: lastIndex, selectionText: `${word}у` }],
      })
    expect(collected.status).toBe(200)
    expect(collected.body.data.creditedCount).toBe(0)
    expect(collected.body.data.suppressedCount).toBe(1)
    // Suppressed ≠ punished: the facet is untouched and still due.
    const facet = await getRecognitionFacet(id)
    expect(facet!.srs_state).toBe('review')
    expect(facet!.srs_reps).toBe(3)
  })

  test('two concurrent collects: exactly one credits', async () => {
    const suf = uniqueCyrillicSuffix()
    const { userId, token } = await setupCheckpointUser(testApp)
    const word = `гриб${suf}`
    const id = await saveAdhocTerm(testApp, token, basicDataPass, 'ru', word, 'mushroom')
    await patchRecognitionFacet(id, { state: 'review', dueOffsetDays: -1 })
    await insertWiktionaryLemma(word, [`${word}ы`])
    const session = await createReadingSession(userId, 'ru')
    const lastIndex = await appendSegment(session.text_track_id, `Здесь ${word}ы растут.`)

    const fire = () =>
      request(testApp)
        .post(`/api/v1/study-sessions/${session.id}/checkpoints`)
        .set(buildAuthorizationHeaders(token))
        .send({ toSegmentIndex: lastIndex, previewedSpans: [] })
    const [first, second] = await Promise.all([fire(), fire()])

    // The winner credits once; the loser either hits CONFLICT (its span was
    // computed against the stale pointer) or sees an already-empty span.
    const statuses = [first.status, second.status].sort()
    expect([...statuses]).toContainEqual(200)
    const credited = [first, second].filter((r) => r.status === 200 && r.body.data.creditedCount === 1)
    expect(credited).toHaveLength(1)
    const events = await sql`
      SELECT id FROM public.practice_rating_events
      WHERE user_lookup_id = ${id} AND was_explicit = FALSE AND reverted_at IS NULL
    `
    expect(events).toHaveLength(1)
  })

  test('a rating landing between match and commit skips that facet (in-tx revalidation)', async () => {
    const suf = uniqueCyrillicSuffix()
    const { userId, token } = await setupCheckpointUser(testApp)
    // Two senses force the sense pass; the scripted pass rates the due facet
    // through the flashcard API before answering, simulating a concurrent
    // rating during the LLM call.
    const word = `ключ${suf}`
    const idKey = await saveAdhocTerm(testApp, token, basicDataPass, 'ru', word, 'key')
    const idSpring = await saveAdhocTerm(testApp, token, basicDataPass, 'ru', word, 'spring')
    await patchRecognitionFacet(idKey, { state: 'review', dueOffsetDays: -1 })
    await patchRecognitionFacet(idSpring, { state: 'review', dueOffsetDays: 5 })
    await insertWiktionaryLemma(word, [`${word}и`])
    const session = await createReadingSession(userId, 'ru')
    const lastIndex = await appendSegment(session.text_track_id, `Потерял ${word}и вчера.`)

    senseMock.mockImplementationOnce(async (params: { items: CheckpointSenseItem[] }) => {
      const rated = await request(testApp)
        .post(`/api/v1/practice/review-terms/${idKey}/ratings`)
        .set(buildAuthorizationHeaders(token))
        .send({ rating: 'good', pool: 'recognition', skill: 'meaning_recognition', targetForm: '' })
      expect(rated.status).toBe(201)
      return params.items.map((item) => ({
        headword: item.headword,
        pickedUserLookupId: item.senses.find((s) => s.userLookupId === idKey)?.userLookupId ?? null,
      }))
    })

    const collected = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/checkpoints`)
      .set(buildAuthorizationHeaders(token))
      .send({ toSegmentIndex: lastIndex, previewedSpans: [] })
    expect(collected.status).toBe(200)
    // The concurrent explicit rating made the facet non-due; the in-tx
    // revalidation skipped it — no double credit.
    expect(collected.body.data.creditedCount).toBe(0)
    const implicitEvents = await sql`
      SELECT id FROM public.practice_rating_events
      WHERE user_lookup_id = ${idKey} AND was_explicit = FALSE AND reverted_at IS NULL
    `
    expect(implicitEvents).toHaveLength(0)
  })

  test('undo restores snapshots, refunds the budget, and restores the NULL pointer', async () => {
    const suf = uniqueCyrillicSuffix()
    const { userId, token } = await setupCheckpointUser(testApp)
    const word = `заяц${suf}`
    const id = await saveAdhocTerm(testApp, token, basicDataPass, 'ru', word, 'hare')
    await patchRecognitionFacet(id, { state: 'review', dueOffsetDays: -1 })
    await insertWiktionaryLemma(word, [`${word}ы`])
    const session = await createReadingSession(userId, 'ru')
    const lastIndex = await appendSegment(session.text_track_id, `Бежит ${word}ы полем.`)
    const before = await getRecognitionFacet(id)

    const collected = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/checkpoints`)
      .set(buildAuthorizationHeaders(token))
      .send({ toSegmentIndex: lastIndex, previewedSpans: [] })
    expect(collected.body.data.creditedCount).toBe(1)
    const checkpointId = collected.body.data.checkpointId as string

    const undone = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/checkpoints/${checkpointId}/undo`)
      .set(buildAuthorizationHeaders(token))
      .send({})
    expect(undone.status).toBe(200)
    expect(undone.body.data).toEqual({ undone: true, reverted: 1, skipped: 0 })

    const after = await getRecognitionFacet(id)
    expect(after).toEqual(before)
    const refreshed = await StudySessionsRepository().findByIdForUser(session.id, userId)
    expect(refreshed!.reviewed_until_segment_index).toBeNull()
    const budget = await PracticeRatingEventsRepository().countReviewBudgetConsumedToday({
      userId,
      targetLanguage: 'ru',
      pool: 'recognition',
    })
    expect(budget).toBe(0)

    // Double-undo: stale-safe no-op.
    const doubled = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/checkpoints/${checkpointId}/undo`)
      .set(buildAuthorizationHeaders(token))
      .send({})
    expect(doubled.status).toBe(200)
    expect(doubled.body.data.undone).toBe(false)
  })

  test('undo after a later explicit rating skips that facet; a stale (non-latest) checkpoint is a no-op', async () => {
    const suf = uniqueCyrillicSuffix()
    const { userId, token } = await setupCheckpointUser(testApp)
    const word = `волк${suf}`
    const id = await saveAdhocTerm(testApp, token, basicDataPass, 'ru', word, 'wolf')
    await patchRecognitionFacet(id, { state: 'review', dueOffsetDays: -1 })
    await insertWiktionaryLemma(word, [`${word}и`])
    const session = await createReadingSession(userId, 'ru')
    const firstIndex = await appendSegment(session.text_track_id, `Воет ${word}и в лесу.`)

    const first = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/checkpoints`)
      .set(buildAuthorizationHeaders(token))
      .send({ toSegmentIndex: firstIndex, previewedSpans: [] })
    expect(first.body.data.creditedCount).toBe(1)
    const firstCheckpointId = first.body.data.checkpointId as string

    // A later explicit rating supersedes the checkpoint credit on this facet.
    const rated = await request(testApp)
      .post(`/api/v1/practice/review-terms/${id}/ratings`)
      .set(buildAuthorizationHeaders(token))
      .send({ rating: 'good', pool: 'recognition', skill: 'meaning_recognition', targetForm: '' })
    expect(rated.status).toBe(201)

    // A second checkpoint over new content makes the first one stale.
    const secondIndex = await appendSegment(session.text_track_id, `Просто текст без слов.`)
    const second = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/checkpoints`)
      .set(buildAuthorizationHeaders(token))
      .send({ toSegmentIndex: secondIndex, previewedSpans: [] })
    expect(second.status).toBe(200)
    const secondCheckpointId = second.body.data.checkpointId as string
    expect(secondCheckpointId).not.toBeNull()

    // Undoing the stale first checkpoint: no-op.
    const staleUndo = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/checkpoints/${firstCheckpointId}/undo`)
      .set(buildAuthorizationHeaders(token))
      .send({})
    expect(staleUndo.body.data.undone).toBe(false)

    // Undoing the latest checkpoint (no credited events of its own) succeeds;
    // then undoing the first works, but the re-rated facet is skipped.
    const undoSecond = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/checkpoints/${secondCheckpointId}/undo`)
      .set(buildAuthorizationHeaders(token))
      .send({})
    expect(undoSecond.body.data).toEqual({ undone: true, reverted: 0, skipped: 0 })

    const undoFirst = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/checkpoints/${firstCheckpointId}/undo`)
      .set(buildAuthorizationHeaders(token))
      .send({})
    expect(undoFirst.status).toBe(200)
    expect(undoFirst.body.data).toEqual({ undone: true, reverted: 0, skipped: 1 })
    // The explicit rating's effect survives.
    const facet = await getRecognitionFacet(id)
    expect(facet!.srs_state).not.toBeNull()
  })
})
