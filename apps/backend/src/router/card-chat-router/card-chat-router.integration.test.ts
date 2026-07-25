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

// Same scripted basicDataPass row the cards-router test uses — the chat golden
// path needs a real card to talk about, minted through the adhoc endpoint.
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

// An Opus turn that patches the translation via the editing tool.
const toolPatchTurn = {
  content: [
    { type: 'text', text: 'Changed the translation.' },
    { type: 'tool_use', id: 'tu_1', name: 'update_card_fields', input: { translation: 'to sprint' } },
  ],
}

const conversationalTurn = {
  content: [{ type: 'text', text: 'It means "to run".' }],
}

// Drives the oRPC contract over real HTTP through buildApp, with the LLM seam
// scripted via AppDependencies.anthropicPasses. Golden path + one auth failure
// + the no-patch variant; exhaustive tool-parsing scenarios stay in the
// run-card-chat unit tests.
describe('card-chat-router', () => {
  const createChatCompletion = vi.fn()
  const testApp = buildTestApp({
    anthropicPasses: MockAnthropicPasses({
      basicDataPass: vi.fn().mockResolvedValue([scriptedChunk]) as never,
      // Adhoc note-only sessions never ran an enrich job, so chat lazily mints
      // the session context blob on first use.
      generateContextBlob: vi.fn().mockResolvedValue('a scripted context blob') as never,
      createChatCompletion: createChatCompletion as never,
    }),
  })

  const onboardedUserWithCard = async () => {
    const created = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token: created.token, referral: null })
    await UsersRepository().setNativeLanguage(created.id, 'en')
    await UserTargetLanguagePrefsRepository().upsertCefr(created.id, 'es', 'B1')
    const response = await request(testApp)
      .post('/api/v1/cards/adhoc')
      .set(buildAuthorizationHeaders(created.token))
      .send({ targetLanguage: 'es', headword: 'correr', context: 'Me gusta correr.' })
    expect(response.status).toBe(200)
    return { token: created.token, cardId: response.body.data.cardId as string }
  }

  test('returns 401 when unauthenticated', async () => {
    const response = await request(testApp)
      .post('/api/v1/cards/00000000-0000-0000-0000-000000000001/chat')
      .set({ Authorization: 'Bearer wrong-token' })
      .send({ content: 'hola' })

    expect(response.status).toBe(401)
  })

  test('golden path: a tool-patched turn persists the edit and returns the updated chunk', async () => {
    const { token, cardId } = await onboardedUserWithCard()
    createChatCompletion.mockResolvedValue(toolPatchTurn)

    const response = await request(testApp)
      .post(`/api/v1/cards/${cardId}/chat`)
      .set(buildAuthorizationHeaders(token))
      .send({ content: 'Change the translation to "to sprint" please' })

    expect(response.status).toBe(201)
    expect(response.body.data.userMessage.role).toBe('user')
    expect(response.body.data.assistantMessage.content).toContain('Updated: translation')
    // The response carries the chunk as persisted, not the raw tool input.
    expect(response.body.data.updatedChunk).toMatchObject({
      headword: 'correr',
      translation: 'to sprint',
      definition: 'moverse deprisa',
    })
  })

  test('a purely conversational turn returns updatedChunk null', async () => {
    const { token, cardId } = await onboardedUserWithCard()
    createChatCompletion.mockResolvedValue(conversationalTurn)

    const response = await request(testApp)
      .post(`/api/v1/cards/${cardId}/chat`)
      .set(buildAuthorizationHeaders(token))
      .send({ content: 'What does it mean?' })

    expect(response.status).toBe(201)
    expect(response.body.data.updatedChunk).toBeNull()
  })
})
