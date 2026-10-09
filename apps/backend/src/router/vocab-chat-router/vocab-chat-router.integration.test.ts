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
  const translateForCapturePass = vi.fn().mockResolvedValue({
    inputLanguage: 'en',
    candidates: [{ headword: 'засыпать', note: 'to fall asleep', example: 'Я быстро засыпаю.' }],
  })
  const vocabChatTitlePass = vi.fn().mockResolvedValue('Falling asleep')
  const senseMatchPass = vi.fn()
  // The ad-hoc card behind "added from the search before escalating"; the
  // highlight/segment ids are re-pointed to the synthetic highlight.
  const basicDataPass = vi.fn().mockResolvedValue([
    {
      source: 'highlight',
      headword: 'нюхать',
      sense: 'to sniff',
      surfaceForm: 'нюхать',
      segmentId: 'rebound-to-the-real-segment',
      translation: 'to sniff',
      surfaceTranslation: null,
      definition: 'втягивать носом воздух',
      targetExample: 'Собака нюхает траву.',
      nativeExample: 'The dog sniffs the grass.',
      grammar: { pos: 'verb' },
      belowCefr: false,
      zipf: 4.1,
    },
  ])
  const passes = MockAnthropicPasses({
    basicDataPass: basicDataPass as never,
    createChatCompletion: createChatCompletion as never,
    moderationPass: moderationPass as never,
    translateForCapturePass: translateForCapturePass as never,
    vocabChatTitlePass: vocabChatTitlePass as never,
    senseMatchPass: senseMatchPass as never,
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

    // Not in the learner's vocabulary yet: no match, and no headword hit to
    // run the sense pass on.
    senseMatchPass.mockClear()
    const matched = await request(testApp)
      .post('/api/v1/vocab-chat/capture-matches')
      .set(headers)
      .send({
        targetLanguage: 'ru',
        context: { kind: 'search', text: 'to fall asleep', inputLanguage: 'en' },
        candidates: translated.body.data.candidates,
      })
    expect(matched.status).toBe(200)
    expect(matched.body.data.matches).toEqual([
      { testedSkill: 'meaning_production', existingCard: null, otherSenses: [], status: null },
    ])
    expect(senseMatchPass).not.toHaveBeenCalled()

    createChatCompletion.mockResolvedValueOnce(proposeTurn).mockResolvedValueOnce(replyTurn)
    const started = await request(testApp)
      .post('/api/v1/vocab-chat/threads')
      .set(headers)
      .send({ targetLanguage: 'ru', content: 'How do I say "to fall asleep"?' })
    expect(started.status).toBe(201)
    // Each tool round caches the conversation for the next round to read.
    expect(createChatCompletion.mock.calls.slice(-2).map(([params]) => params.cache_control)).toEqual([
      { type: 'ephemeral' },
      { type: 'ephemeral' },
    ])
    const { sessionId, title, messages } = started.body.data
    expect(messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant'])
    const assistantMessage = messages[1]
    expect(title).toBe('Falling asleep')
    expect(assistantMessage.content).toBe(replyTurn.content[0].text)
    // Stress marks are stripped from proposed headwords (stored headwords
    // never carry them).
    expect(assistantMessage.proposal.items.map((i: { headword: string }) => i.headword)).toEqual([
      'засыпать',
      'заснуть',
    ])
    expect(assistantMessage.proposal.items.every((i: { addState: string | null }) => i.addState === null)).toBe(true)

    const added = await request(testApp)
      .post(`/api/v1/vocab-chat/threads/${sessionId}/messages/${assistantMessage.id}/add`)
      .set(headers)
      .send({ itemIndexes: [1] })
    expect(added.status).toBe(200)
    // The card comes from background enrichment: pending until the job runs.
    expect(added.body.data.message.proposal.items.map((i: { addState: string | null }) => i.addState)).toEqual([
      null,
      'pending',
    ])

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
    const { sessionId } = started.body.data
    const assistantMessage = started.body.data.messages[1]

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
    expect(proposal.items.map((i: { addState: string | null }) => i.addState)).toEqual(['pending', 'pending'])
  })

  describe('capture matches', () => {
    const sniff = { headword: 'нюхать', note: 'to smell (give off a smell)', example: 'Цветы нюхают.' }
    const matchesFor = (token: string) =>
      request(testApp)
        .post('/api/v1/vocab-chat/capture-matches')
        .set(buildAuthorizationHeaders(token))
        .send({
          targetLanguage: 'ru',
          context: { kind: 'search', text: 'to smell', inputLanguage: 'en' },
          candidates: [sniff],
        })
    // Saves нюхать = "to sniff" (basicDataPass above).
    const addSniff = async (token: string) => {
      const adhoc = await request(testApp)
        .post('/api/v1/cards/adhoc')
        .set(buildAuthorizationHeaders(token))
        .send({ targetLanguage: 'ru', headword: 'нюхать', context: null })
      expect(adhoc.status).toBe(200)
      return adhoc.body.data as { cardId: string; sessionId: string }
    }

    test('returns 401 when unauthenticated', async () => {
      const response = await matchesFor('wrong-token')
      expect(response.status).toBe(401)
    })

    test('a saved homograph with another meaning keeps Add and names the saved meaning', async () => {
      const { token } = await onboardedUser()
      await addSniff(token)
      senseMatchPass.mockResolvedValueOnce(null)

      const response = await matchesFor(token)
      expect(response.status).toBe(200)
      expect(response.body.data.matches).toEqual([
        { testedSkill: 'meaning_production', existingCard: null, otherSenses: ['to sniff'], status: null },
      ])
      expect(senseMatchPass).toHaveBeenLastCalledWith(
        expect.objectContaining({
          headword: 'нюхать',
          candidate: expect.objectContaining({ sense: sniff.note, translation: 'to smell' }),
          existing: [expect.objectContaining({ sense: 'to sniff' })],
        })
      )
    })

    test('the same meaning points at the saved card, with its status', async () => {
      const { token } = await onboardedUser()
      const { cardId, sessionId } = await addSniff(token)
      senseMatchPass.mockImplementationOnce(async ({ existing }) => existing[0].userLookupId)

      const response = await matchesFor(token)
      expect(response.status).toBe(200)
      expect(response.body.data.matches).toEqual([
        {
          // An English query tests coming up with the Russian word.
          testedSkill: 'meaning_production',
          existingCard: { userLookupId: expect.any(String), cardId, sessionId },
          otherSenses: [],
          status: {
            notStarted: true,
            facets: [expect.objectContaining({ skill: 'meaning_recognition', srsState: null, enabled: true })],
            demand: null,
          },
        },
      ])
    })

    test('capture demand moves a not-started term up, visibly, and undoes', async () => {
      const { token } = await onboardedUser()
      await addSniff(token)
      senseMatchPass.mockImplementation(async ({ existing }) => existing[0].userLookupId)
      const userLookupId = (await matchesFor(token)).body.data.matches[0].existingCard.userLookupId
      // Saved just now: step its demand clock out of the one-hour collapse window.
      await sql`UPDATE public.user_lookups SET last_demand_at = NOW() - INTERVAL '2 hours' WHERE id = ${userLookupId}`
      const demand = (path: string, body: object) =>
        request(testApp).post(`/api/v1/vocab-chat/${path}`).set(buildAuthorizationHeaders(token)).send(body)

      const recorded = await demand('capture-demand', { userLookupId, source: 'search' })
      expect(recorded.status).toBe(200)
      expect(recorded.body.data).toEqual({ outcome: 'counted' })
      expect((await matchesFor(token)).body.data.matches[0].status.demand).toEqual({
        counted: true,
        reverted: false,
        undoable: true,
      })

      expect((await demand('capture-demand/undo', { userLookupId })).body.data).toEqual({ reverted: true })
      expect((await matchesFor(token)).body.data.matches[0].status.demand.reverted).toBe(true)
      senseMatchPass.mockReset()
    })

    test("capture demand returns 401 when unauthenticated, and ignores another user's term", async () => {
      const unauthenticated = await request(testApp)
        .post('/api/v1/vocab-chat/capture-demand')
        .set({ Authorization: 'Bearer wrong-token' })
        .send({ userLookupId: '00000000-0000-0000-0000-000000000000', source: 'search' })
      expect(unauthenticated.status).toBe(401)

      const { token: owner } = await onboardedUser()
      await addSniff(owner)
      senseMatchPass.mockImplementationOnce(async ({ existing }) => existing[0].userLookupId)
      const userLookupId = (await matchesFor(owner)).body.data.matches[0].existingCard.userLookupId
      const { token: other } = await onboardedUser()
      const response = await request(testApp)
        .post('/api/v1/vocab-chat/capture-demand')
        .set(buildAuthorizationHeaders(other))
        .send({ userLookupId, source: 'search' })
      expect(response.body.data).toEqual({ outcome: 'not_eligible' })
    })

    test('an unkept term is not in the vocabulary', async () => {
      const { token } = await onboardedUser()
      const { cardId } = await addSniff(token)
      const removed = await request(testApp)
        .patch(`/api/v1/cards/${cardId}/remove-from-session`)
        .set(buildAuthorizationHeaders(token))
        .send({})
      expect(removed.status).toBe(200)
      senseMatchPass.mockClear()

      const response = await matchesFor(token)
      expect(response.body.data.matches).toEqual([
        { testedSkill: 'meaning_production', existingCard: null, otherSenses: [], status: null },
      ])
      expect(senseMatchPass).not.toHaveBeenCalled()
    })
  })

  test('a failed add can be retried, and a gone one is offered again and re-adds', async () => {
    const { token } = await onboardedUser()
    const headers = buildAuthorizationHeaders(token)
    createChatCompletion.mockResolvedValueOnce(proposeTurn).mockResolvedValueOnce(replyTurn)
    const started = await request(testApp)
      .post('/api/v1/vocab-chat/threads')
      .set(headers)
      .send({ targetLanguage: 'ru', content: 'to fall asleep?' })
    const { sessionId } = started.body.data
    const messageId = started.body.data.messages[1].id
    const add = () =>
      request(testApp)
        .post(`/api/v1/vocab-chat/threads/${sessionId}/messages/${messageId}/add`)
        .set(headers)
        .send({ itemIndexes: [0] })
    const itemState = async () =>
      (await request(testApp).get(`/api/v1/vocab-chat/threads/${sessionId}`).set(headers)).body.data.messages[1]
        .proposal.items[0]
    const jobCount = async () =>
      (
        await sql`
          SELECT COUNT(*)::int AS count FROM public.processing_jobs
          WHERE study_session_id = ${sessionId} AND kind = 'enrich_highlight'
        `
      )[0]!.count

    await add()
    await sql`UPDATE public.processing_jobs SET status = 'failed' WHERE study_session_id = ${sessionId}`
    expect((await itemState()).addState).toBe('failed')
    // A failed item isn't re-added (its job is retried instead).
    await add()
    expect(await jobCount()).toBe(1)

    // The job finished without a live term (deleted or unkept since): Add again.
    await sql`UPDATE public.processing_jobs SET status = 'done' WHERE study_session_id = ${sessionId}`
    expect((await itemState()).addState).toBeNull()
    const readded = await add()
    expect(readded.body.data.message.proposal.items[0].addState).toBe('pending')
    expect(await jobCount()).toBe(2)
  })

  test('a chat proposal tests recognition when the message names the word', async () => {
    const { token } = await onboardedUser()
    const response = await request(testApp)
      .post('/api/v1/vocab-chat/capture-matches')
      .set(buildAuthorizationHeaders(token))
      .send({
        targetLanguage: 'ru',
        context: { kind: 'chat', userMessage: 'what does засыпать mean?' },
        candidates: [
          { headword: 'засыпать', note: 'to fall asleep', example: '' },
          { headword: 'заснуть', note: 'to fall asleep (pf)', example: '' },
        ],
      })
    expect(response.status).toBe(200)
    expect(response.body.data.matches.map((m: { testedSkill: string }) => m.testedSkill)).toEqual([
      'meaning_recognition',
      'meaning_production',
    ])
  })

  test('translate forwards the learner context to the pass', async () => {
    const { token } = await onboardedUser()
    const response = await request(testApp)
      .post('/api/v1/vocab-chat/translate')
      .set(buildAuthorizationHeaders(token))
      .send({ text: 'to smell', targetLanguage: 'ru', context: "he doesn't smell good" })

    expect(response.status).toBe(200)
    expect(translateForCapturePass).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: 'to smell', context: "he doesn't smell good" })
    )
  })

  test('a seeded start opens the thread with the search, whose items the model can add', async () => {
    const { id, token } = await onboardedUser()
    const headers = buildAuthorizationHeaders(token)
    // One candidate is added from the search before escalating: it lands in
    // the ad-hoc session and shows as already in the vocabulary.
    const adhoc = await request(testApp)
      .post('/api/v1/cards/adhoc')
      .set(headers)
      .send({ targetLanguage: 'ru', headword: 'нюхать', context: null })
    expect(adhoc.status).toBe(200)

    // The tool loop appends to the messages array after the call, so the
    // history the model saw is captured here.
    let seenHistory: Array<{ role: string; content: unknown }> = []
    createChatCompletion.mockImplementationOnce(
      async (params: { messages: Array<{ role: string; content: unknown }> }) => {
        seenHistory = [...params.messages]
        const seedTurn = params.messages[1]!.content as string
        const proposalId = /proposal_id=([0-9a-f-]+)/.exec(seedTurn)![1]
        return {
          content: [
            {
              type: 'tool_use',
              id: 'tu_add',
              name: 'add_proposed_cards',
              input: { proposal_id: proposalId, item_indexes: [0] },
            },
          ],
        }
      }
    )
    createChatCompletion.mockResolvedValueOnce({ content: [{ type: 'text', text: 'Added пахнуть.' }] })
    const started = await request(testApp)
      .post('/api/v1/vocab-chat/threads')
      .set(headers)
      .send({
        targetLanguage: 'ru',
        content: 'which one for a smelly dog? add it',
        seed: {
          userMessage: 'to smell',
          items: [
            { headword: 'пахнуть', note: 'to give off a smell', example: 'Здесь пахнет кофе.' },
            { headword: 'нюхать', note: 'to sniff', example: 'Собака нюхает траву.' },
          ],
        },
      })
    expect(started.status).toBe(201)
    // The model saw the search as the opening exchange.
    expect(seenHistory.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(seenHistory[0]!.content).toBe('to smell')
    expect(vocabChatTitlePass).toHaveBeenLastCalledWith(
      expect.objectContaining({ firstUserMessage: 'to smell\n\nwhich one for a smelly dog? add it' })
    )

    // The response carries the whole thread, as the thread read does.
    const { sessionId, messages } = started.body.data
    const thread = await request(testApp).get(`/api/v1/vocab-chat/threads/${sessionId}`).set(headers)
    expect(thread.body.data.messages).toEqual(messages)
    expect(messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(messages[0].content).toBe('to smell')
    expect(messages[1].proposal.items).toEqual([
      {
        headword: 'пахнуть',
        note: 'to give off a smell',
        example: 'Здесь пахнет кофе.',
        highlightId: expect.any(String),
        addState: 'pending',
        addedCard: null,
      },
      {
        headword: 'нюхать',
        note: 'to sniff',
        example: 'Собака нюхает траву.',
        highlightId: null,
        addState: null,
        addedCard: null,
      },
    ])
    const jobs = await sql`
      SELECT h.selection_text
      FROM public.processing_jobs j
      JOIN public.highlights h ON h.id = j.highlight_id
      WHERE j.study_session_id = ${sessionId} AND j.user_id = ${id}
    `
    expect(jobs).toEqual([{ selection_text: 'пахнуть' }])
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
