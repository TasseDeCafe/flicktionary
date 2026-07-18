import { describe, expect, test, vi } from 'vitest'
import request from 'supertest'
import {
  __createOrGetUserWithOurApi,
  __createUserInSupabaseAndGetHisIdAndToken,
  buildTestApp,
} from '../../test/test-utils'
import { MockAnthropicPasses } from '../../transport/third-party/anthropic/anthropic-passes'
import { UsersRepository } from '../../transport/database/users/users-repository'

// Drives the oRPC contract over real HTTP through buildApp, with the LLM seam
// scripted via AppDependencies.anthropicPasses — the wiring/auth/DTO layer that
// pass-level unit tests cannot see. Golden path + one auth failure; exhaustive
// scenarios stay in the unit tests.
describe('glosses-router', () => {
  const fastGlossPass = vi.fn().mockResolvedValue({ gloss: 'the table', pos: 'noun', register: null })
  const languageDetectionPass = vi.fn().mockResolvedValue('de')
  const testApp = buildTestApp({
    anthropicPasses: MockAnthropicPasses({
      fastGlossPass: fastGlossPass as never,
      languageDetectionPass: languageDetectionPass as never,
    }),
  })

  test('returns 401 when unauthenticated', async () => {
    const response = await request(testApp)
      .post('/api/v1/glosses/fast-gloss')
      .set({ Authorization: 'Bearer wrong-token' })
      .send({ selectionText: 'Tisch', contextLine: 'Der Tisch ist groß.' })

    expect(response.status).toBe(401)
  })

  test('golden path: glosses a selection, detecting the text language when the client omits it', async () => {
    const { id, token } = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token, referral: null })
    await UsersRepository().setNativeLanguage(id, 'en')

    const response = await request(testApp)
      .post('/api/v1/glosses/fast-gloss')
      .set({ Authorization: `Bearer ${token}` })
      .send({ selectionText: 'Tisch', contextLine: 'Der Tisch ist groß.' })

    expect(response.status).toBe(200)
    expect(response.body.data).toEqual({
      gloss: 'the table',
      pos: 'noun',
      register: null,
      ipa: null,
      ipaDisplay: null,
      ipaLemma: null,
      knownLemmaCandidates: [],
    })
    // The gloss language is the language of the text, resolved by detection —
    // never the user's primary study language.
    expect(languageDetectionPass).toHaveBeenCalledWith('Der Tisch ist groß.')
    expect(fastGlossPass).toHaveBeenCalledWith({
      targetLanguage: 'de',
      nativeLanguage: 'en',
      hideTranslationFields: false,
      contextLine: 'Der Tisch ist groß.',
      selectionText: 'Tisch',
    })
  })

  test('returns 400 when the user has no native language yet', async () => {
    const { token } = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token, referral: null })

    const response = await request(testApp)
      .post('/api/v1/glosses/fast-gloss')
      .set({ Authorization: `Bearer ${token}` })
      .send({ selectionText: 'Tisch', contextLine: 'Der Tisch ist groß.', targetLanguage: 'de' })

    expect(response.status).toBe(400)
  })
})
