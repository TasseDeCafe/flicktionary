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

// One scripted basicDataPass row; bindChunksToSingleHighlight re-points the
// highlightId/segmentId to the synthetic adhoc highlight, so placeholders are
// fine here. Spanish target: no kaikki dump → no Wiktionary grounding runs.
const scriptedChunk = {
  source: 'highlight' as const,
  headword: 'correr',
  sense: 'to run',
  surfaceForm: 'correr',
  segmentId: 'rebound-to-the-real-segment',
  translation: 'to run',
  surfaceTranslation: null,
  definition: 'moverse deprisa',
  targetExample: 'Me gusta correr por la mañana.',
  nativeExample: 'I like to run in the morning.',
  grammar: { pos: 'verb' },
  belowCefr: false,
  zipf: 4.8,
}

// Drives the oRPC contract over real HTTP through buildApp, with the LLM seam
// scripted via AppDependencies.anthropicPasses. Golden path + one auth failure
// + one domain failure; exhaustive scenarios stay in the unit tests.
describe('cards-router', () => {
  const basicDataPass = vi.fn().mockResolvedValue([scriptedChunk])
  const testApp = buildTestApp({
    anthropicPasses: MockAnthropicPasses({
      basicDataPass: basicDataPass as never,
    }),
  })

  const onboardedUser = async () => {
    const created = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token: created.token, referral: null })
    await UsersRepository().setNativeLanguage(created.id, 'en')
    await UserTargetLanguagePrefsRepository().upsertCefr(created.id, 'es', 'B1')
    return created
  }

  const createAdhocCard = async (token: string) => {
    const response = await request(testApp).post('/api/v1/cards/adhoc').set(buildAuthorizationHeaders(token)).send({
      targetLanguage: 'es',
      headword: 'correr',
      context: 'Me gusta correr.',
    })
    expect(response.status).toBe(200)
    return response.body.data as { cardId: string; sessionId: string }
  }

  test('returns 401 when unauthenticated', async () => {
    const response = await request(testApp)
      .post('/api/v1/cards/adhoc')
      .set({ Authorization: 'Bearer wrong-token' })
      .send({ targetLanguage: 'es', headword: 'correr', context: null })

    expect(response.status).toBe(401)
  })

  test('golden path: creates an adhoc card, reads it, edits the surface form, and removes it', async () => {
    const { token } = await onboardedUser()
    const { cardId, sessionId } = await createAdhocCard(token)

    const fetched = await request(testApp).get(`/api/v1/cards/${cardId}`).set(buildAuthorizationHeaders(token))
    expect(fetched.status).toBe(200)
    // Adhoc entries keep immediately, and the chunk carries the scripted pass output.
    expect(fetched.body.data).toMatchObject({
      id: cardId,
      studySessionId: sessionId,
      status: 'kept',
      surfaceForm: 'correr',
      chunk: {
        headword: 'correr',
        sense: 'to run',
        translation: 'to run',
        definition: 'moverse deprisa',
        targetLanguage: 'es',
      },
    })

    const patched = await request(testApp)
      .patch(`/api/v1/cards/${cardId}/fields`)
      .set(buildAuthorizationHeaders(token))
      .send({ patch: { surfaceForm: 'corriendo' } })
    expect(patched.status).toBe(200)
    expect(patched.body.data.surfaceForm).toBe('corriendo')

    const listed = await request(testApp)
      .get(`/api/v1/study-sessions/${sessionId}/cards`)
      .set(buildAuthorizationHeaders(token))
    expect(listed.status).toBe(200)
    expect(listed.body.data.map((c: { id: string }) => c.id)).toContain(cardId)

    const removed = await request(testApp)
      .patch(`/api/v1/cards/${cardId}/remove-from-session`)
      .set(buildAuthorizationHeaders(token))
    expect(removed.status).toBe(200)
    expect(removed.body.data.status).toBe('removed')
  })

  test('returns 400 cefr_not_set when the user has no level for the target language', async () => {
    const { id, token } = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token, referral: null })
    await UsersRepository().setNativeLanguage(id, 'en')

    const response = await request(testApp).post('/api/v1/cards/adhoc').set(buildAuthorizationHeaders(token)).send({
      targetLanguage: 'es',
      headword: 'correr',
      context: null,
    })

    expect(response.status).toBe(400)
    expect(response.body.data.errors[0].code).toBe('cefr_not_set')
  })
})
