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
describe('study-sessions-router', () => {
  const languageDetectionPass = vi.fn().mockResolvedValue('de')
  const testApp = buildTestApp({
    anthropicPasses: MockAnthropicPasses({
      languageDetectionPass: languageDetectionPass as never,
    }),
  })

  const onboardedUser = async () => {
    const created = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token: created.token, referral: null })
    await UsersRepository().setNativeLanguage(created.id, 'en')
    await UserTargetLanguagePrefsRepository().upsertCefr(created.id, 'de', 'B1')
    return created
  }

  test('returns 401 when unauthenticated', async () => {
    const response = await request(testApp)
      .post('/api/v1/study-sessions/import-text')
      .set({ Authorization: 'Bearer wrong-token' })
      .send({ title: 'Ein Text', text: 'Der Tisch ist groß.' })

    expect(response.status).toBe(401)
  })

  test('golden path: imports a text into a session (idempotent by content), then lists and gets it', async () => {
    const { token } = await onboardedUser()
    // Two non-empty lines → two segments; the detected language becomes the
    // session target language.
    const text = 'Der Tisch ist groß.\nDie Katze schläft.'

    const imported = await request(testApp)
      .post('/api/v1/study-sessions/import-text')
      .set(buildAuthorizationHeaders(token))
      .send({ title: 'Ein Text', text })

    expect(imported.status).toBe(200)
    expect(imported.body.data.segmentCount).toBe(2)
    const { sessionId } = imported.body.data

    // Re-importing the same body resolves to the same session.
    const reimported = await request(testApp)
      .post('/api/v1/study-sessions/import-text')
      .set(buildAuthorizationHeaders(token))
      .send({ title: 'Ein Text', text })
    expect(reimported.status).toBe(200)
    expect(reimported.body.data.sessionId).toBe(sessionId)

    const fetched = await request(testApp)
      .get(`/api/v1/study-sessions/${sessionId}`)
      .set(buildAuthorizationHeaders(token))
    expect(fetched.status).toBe(200)
    expect(fetched.body.data).toMatchObject({
      id: sessionId,
      targetLanguage: 'de',
      nativeLanguage: 'en',
      cefrLevel: 'B1',
      contentSourceTitle: 'Ein Text',
      contentSourceType: 'text',
    })

    const listed = await request(testApp).get('/api/v1/study-sessions').set(buildAuthorizationHeaders(token))
    expect(listed.status).toBe(200)
    expect(listed.body.data.map((s: { id: string }) => s.id)).toContain(sessionId)
  })

  test('reading position: advance is monotonic, the explicit set is not', async () => {
    const { token } = await onboardedUser()
    const imported = await request(testApp)
      .post('/api/v1/study-sessions/import-text')
      .set(buildAuthorizationHeaders(token))
      .send({ title: 'Position', text: 'Der Tisch ist groß.\nDie Katze schläft.\nDer Hund bellt laut.' })
    expect(imported.status).toBe(200)
    const { sessionId } = imported.body.data

    const furthestReadIndex = async (): Promise<number | null> => {
      const fetched = await request(testApp)
        .get(`/api/v1/study-sessions/${sessionId}`)
        .set(buildAuthorizationHeaders(token))
      expect(fetched.status).toBe(200)
      return fetched.body.data.furthestReadSegmentIndex
    }

    // The throttled advance path keeps the pointer monotonic: a late lower
    // write can't walk it backwards.
    const advanced = await request(testApp)
      .post(`/api/v1/study-sessions/${sessionId}/reading-progress`)
      .set(buildAuthorizationHeaders(token))
      .send({ segmentIndex: 2 })
    expect(advanced.status).toBe(200)
    await request(testApp)
      .post(`/api/v1/study-sessions/${sessionId}/reading-progress`)
      .set(buildAuthorizationHeaders(token))
      .send({ segmentIndex: 1 })
    expect(await furthestReadIndex()).toBe(2)

    // The explicit bookmark set may move it backwards.
    const set = await request(testApp)
      .put(`/api/v1/study-sessions/${sessionId}/reading-position`)
      .set(buildAuthorizationHeaders(token))
      .send({ segmentIndex: 0 })
    expect(set.status).toBe(200)
    expect(await furthestReadIndex()).toBe(0)

    // Another user's session is invisible to the set.
    const stranger = await onboardedUser()
    const foreign = await request(testApp)
      .put(`/api/v1/study-sessions/${sessionId}/reading-position`)
      .set(buildAuthorizationHeaders(stranger.token))
      .send({ segmentIndex: 1 })
    expect(foreign.status).toBe(404)
    expect(await furthestReadIndex()).toBe(0)

    const unauthenticated = await request(testApp)
      .put(`/api/v1/study-sessions/${sessionId}/reading-position`)
      .set({ Authorization: 'Bearer wrong-token' })
      .send({ segmentIndex: 1 })
    expect(unauthenticated.status).toBe(401)
  })

  test('returns 422 MISSING_CEFR when the user has no level for the detected language', async () => {
    const { id, token } = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token, referral: null })
    await UsersRepository().setNativeLanguage(id, 'en')

    const response = await request(testApp)
      .post('/api/v1/study-sessions/import-text')
      .set(buildAuthorizationHeaders(token))
      .send({ title: 'Ein Text', text: 'Der Tisch ist groß.' })

    expect(response.status).toBe(422)
    expect(response.body.data.errors[0]).toMatchObject({ code: 'MISSING_CEFR', targetLanguage: 'de' })
  })
})
