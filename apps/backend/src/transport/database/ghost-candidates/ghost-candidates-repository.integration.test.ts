import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import { GhostCandidatesRepository } from './ghost-candidates-repository'
import { StudySessionsRepository } from '../study-sessions/study-sessions-repository'
import { TextSegmentsRepository } from '../text-segments/text-segments-repository'
import { sql } from '../postgres-client'
import {
  __createUserInSupabaseAndGetHisIdAndToken,
  __generateUniqueId,
  __removeAllAuthUsersFromSupabase,
} from '../../../test/test-utils'

// Pre-save ghost adoption (highlights.create with adoptedGhostId): one
// transaction must insert the highlight (with the study intent), dismiss the
// ghost, and enqueue enrichment — and an already-dismissed ghost must never
// fail the save (the user's chosen span is what matters; only the dismissal is
// skipped).
describe('ghost-candidates-repository insertHighlightAdoptingGhost integration tests', () => {
  const ghostCandidatesRepository = GhostCandidatesRepository()
  const studySessionsRepository = StudySessionsRepository()
  const textSegmentsRepository = TextSegmentsRepository()

  beforeEach(async () => {
    await __removeAllAuthUsersFromSupabase()
  })

  afterAll(async () => {
    await __removeAllAuthUsersFromSupabase()
  })

  const createFixture = async (userId: string) => {
    const { session, track } = await studySessionsRepository.getOrCreateAdhocStudySession({
      userId,
      targetLanguage: 'es',
      nativeLanguage: 'en',
      cefrLevel: 'B1',
      title: 'Ghost adoption integration test',
      trackHash: __generateUniqueId('track'),
      contextBlob: 'integration test context',
    })
    const segment = await textSegmentsRepository.appendSegmentAtomic({
      textTrackId: track.id,
      text: 'no especialmente popular',
      startMs: null,
      endMs: null,
    })
    await ghostCandidatesRepository.insertMany([
      {
        studySessionId: session.id,
        segmentId: segment.id,
        charStart: 0,
        charEnd: 16,
        surfaceForm: 'no especialmente',
      },
    ])
    const [ghost] = await ghostCandidatesRepository.listLiveBySession(session.id)
    return { session, segment, ghost: ghost! }
  }

  const adoptionParams = (fixture: Awaited<ReturnType<typeof createFixture>>, userId: string) => ({
    studySessionId: fixture.session.id,
    startSegmentId: fixture.segment.id,
    endSegmentId: fixture.segment.id,
    startOffset: fixture.ghost.char_start,
    endOffset: fixture.ghost.char_end,
    selectionText: fixture.ghost.surface_form,
    note: null,
    presetTags: [],
    studyIntent: { skills: ['meaning_production'], formScope: 'both' },
    fastGloss: null,
    userId,
    ghostId: fixture.ghost.id,
    enrichDebounceMs: 0,
  })

  test('inserts the highlight with the intent, dismisses the ghost, and enqueues enrichment in one go', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const fixture = await createFixture(userId)

    const highlight = await ghostCandidatesRepository.insertHighlightAdoptingGhost(adoptionParams(fixture, userId))

    expect(highlight.selection_text).toBe('no especialmente')
    expect(highlight.study_intent).toEqual({ skills: ['meaning_production'], formScope: 'both' })
    expect(highlight.study_intent_applied_at).toBeNull()

    const live = await ghostCandidatesRepository.listLiveBySession(fixture.session.id)
    expect(live).toHaveLength(0)

    const jobs = await sql`SELECT kind, status FROM public.processing_jobs WHERE highlight_id = ${highlight.id}`
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({ kind: 'enrich_highlight', status: 'pending' })
  })

  test('an already-dismissed ghost does not fail the save — highlight + job still land', async () => {
    const { id: userId } = await __createUserInSupabaseAndGetHisIdAndToken()
    const fixture = await createFixture(userId)
    await sql`UPDATE public.ghost_candidates SET dismissed_at = now() WHERE id = ${fixture.ghost.id}`

    const highlight = await ghostCandidatesRepository.insertHighlightAdoptingGhost(adoptionParams(fixture, userId))

    expect(highlight.id).toBeTruthy()
    const jobs = await sql`SELECT id FROM public.processing_jobs WHERE highlight_id = ${highlight.id}`
    expect(jobs).toHaveLength(1)
  })
})
