import { describe, expect, test } from 'vitest'
import { ProcessingJobsRepository } from './processing-jobs-repository'
import { StudySessionsRepository } from '../study-sessions/study-sessions-repository'
import { TextSegmentsRepository } from '../text-segments/text-segments-repository'
import { HighlightsRepository } from '../highlights/highlights-repository'
import { sql } from '../postgres-client'
import { __createUserInSupabaseAndGetHisIdAndToken, __generateUniqueId } from '../../../test/test-utils'

// These tests guard the enrich-enqueue ON CONFLICT predicate against drift from the
// uq_processing_jobs_live_enrich partial unique index. The predicate and the index
// must stay in lockstep; when a migration rescoped the index (adding kind =
// 'enrich_highlight') the stale predicate stopped matching any index and every
// enqueue raised Postgres 42P10 ("no unique or exclusion constraint matching the ON
// CONFLICT specification"). Because highlights.create and the ghost-adoption switch
// both enqueue through this one function, these tests cover both call paths.
describe('processing-jobs-repository enqueue integration tests', () => {
  const { enqueue } = ProcessingJobsRepository()
  const studySessionsRepository = StudySessionsRepository()
  const textSegmentsRepository = TextSegmentsRepository()
  const highlightsRepository = HighlightsRepository()

  // Build the FK chain enqueue needs: user -> adhoc session (+ content source +
  // track) -> segment -> highlight. Deleting the auth user cascades all of it away.
  const createHighlightFixture = async (userId: string) => {
    const { session, track } = await studySessionsRepository.getOrCreateAdhocStudySession({
      userId,
      targetLanguage: 'es',
      nativeLanguage: 'en',
      cefrLevel: 'B1',
      title: 'Integration test source',
      trackHash: __generateUniqueId('track'),
      contextBlob: 'integration test context',
    })
    const segment = await textSegmentsRepository.appendSegmentAtomic({
      textTrackId: track.id,
      text: 'una palabra nueva',
      startMs: null,
      endMs: null,
    })
    const highlight = await highlightsRepository.insertHighlight({
      studySessionId: session.id,
      startSegmentId: segment.id,
      endSegmentId: segment.id,
      startOffset: 4,
      endOffset: 11,
      selectionText: 'palabra',
      note: null,
      presetTags: [],
      studyIntent: null,
      fastGloss: null,
    })
    return { session, highlight }
  }

  test('enqueues an enrich_highlight job for a freshly created highlight', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const { session, highlight } = await createHighlightFixture(userId)

    // The regression: a predicate/index mismatch raises 42P10 right here.
    const job = await enqueue({
      kind: 'enrich_highlight',
      sessionId: session.id,
      userId,
      highlightId: highlight.id,
    })

    expect(job).not.toBeNull()
    expect(job?.kind).toBe('enrich_highlight')
    expect(job?.highlight_id).toBe(highlight.id)
    expect(job?.study_session_id).toBe(session.id)
    expect(job?.status).toBe('pending')
  })

  test('coalesces a second enqueue while a live job exists (ON CONFLICT DO NOTHING)', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const { session, highlight } = await createHighlightFixture(userId)

    const first = await enqueue({ kind: 'enrich_highlight', sessionId: session.id, userId, highlightId: highlight.id })
    const second = await enqueue({ kind: 'enrich_highlight', sessionId: session.id, userId, highlightId: highlight.id })

    expect(first).not.toBeNull()
    expect(second).toBeNull()

    const rows = await sql`SELECT id FROM public.processing_jobs WHERE highlight_id = ${highlight.id}`
    expect(rows).toHaveLength(1)
  })

  test('allows a fresh job once the previous one is no longer live', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const { session, highlight } = await createHighlightFixture(userId)

    const first = await enqueue({ kind: 'enrich_highlight', sessionId: session.id, userId, highlightId: highlight.id })
    expect(first).not.toBeNull()

    // Drive the job out of the live (pending/processing) set the partial index is
    // scoped to, so a new enrichment for the same highlight is allowed again — this
    // exercises the `status IN ('pending', 'processing')` half of the predicate.
    await sql`UPDATE public.processing_jobs SET status = 'done' WHERE id = ${first!.id}`

    const second = await enqueue({ kind: 'enrich_highlight', sessionId: session.id, userId, highlightId: highlight.id })
    expect(second).not.toBeNull()
    expect(second?.id).not.toBe(first?.id)
  })
})

// Same predicate/index-lockstep guard for the track-keyed profile-build jobs
// (uq_processing_jobs_live_build_track_lemma_profile), plus the identity-CHECK
// branch: the job carries ONLY a text track (no session/highlight/batch).
describe('processing-jobs-repository enqueueBuildTrackLemmaProfile integration tests', () => {
  const { enqueueBuildTrackLemmaProfile } = ProcessingJobsRepository()
  const studySessionsRepository = StudySessionsRepository()

  const createTrackFixture = async (userId: string) => {
    const { track } = await studySessionsRepository.getOrCreateAdhocStudySession({
      userId,
      targetLanguage: 'es',
      nativeLanguage: 'en',
      cefrLevel: 'B1',
      title: 'Profile job test source',
      trackHash: __generateUniqueId('track'),
      contextBlob: 'integration test context',
    })
    return track
  }

  test('enqueues a track-only job and coalesces while it is live', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const track = await createTrackFixture(userId)

    const first = await enqueueBuildTrackLemmaProfile({ textTrackId: track.id, userId })
    expect(first).not.toBeNull()
    expect(first?.kind).toBe('build_track_lemma_profile')
    expect(first?.text_track_id).toBe(track.id)
    expect(first?.study_session_id).toBeNull()
    expect(first?.highlight_id).toBeNull()
    expect(first?.import_batch_id).toBeNull()
    expect(first?.status).toBe('pending')

    const second = await enqueueBuildTrackLemmaProfile({ textTrackId: track.id, userId })
    expect(second).toBeNull()

    const rows = await sql`SELECT id FROM public.processing_jobs WHERE text_track_id = ${track.id}`
    expect(rows).toHaveLength(1)
  })

  test('allows a fresh build once the previous job is no longer live', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const track = await createTrackFixture(userId)

    const first = await enqueueBuildTrackLemmaProfile({ textTrackId: track.id, userId })
    expect(first).not.toBeNull()
    await sql`UPDATE public.processing_jobs SET status = 'done' WHERE id = ${first!.id}`

    const second = await enqueueBuildTrackLemmaProfile({ textTrackId: track.id, userId })
    expect(second).not.toBeNull()
    expect(second?.id).not.toBe(first?.id)
  })
})
