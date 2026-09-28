import { describe, expect, test, vi } from 'vitest'
import request from 'supertest'
import {
  __createOrGetUserWithOurApi,
  __createUserInSupabaseAndGetHisIdAndToken,
  __getAnonymousSupabaseToken,
  buildAuthorizationHeaders,
  buildTestApp,
} from '../../test/test-utils'
import { MockAnthropicPasses } from '../../transport/third-party/anthropic/anthropic-passes'
import { UsersRepository } from '../../transport/database/users/users-repository'
import { UserTargetLanguagePrefsRepository } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import { sql } from '../../transport/database/postgres-client'

// An Opus turn that proposes two cards, then the prose reply written after the
// tool_result.
const proposeTurn = {
  content: [
    {
      type: 'tool_use',
      id: 'tu_1',
      name: 'propose_cards',
      input: {
        items: [
          { headword: 'засыпа́ть', note: 'to fall asleep (impf)', example: 'Я долго засыпаю.' },
          { headword: 'заснуть', note: 'to fall asleep (pf)', example: 'Я не мог заснуть.' },
        ],
      },
    },
  ],
}
const replyTurn = { content: [{ type: 'text', text: 'Both mean "to fall asleep"; the aspect differs.' }] }

// Drives the oRPC contract over real HTTP through buildApp with the LLM seam
// scripted. Golden path (translate, start with a proposal, add an item, read
// the thread) + auth failures + one domain failure; tool-loop details stay in
// the unit tests.
describe('vocab-chat-router', () => {
  const createChatCompletion = vi.fn()
  const moderationPass = vi.fn().mockResolvedValue({ verdict: 'allow' })
  const passes = MockAnthropicPasses({
    createChatCompletion: createChatCompletion as never,
    moderationPass: moderationPass as never,
    translateForCapturePass: vi.fn().mockResolvedValue({
      inputLanguage: 'en',
      candidates: [{ headword: 'засыпать', note: 'to fall asleep', example: 'Я быстро засыпаю.' }],
    }) as never,
    vocabChatTitlePass: vi.fn().mockResolvedValue('Falling asleep') as never,
  })
  const testApp = buildTestApp({ anthropicPasses: passes })

  const onboardedUser = async () => {
    const created = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token: created.token, referral: null })
    await UsersRepository().setNativeLanguage(created.id, 'en')
    await UserTargetLanguagePrefsRepository().upsertCefr(created.id, 'ru', 'B1')
    return created
  }

  test('returns 401 when unauthenticated', async () => {
    const response = await request(testApp)
      .post('/api/v1/vocab-chat/translate')
      .set({ Authorization: 'Bearer wrong-token' })
      .send({ text: 'to fall asleep', targetLanguage: 'ru' })

    expect(response.status).toBe(401)
  })

  test('rejects guests', async () => {
    const guestApp = buildTestApp({ anthropicPasses: passes, isGuestModeEnabled: true })
    const { token } = await __getAnonymousSupabaseToken()
    await request(guestApp)
      .put('/api/v1/users/me')
      .set(buildAuthorizationHeaders(token))
      .send({ referral: null, nativeLanguage: 'en' })

    const response = await request(guestApp)
      .post('/api/v1/vocab-chat/translate')
      .set(buildAuthorizationHeaders(token))
      .send({ text: 'to fall asleep', targetLanguage: 'ru' })

    expect(response.status).toBe(403)
    expect(response.body.data.errors[0].code).toBe('GUEST_NOT_ALLOWED')
  })

  test('golden path: translate, start a thread with a proposal, add an item, read the thread', async () => {
    const { id, token } = await onboardedUser()
    const headers = buildAuthorizationHeaders(token)

    const translated = await request(testApp)
      .post('/api/v1/vocab-chat/translate')
      .set(headers)
      .send({ text: 'to fall asleep', targetLanguage: 'ru' })
    expect(translated.status).toBe(200)
    expect(translated.body.data.candidates).toHaveLength(1)
    // Not in the learner's vocabulary yet, so no card to point at.
    expect(translated.body.data.candidates[0].existingCard).toBeNull()

    createChatCompletion.mockResolvedValueOnce(proposeTurn).mockResolvedValueOnce(replyTurn)
    const started = await request(testApp)
      .post('/api/v1/vocab-chat/threads')
      .set(headers)
      .send({ targetLanguage: 'ru', content: 'How do I say "to fall asleep"?' })
    expect(started.status).toBe(201)
    const { sessionId, title, assistantMessage } = started.body.data
    expect(title).toBe('Falling asleep')
    expect(assistantMessage.content).toBe(replyTurn.content[0].text)
    // Stress marks are stripped from proposed headwords (stored headwords
    // never carry them).
    expect(assistantMessage.proposal.items.map((i: { headword: string }) => i.headword)).toEqual([
      'засыпать',
      'заснуть',
    ])
    expect(assistantMessage.proposal.items.every((i: { added: boolean }) => !i.added)).toBe(true)

    const added = await request(testApp)
      .post(`/api/v1/vocab-chat/threads/${sessionId}/messages/${assistantMessage.id}/add`)
      .set(headers)
      .send({ itemIndexes: [1] })
    expect(added.status).toBe(200)
    expect(added.body.data.message.proposal.items.map((i: { added: boolean }) => i.added)).toEqual([false, true])

    // The added item becomes a highlight + enrich job on the thread's session.
    const jobs = await sql`
      SELECT j.kind, h.selection_text
      FROM public.processing_jobs j
      JOIN public.highlights h ON h.id = j.highlight_id
      WHERE j.study_session_id = ${sessionId} AND j.user_id = ${id}
    `
    expect(jobs).toEqual([{ kind: 'enrich_highlight', selection_text: 'заснуть' }])

    const thread = await request(testApp).get(`/api/v1/vocab-chat/threads/${sessionId}`).set(headers)
    expect(thread.status).toBe(200)
    expect(thread.body.data.title).toBe('Falling asleep')
    expect(thread.body.data.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant'])
  })

  test('a follow-up turn adds earlier proposals on request and offers a new thread for another language', async () => {
    const { token } = await onboardedUser()
    const headers = buildAuthorizationHeaders(token)
    createChatCompletion.mockResolvedValueOnce(proposeTurn).mockResolvedValueOnce(replyTurn)
    const started = await request(testApp)
      .post('/api/v1/vocab-chat/threads')
      .set(headers)
      .send({ targetLanguage: 'ru', content: 'to fall asleep?' })
    const { sessionId, assistantMessage } = started.body.data

    createChatCompletion
      .mockResolvedValueOnce({
        content: [
          {
            type: 'tool_use',
            id: 'tu_add',
            name: 'add_proposed_cards',
            input: { proposal_id: assistantMessage.id, item_indexes: [0, 1] },
          },
          {
            type: 'tool_use',
            id: 'tu_new',
            name: 'suggest_new_thread',
            input: { language: 'es', message: 'and in Spanish?' },
          },
        ],
      })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Added both.' }] })
    const sent = await request(testApp)
      .post(`/api/v1/vocab-chat/threads/${sessionId}/messages`)
      .set(headers)
      .send({ content: 'add both, and how do you say it in Spanish?' })
    expect(sent.status).toBe(201)
    expect(sent.body.data.assistantMessage.newThreadSuggestion).toEqual({ language: 'es', message: 'and in Spanish?' })

    const thread = await request(testApp).get(`/api/v1/vocab-chat/threads/${sessionId}`).set(headers)
    const proposal = thread.body.data.messages[1].proposal
    expect(proposal.items.map((i: { added: boolean }) => i.added)).toEqual([true, true])
  })

  test('a moderation block rejects the first message without creating a thread', async () => {
    const { id, token } = await onboardedUser()
    moderationPass.mockResolvedValueOnce({ verdict: 'block', category: 'csam' })

    const response = await request(testApp)
      .post('/api/v1/vocab-chat/threads')
      .set(buildAuthorizationHeaders(token))
      .send({ targetLanguage: 'ru', content: 'blocked content' })

    expect(response.status).toBe(422)
    expect(response.body.data.errors[0].code).toBe('CONTENT_BLOCKED')
    const threads = await sql`
      SELECT 1 FROM public.content_sources WHERE created_by_user_id = ${id} AND type = 'chat'
    `
    expect(threads).toHaveLength(0)
  })
})
