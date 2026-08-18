import { describe, expect, test, vi } from 'vitest'
import request from 'supertest'
import { buildAuthorizationHeaders, buildTestApp } from '../../test/test-utils'
import { MockAnthropicPasses } from '../../transport/third-party/anthropic/anthropic-passes'
import type { CheckpointBacklogItem } from '../../transport/third-party/anthropic/passes/checkpoint-backlog-pass'
import { sql } from '../../transport/database/postgres-client'
import {
  appendSegment,
  createReadingSession,
  insertWiktionaryLemma,
  saveAdhocTerm,
  setupCheckpointUser,
  uniqueCyrillicSuffix,
} from './checkpoint-test-helpers'

// Homograph precision for backlog candidates (docs/SRS.md §6b): the
// frequency-asymmetry guard on the resolver edges, and the Haiku confirm pass
// on inflected-only candidates — verdicts filter both the collect response and
// the stored claim set the rehydration re-offers.
describe('study-sessions checkpoint backlog pass', () => {
  const basicDataPass = vi.fn()
  const backlogMock = vi.fn((params: { items: CheckpointBacklogItem[] }) =>
    Promise.resolve(params.items.map((item) => ({ headword: item.headword, occurs: true })))
  )
  const testApp = buildTestApp({
    anthropicPasses: MockAnthropicPasses({
      basicDataPass: basicDataPass as never,
      checkpointBacklogPass: backlogMock as never,
    }),
  })

  const collect = (sessionId: string, token: string, toSegmentIndex: number) =>
    request(testApp)
      .post(`/api/v1/study-sessions/${sessionId}/checkpoints`)
      .set(buildAuthorizationHeaders(token))
      .send({ toSegmentIndex, previewedSpans: [] })

  const getClaims = (sessionId: string, token: string) =>
    request(testApp).get(`/api/v1/study-sessions/${sessionId}/checkpoint-claims`).set(buildAuthorizationHeaders(token))

  test('a pass-denied candidate disappears from the response AND the claims rehydration', async () => {
    const suf = uniqueCyrillicSuffix()
    const { userId, token } = await setupCheckpointUser(testApp)
    const word = `молот${suf}`
    await saveAdhocTerm(testApp, token, basicDataPass, 'ru', word, 'hammer')
    await insertWiktionaryLemma(word, [`${word}ом`])
    const session = await createReadingSession(userId, 'ru')
    const lastIndex = await appendSegment(session.text_track_id, `Ударил ${word}ом по столу.`)

    backlogMock.mockImplementationOnce((params: { items: CheckpointBacklogItem[] }) =>
      Promise.resolve(params.items.map((item) => ({ headword: item.headword, occurs: false })))
    )
    const collected = await collect(session.id, token, lastIndex)
    expect(collected.status).toBe(200)
    expect(collected.body.data.backlogCandidates).toEqual([])
    // The verdict filtered the STORED candidate set too — a reload offers nothing.
    const claims = await getClaims(session.id, token)
    expect(claims.body.data.candidates).toEqual([])
    // The pass saw the candidate with its windowed context.
    const items = backlogMock.mock.calls.at(-1)![0].items
    expect(items).toEqual([{ headword: word, sense: 'hammer', contexts: [`Ударил ${word}ом по столу.`] }])
  })

  test('a pass failure drops inflected-only candidates but the collect still succeeds', async () => {
    const suf = uniqueCyrillicSuffix()
    const { userId, token } = await setupCheckpointUser(testApp)
    const word = `щит${suf}`
    await saveAdhocTerm(testApp, token, basicDataPass, 'ru', word, 'shield')
    await insertWiktionaryLemma(word, [`${word}ы`])
    const session = await createReadingSession(userId, 'ru')
    const lastIndex = await appendSegment(session.text_track_id, `Висят ${word}ы на стене.`)

    backlogMock.mockImplementationOnce(() => Promise.reject(new Error('scripted pass failure')))
    const collected = await collect(session.id, token, lastIndex)
    expect(collected.status).toBe(200)
    expect(collected.body.data.backlogCandidates).toEqual([])
  })

  test('a verbatim-headword candidate skips the pass and carries the cased surface', async () => {
    const suf = uniqueCyrillicSuffix()
    const { userId, token } = await setupCheckpointUser(testApp)
    const word = `забор${suf}`
    const id = await saveAdhocTerm(testApp, token, basicDataPass, 'ru', word, 'fence')
    await insertWiktionaryLemma(word, [])
    const session = await createReadingSession(userId, 'ru')
    const cased = `${word.charAt(0).toUpperCase()}${word.slice(1)}`
    const lastIndex = await appendSegment(session.text_track_id, `${cased} стоит тут.`)

    backlogMock.mockClear()
    const collected = await collect(session.id, token, lastIndex)
    expect(collected.status).toBe(200)
    expect(collected.body.data.backlogCandidates).toEqual([
      { userLookupId: id, headword: word, sense: 'fence', matchedSurface: cased, context: `${cased} стоит тут.` },
    ])
    expect(backlogMock).not.toHaveBeenCalled()
  })

  test('frequency guard: a dramatically rarer homograph reading neither credits nor backlogs; identity edges survive', async () => {
    const suf = uniqueCyrillicSuffix()
    const { userId, token } = await setupCheckpointUser(testApp)
    // Shared inflected form: `формаX` belongs to a very common lemma AND to
    // the rare saved lemma — the «при»→«переть» shape.
    const commonWord = `нога${suf}`
    const rareWord = `переть${suf}`
    const sharedForm = `форма${suf}`
    const rareId = await saveAdhocTerm(testApp, token, basicDataPass, 'ru', rareWord, 'to barge')
    await insertWiktionaryLemma(commonWord, [sharedForm])
    await insertWiktionaryLemma(rareWord, [sharedForm, rareWord])
    await sql`
      INSERT INTO public.lemma_ranks (target_language, lemma, rank, freq_mass)
      VALUES ('ru', ${commonWord}, 100, 0.001), ('ru', ${rareWord}, 90000, 0.0000001)
      ON CONFLICT DO NOTHING
    `
    const session = await createReadingSession(userId, 'ru')
    const firstIndex = await appendSegment(session.text_track_id, `Вот ${sharedForm} тут.`)

    backlogMock.mockClear()
    const viaSharedForm = await collect(session.id, token, firstIndex)
    expect(viaSharedForm.status).toBe(200)
    // The rare reading of the ambiguous token was dropped mechanically —
    // nothing to confirm, nothing offered.
    expect(viaSharedForm.body.data.backlogCandidates).toEqual([])
    expect(backlogMock).not.toHaveBeenCalled()

    // Identity protection: the rare word ITSELF in the text still matches,
    // even though the same token also resolves to the common lemma. Make the
    // token ambiguous by registering it as a form of the common lemma too.
    await insertWiktionaryLemma(commonWord, [rareWord])
    const secondIndex = await appendSegment(session.text_track_id, `А ${rareWord} тоже тут.`)
    const viaIdentity = await collect(session.id, token, secondIndex)
    expect(viaIdentity.status).toBe(200)
    expect(viaIdentity.body.data.backlogCandidates.map((c: { userLookupId: string }) => c.userLookupId)).toEqual([
      rareId,
    ])
    expect(backlogMock).not.toHaveBeenCalled()
  })
})
