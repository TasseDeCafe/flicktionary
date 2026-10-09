import { describe, expect, test, vi } from 'vitest'
import type { KeptSenseWithCard } from '../../transport/database/user-lookups/user-lookups-repository'
import { matchCaptureCandidates, testedSkillFor, type CaptureContext } from './match-capture-candidates'

const thereIs: KeptSenseWithCard = {
  id: '00000000-0000-0000-0000-000000000001',
  headword: 'есть',
  sense: 'there is',
  definition: null,
  translation: 'there is, to have',
  cardId: '00000000-0000-0000-0000-0000000000c1',
  sessionId: '00000000-0000-0000-0000-0000000000s1',
}
const status = { notStarted: true, facets: [], demand: null }

const eat = { headword: 'есть', note: 'to eat (impf)', example: 'Я хочу есть.' }
const sleep = { headword: 'спать', note: 'to sleep', example: 'Я сплю.' }
const search = (inputLanguage: string | null): CaptureContext => ({ kind: 'search', text: 'to eat', inputLanguage })

const run = (
  senseMatchPass: ReturnType<typeof vi.fn>,
  options: {
    context?: CaptureContext
    candidates?: Array<{ headword: string; note: string; example: string; userLookupId?: string }>
    knownCards?: Map<string, { cardId: string; sessionId: string }>
    cache?: Map<string, string | null>
  } = {}
) =>
  matchCaptureCandidates(
    {
      userId: 'u',
      targetLanguage: 'ru',
      context: options.context ?? search('en'),
      candidates: options.candidates ?? [eat, sleep],
    },
    {
      anthropicPasses: { senseMatchPass: senseMatchPass as never },
      userLookupsRepository: {
        listKeptSensesByHeadwords: vi.fn().mockResolvedValue(new Map([['есть', [thereIs]]])),
        listKeptTermCards: vi.fn().mockResolvedValue(options.knownCards ?? new Map()),
      },
      captureDemandRepository: {
        listCaptureStatus: vi.fn().mockResolvedValue(new Map([[thereIs.id, status]])),
      },
      senseMatchCache: options.cache && {
        get: (key) => options.cache!.get(key),
        set: (key, matchedId) => void options.cache!.set(key, matchedId),
      },
    }
  )

describe('matchCaptureCandidates', () => {
  test('a same-meaning match points at that term, with its status', async () => {
    const matches = await run(vi.fn().mockResolvedValue(thereIs.id))
    expect(matches).toEqual([
      {
        testedSkill: 'meaning_production',
        existingCard: { userLookupId: thereIs.id, cardId: thereIs.cardId, sessionId: thereIs.sessionId },
        otherSenses: [],
        status,
      },
      { testedSkill: 'meaning_production', existingCard: null, otherSenses: [], status: null },
    ])
  })

  test('another meaning of the headword keeps Add and names the saved one', async () => {
    const matches = await run(vi.fn().mockResolvedValue(null))
    expect(matches[0]).toMatchObject({ existingCard: null, otherSenses: ['there is'], status: null })
  })

  test('a pass error is treated as a new meaning', async () => {
    const matches = await run(vi.fn().mockRejectedValue(new Error('boom')))
    expect(matches[0]).toMatchObject({ existingCard: null, otherSenses: ['there is'] })
  })

  test('only headword hits run the pass, with a native-language query as the meaning', async () => {
    const senseMatchPass = vi.fn().mockResolvedValue(null)
    await run(senseMatchPass)
    expect(senseMatchPass).toHaveBeenCalledTimes(1)
    expect(senseMatchPass).toHaveBeenCalledWith(
      expect.objectContaining({
        headword: 'есть',
        candidate: { sense: 'to eat (impf)', definition: null, translation: 'to eat', sentence: 'Я хочу есть.' },
      })
    )
  })

  test('a target-language query or a chat proposal passes no meaning', async () => {
    for (const context of [search('ru'), { kind: 'chat' as const, userMessage: 'how do I say to eat?' }]) {
      const senseMatchPass = vi.fn().mockResolvedValue(null)
      await run(senseMatchPass, { context })
      expect(senseMatchPass.mock.calls[0]![0].candidate.translation).toBeNull()
    }
  })

  test('a candidate known to be a term skips the match, whatever its headword', async () => {
    const senseMatchPass = vi.fn()
    const known = '00000000-0000-0000-0000-000000000099'
    const matches = await run(senseMatchPass, {
      candidates: [{ ...sleep, userLookupId: known }],
      knownCards: new Map([[known, { cardId: thereIs.cardId, sessionId: thereIs.sessionId }]]),
    })
    expect(senseMatchPass).not.toHaveBeenCalled()
    expect(matches[0]!.existingCard).toEqual({
      userLookupId: known,
      cardId: thereIs.cardId,
      sessionId: thereIs.sessionId,
    })
  })

  test('a known term that is gone falls back to the sense match', async () => {
    const senseMatchPass = vi.fn().mockResolvedValue(thereIs.id)
    const matches = await run(senseMatchPass, {
      candidates: [{ ...eat, userLookupId: '00000000-0000-0000-0000-000000000099' }],
    })
    expect(senseMatchPass).toHaveBeenCalledTimes(1)
    expect(matches[0]!.existingCard?.userLookupId).toBe(thereIs.id)
  })

  test('cached answers spare the pass, including "new"', async () => {
    const cache = new Map<string, string | null>()
    await run(vi.fn().mockResolvedValue(null), { cache })
    const senseMatchPass = vi.fn()
    const matches = await run(senseMatchPass, { cache })
    expect(senseMatchPass).not.toHaveBeenCalled()
    expect(matches[0]).toMatchObject({ existingCard: null, otherSenses: ['there is'] })
  })
})

describe('testedSkillFor', () => {
  test('a search tests production for a native-language query, recognition otherwise', () => {
    expect(testedSkillFor(search('en'), 'ru', 'есть')).toBe('meaning_production')
    expect(testedSkillFor(search(null), 'ru', 'есть')).toBe('meaning_production')
    expect(testedSkillFor(search('ru'), 'ru', 'есть')).toBe('meaning_recognition')
  })

  test('a chat proposal tests recognition when the message contains the headword', () => {
    const chat = (userMessage: string): CaptureContext => ({ kind: 'chat', userMessage })
    expect(testedSkillFor(chat('what does Жда́ть mean?'), 'ru', 'ждать')).toBe('meaning_recognition')
    expect(testedSkillFor(chat('how do I say "to wait"?'), 'ru', 'ждать')).toBe('meaning_production')
    expect(testedSkillFor(chat('kitchen words please'), 'ru', 'нож')).toBe('meaning_production')
  })
})
