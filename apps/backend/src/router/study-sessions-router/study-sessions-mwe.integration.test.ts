import { describe, expect, test, vi } from 'vitest'
import request from 'supertest'
import { buildAuthorizationHeaders, buildTestApp } from '../../test/test-utils'
import { MockAnthropicPasses } from '../../transport/third-party/anthropic/anthropic-passes'
import type { CheckpointMweItem } from '../../transport/third-party/anthropic/passes/checkpoint-mwe-pass'
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

// MWE checkpoint matching (docs/SRS.md §6b): liberal recall filter (all
// content lemmas within one segment, inflected occurrences resolved through
// wiktionary_forms) + scripted Haiku confirm/deny.
describe('study-sessions checkpoints MWE matching', () => {
  const basicDataPass = vi.fn()
  const mweMock = vi.fn()
  const testApp = buildTestApp({
    anthropicPasses: MockAnthropicPasses({
      basicDataPass: basicDataPass as never,
      checkpointMwePass: mweMock as never,
    }),
  })

  const setupMwe = async (confirm: boolean) => {
    const suf = uniqueCyrillicSuffix()
    const { userId, token } = await setupCheckpointUser(testApp)
    const wordA = `бить${suf}`
    const wordB = `баклуши${suf}`
    const mwe = `${wordA} ${wordB}`
    const id = await saveAdhocTerm(testApp, token, basicDataPass, 'ru', mwe, 'to idle')
    await patchRecognitionFacet(id, { state: 'review', dueOffsetDays: -1 })
    // The verb appears INFLECTED in the segment; the noun appears verbatim.
    await insertWiktionaryLemma(wordA, [`${wordA}ет`])
    await insertWiktionaryLemma(wordB, [])
    const session = await createReadingSession(userId, 'ru')
    const segmentText = `Он ${wordA}ет весь день ${wordB} дома.`
    const lastIndex = await appendSegment(session.text_track_id, segmentText)

    mweMock.mockImplementationOnce((params: { items: CheckpointMweItem[] }) =>
      Promise.resolve(params.items.map((item) => ({ mweHeadword: item.mweHeadword, occurs: confirm })))
    )
    const collected = await request(testApp)
      .post(`/api/v1/study-sessions/${session.id}/checkpoints`)
      .set(buildAuthorizationHeaders(token))
      .send({ toSegmentIndex: lastIndex, previewedSpans: [] })
    expect(collected.status).toBe(200)
    return { id, mwe, segmentText, collected: collected.body.data }
  }

  test('a confirmed MWE candidate is credited through the normal path', async () => {
    const { id, mwe, segmentText, collected } = await setupMwe(true)
    expect(collected.creditedCount).toBe(1)

    // The pass saw the reordered/inflected candidate with its full segment.
    const items = (mweMock.mock.calls.at(-1)![0] as { items: CheckpointMweItem[] }).items
    expect(items).toEqual([{ mweHeadword: mwe, segmentText }])

    const events = await sql`
      SELECT id FROM public.practice_rating_events
      WHERE user_lookup_id = ${id} AND was_explicit = FALSE AND reverted_at IS NULL
    `
    expect(events).toHaveLength(1)
  })

  test('a denied MWE candidate credits nothing', async () => {
    const { id, collected } = await setupMwe(false)
    expect(collected.creditedCount).toBe(0)
    const facet = await getRecognitionFacet(id)
    // Untouched: still due review with its original reps.
    expect(facet!.srs_state).toBe('review')
    expect(facet!.srs_reps).toBe(3)
    const events = await sql`
      SELECT id FROM public.practice_rating_events
      WHERE user_lookup_id = ${id} AND was_explicit = FALSE AND reverted_at IS NULL
    `
    expect(events).toHaveLength(0)
  })
})
