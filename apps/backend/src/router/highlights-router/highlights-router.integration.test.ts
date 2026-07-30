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

// Drives the oRPC contract over real HTTP through buildApp, with the LLM seam
// scripted via AppDependencies.anthropicPasses. Golden path + one auth failure
// + one domain failure; exhaustive scenarios stay in the unit tests.
describe('highlights-router', () => {
  const languageDetectionPass = vi.fn().mockResolvedValue('de')
  const testApp = buildTestApp({
    anthropicPasses: MockAnthropicPasses({
      languageDetectionPass: languageDetectionPass as never,
      moderationPass: vi.fn().mockResolvedValue({ verdict: 'allow' }) as never,
    }),
  })

  // A session with real segments, created through the import-text flow the
  // same way the extension does it.
  const createSessionWithSegments = async () => {
    const { id, token } = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token, referral: null })
    await UsersRepository().setNativeLanguage(id, 'en')
    await UserTargetLanguagePrefsRepository().upsertCefr(id, 'de', 'B1')

    const imported = await request(testApp)
      .post('/api/v1/study-sessions/import-text')
      .set(buildAuthorizationHeaders(token))
      .send({ title: 'Ein Text', text: 'Der Tisch ist groß.\nDie Katze schläft.' })
    expect(imported.status).toBe(200)
    const { sessionId, textTrackId } = imported.body.data

    const segments = await request(testApp)
      .get(`/api/v1/text-tracks/${textTrackId}/segments`)
      .set(buildAuthorizationHeaders(token))
    expect(segments.status).toBe(200)

    return { token, sessionId, segments: segments.body.data as Array<{ id: string; text: string }> }
  }

  test('returns 401 when unauthenticated', async () => {
    const response = await request(testApp)
      .get('/api/v1/study-sessions/6f76ff59-3d4f-4e33-a1b8-3d6b0a06f8f0/highlights')
      .set({ Authorization: 'Bearer wrong-token' })

    expect(response.status).toBe(401)
  })

  test('golden path: creates a highlight (enqueuing enrichment), lists it, and deletes it', async () => {
    const { token, sessionId, segments } = await createSessionWithSegments()
    const segment = segments[0]

    const created = await request(testApp)
      .post(`/api/v1/study-sessions/${sessionId}/highlights`)
      .set(buildAuthorizationHeaders(token))
      .send({
        sessionId,
        startSegmentId: segment.id,
        endSegmentId: segment.id,
        startOffset: 4,
        endOffset: 9,
        selectionText: 'Tisch',
        // Preview gloss already shown pre-save: persisting it means saved-mode
        // display never re-runs the fast-gloss pass.
        fastGloss: { gloss: 'the table', pos: 'noun', register: null },
      })

    expect(created.status).toBe(201)
    expect(created.body.data).toMatchObject({
      studySessionId: sessionId,
      selectionText: 'Tisch',
      startOffset: 4,
      endOffset: 9,
      noteOnly: false,
    })
    const highlightId = created.body.data.id

    // The save enqueued a (debounced) background enrichment job for this
    // highlight — the session-vocabulary status endpoint reports it in flight.
    const status = await request(testApp)
      .get(`/api/v1/study-sessions/${sessionId}/processing-status`)
      .set(buildAuthorizationHeaders(token))
    expect(status.status).toBe(200)
    expect(status.body.data.enrichingHighlightIds).toContain(highlightId)

    const listed = await request(testApp)
      .get(`/api/v1/study-sessions/${sessionId}/highlights`)
      .set(buildAuthorizationHeaders(token))
    expect(listed.status).toBe(200)
    expect(listed.body.data.map((h: { id: string }) => h.id)).toEqual([highlightId])
    expect(listed.body.data[0].fastGloss).toContain('the table')

    const deleted = await request(testApp)
      .delete(`/api/v1/study-sessions/${sessionId}/highlights/${highlightId}`)
      .set(buildAuthorizationHeaders(token))
    expect(deleted.status).toBe(200)
    expect(deleted.body.data.id).toBe(highlightId)

    const relisted = await request(testApp)
      .get(`/api/v1/study-sessions/${sessionId}/highlights`)
      .set(buildAuthorizationHeaders(token))
    expect(relisted.body.data).toEqual([])
  })

  test("returns 404 when creating a highlight in another user's session", async () => {
    const { sessionId, segments } = await createSessionWithSegments()
    const stranger = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token: stranger.token, referral: null })

    const response = await request(testApp)
      .post(`/api/v1/study-sessions/${sessionId}/highlights`)
      .set(buildAuthorizationHeaders(stranger.token))
      .send({
        sessionId,
        startSegmentId: segments[0].id,
        endSegmentId: segments[0].id,
        startOffset: 0,
        endOffset: 3,
        selectionText: 'Der',
      })

    expect(response.status).toBe(404)
  })
})
