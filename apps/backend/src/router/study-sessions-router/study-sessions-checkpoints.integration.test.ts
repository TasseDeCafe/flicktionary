import { describe, expect, test, vi } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import {
  __createOrGetUserWithOurApi,
  __createUserInSupabaseAndGetHisIdAndToken,
  __generateUniqueId,
  buildAuthorizationHeaders,
  buildTestApp,
} from '../../test/test-utils'
import { MockAnthropicPasses } from '../../transport/third-party/anthropic/anthropic-passes'
import type {
  CheckpointSenseItem,
  CheckpointSensePick,
} from '../../transport/third-party/anthropic/passes/checkpoint-sense-pass'
import { UsersRepository } from '../../transport/database/users/users-repository'
import { UserTargetLanguagePrefsRepository } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import { StudySessionsRepository } from '../../transport/database/study-sessions/study-sessions-repository'
import { TextSegmentsRepository } from '../../transport/database/text-segments/text-segments-repository'
import { PracticeRatingEventsRepository } from '../../transport/database/practice-rating-events/practice-rating-events-repository'
import { sql } from '../../transport/database/postgres-client'

// Checkpoint reviews over real HTTP (docs/SRS.md "Checkpoint reviews"):
// preview → collect (implicit goods, provenance, budget, pointer) → undo.
//
// Test words are nonsense Russian words with per-test unique CYRILLIC suffixes
// (mixed-script suffixes would make Intl.Segmenter split them): the shared
// test DB is never reset, and matching keys on exact folded strings, so
// suffixed words are fully isolated.
const CYRILLIC = 'абвгдежзиклмнопрстуфхцчшщыэюя'
const uniqueCyrillicSuffix = (): string =>
  [...__generateUniqueId('').replace(/[^a-z0-9]/g, '')].map((c) => CYRILLIC[parseInt(c, 36) % CYRILLIC.length]).join('')

const REAL_LEMMA_DATA = { head_templates: [{ name: 'head' }], senses: [{ glosses: ['test gloss'] }] }

const insertWiktionaryLemma = async (headword: string, forms: string[]): Promise<void> => {
  const [row] = (await sql`
    INSERT INTO public.wiktionary_entries (target_language, headword, pos, data)
    VALUES ('ru', ${headword}, 'noun', ${sql.json(REAL_LEMMA_DATA)})
    RETURNING id
  `) as [{ id: number }]
  for (const form of forms) {
    await sql`
      INSERT INTO public.wiktionary_forms (target_language, form, entry_id)
      VALUES ('ru', ${form}, ${row.id})
      ON CONFLICT DO NOTHING
    `
  }
}

const adhocChunk = (headword: string, sense: string) => ({
  source: 'highlight' as const,
  headword,
  sense,
  surfaceForm: headword,
  segmentId: 'rebound-to-the-real-segment',
  translation: 'translation',
  surfaceTranslation: null,
  definition: 'определение',
  targetExample: null,
  nativeExample: null,
  grammar: { pos: 'noun' },
  belowCefr: false,
  zipf: 3.0,
})

type FacetPatch = {
  state?: 'new' | 'learning' | 'review' | 'relearning' | null
  dueOffsetDays?: number
  leechParked?: boolean
}

const patchRecognitionFacet = async (userLookupId: string, patch: FacetPatch): Promise<void> => {
  const state = patch.state ?? null
  const due = patch.dueOffsetDays
  await sql`
    UPDATE public.study_facets
    SET srs_state = ${state},
        srs_due = ${due === undefined ? null : sql`NOW() + ${`${due} days`}::interval`},
        srs_stability = ${state === null ? null : 5},
        srs_difficulty = ${state === null ? null : 5},
        srs_last_review = ${state === null ? null : sql`NOW() - INTERVAL '5 days'`},
        srs_reps = ${state === null ? 0 : 3},
        leech_parked_at = ${patch.leechParked ? sql`NOW()` : null}
    WHERE user_lookup_id = ${userLookupId}
      AND skill = 'meaning_recognition'
      AND target_form = ''
  `
}

const getRecognitionFacet = async (userLookupId: string) => {
  const rows = (await sql`
    SELECT srs_state, srs_due, srs_reps FROM public.study_facets
    WHERE user_lookup_id = ${userLookupId} AND skill = 'meaning_recognition' AND target_form = ''
  `) as Array<{ srs_state: string | null; srs_due: string | null; srs_reps: number }>
  return rows[0] ?? null
}

describe('study-sessions checkpoints', () => {
  const basicDataPass = vi.fn()
  const senseMock = vi.fn()
  const testApp = buildTestApp({
    anthropicPasses: MockAnthropicPasses({
      basicDataPass: basicDataPass as never,
      checkpointSensePass: senseMock as never,
    }),
  })

  const setupUser = async () => {
    const { id, token } = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token, referral: null })
    await UsersRepository().setNativeLanguage(id, 'en')
    await UserTargetLanguagePrefsRepository().upsertCefr(id, 'ru', 'B1')
    return { userId: id, token }
  }

  const saveAdhocTerm = async (
    testAppRef: Express,
    token: string,
    targetLanguage: string,
    headword: string,
    sense: string
  ): Promise<string> => {
    basicDataPass.mockResolvedValueOnce([adhocChunk(headword, sense)])
    const created = await request(testAppRef)
      .post('/api/v1/cards/adhoc')
      .set(buildAuthorizationHeaders(token))
      .send({ targetLanguage, headword, context: null })
    expect(created.status).toBe(200)
    const card = await request(testAppRef)
      .get(`/api/v1/cards/${created.body.data.cardId}`)
      .set(buildAuthorizationHeaders(token))
    expect(card.status).toBe(200)
    return card.body.data.userLookupId as string
  }

  // A dedicated reading session (NOT the adhoc session): adhoc card saves
  // create highlights in the adhoc session, and highlight suppression would
  // correctly suppress every credit there.
  const createReadingSession = async (userId: string, targetLanguage: string) => {
    const [source] = (await sql`
      INSERT INTO public.content_sources (type, title, language, metadata, created_by_user_id)
      VALUES ('text', 'checkpoint test', ${targetLanguage}, '{}'::jsonb, ${userId})
      RETURNING id
    `) as [{ id: string }]
    const [track] = (await sql`
      INSERT INTO public.text_tracks (content_source_id, source, language, external_id, hash)
      VALUES (${source.id}, 'paste', ${targetLanguage}, NULL, ${__generateUniqueId('track')})
      RETURNING id
    `) as [{ id: string }]
    const [session] = (await sql`
      INSERT INTO public.study_sessions (user_id, content_source_id, text_track_id, native_language, target_language, cefr_level)
      VALUES (${userId}, ${source.id}, ${track.id}, 'en', ${targetLanguage}, 'B1')
      RETURNING *
    `) as [{ id: string; text_track_id: string }]
    return session
  }

  const appendSegment = async (textTrackId: string, text: string): Promise<number> => {
    const segment = await TextSegmentsRepository().appendSegmentAtomic({
      textTrackId,
      text,
      startMs: null,
      endMs: null,
    })
    return segment.index
  }

  test('returns 401 when unauthenticated', async () => {
    const response = await request(testApp)
      .get('/api/v1/study-sessions/00000000-0000-0000-0000-000000000001/checkpoint-preview?toSegmentIndex=5')
      .set({ Authorization: 'Bearer wrong-token' })
    expect(response.status).toBe(401)
  })

  test('collect returns UNSUPPORTED_LANGUAGE for a non-kaikki language and preview reports unsupported', async () => {
    const { userId, token } = await setupUser()
    await UserTargetLanguagePrefsRepository().upsertCefr(userId, 'es', 'B1')
    const esSession = await createReadingSession(userId, 'es')

    const preview = await request(testApp)
      .get(`/api/v1/study-sessions/${esSession.id}/checkpoint-preview?toSegmentIndex=50`)
      .set(buildAuthorizationHeaders(token))
    expect(preview.status).toBe(200)
    expect(preview.body.data).toEqual({ pendingCount: 0, backlogCount: 0, supported: false })

    const collected = await request(testApp)
      .post(`/api/v1/study-sessions/${esSession.id}/checkpoints`)
      .set(buildAuthorizationHeaders(token))
      .send({ toSegmentIndex: 50, previewedSpans: [] })
    expect(collected.status).toBe(422)
    expect(collected.body.data.errors[0].code).toBe('UNSUPPORTED_LANGUAGE')
  })

  test('golden path: preview → collect credits due terms, splits lanes, stamps provenance, moves the pointer', async () => {
    const suf = uniqueCyrillicSuffix()
    const { userId, token } = await setupUser()

    // Vocabulary: A due review (credited), B not due (skipped), C leech-parked
    // (excluded), D never-introduced (backlog), P multi-sense pair spanning
    // lanes (stove sense due review, bake sense never-introduced).
    const wordA = `стол${suf}`
    const wordB = `окно${suf}`
    const wordC = `дом${suf}`
    const wordD = `река${suf}`
    const wordP = `печь${suf}`
    const idA = await saveAdhocTerm(testApp, token, 'ru', wordA, 'table')
    const idB = await saveAdhocTerm(testApp, token, 'ru', wordB, 'window')
    const idC = await saveAdhocTerm(testApp, token, 'ru', wordC, 'house')
    const idD = await saveAdhocTerm(testApp, token, 'ru', wordD, 'river')
    const idPStove = await saveAdhocTerm(testApp, token, 'ru', wordP, 'stove')
    const idPBake = await saveAdhocTerm(testApp, token, 'ru', wordP, 'to bake')

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
    const { userId, token } = await setupUser()
    const word = `трава${suf}`
    const id = await saveAdhocTerm(testApp, token, 'ru', word, 'grass')
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
    const { userId, token } = await setupUser()
    const word = `гриб${suf}`
    const id = await saveAdhocTerm(testApp, token, 'ru', word, 'mushroom')
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
    const { userId, token } = await setupUser()
    // Two senses force the sense pass; the scripted pass rates the due facet
    // through the flashcard API before answering, simulating a concurrent
    // rating during the LLM call.
    const word = `ключ${suf}`
    const idKey = await saveAdhocTerm(testApp, token, 'ru', word, 'key')
    const idSpring = await saveAdhocTerm(testApp, token, 'ru', word, 'spring')
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
    const { userId, token } = await setupUser()
    const word = `заяц${suf}`
    const id = await saveAdhocTerm(testApp, token, 'ru', word, 'hare')
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
    const { userId, token } = await setupUser()
    const word = `волк${suf}`
    const id = await saveAdhocTerm(testApp, token, 'ru', word, 'wolf')
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
