import { describe, expect, test, vi } from 'vitest'
import type { KeptSenseWithCard } from '../../transport/database/user-lookups/user-lookups-repository'
import { matchCaptureCandidates } from './match-capture-candidates'

const thereIs: KeptSenseWithCard = {
  id: '00000000-0000-0000-0000-000000000001',
  headword: 'есть',
  sense: 'there is',
  definition: null,
  translation: 'there is, to have',
  cardId: '00000000-0000-0000-0000-0000000000c1',
  sessionId: '00000000-0000-0000-0000-0000000000s1',
}

const eat = { headword: 'есть', note: 'to eat (impf)', example: 'Я хочу есть.' }
const sleep = { headword: 'спать', note: 'to sleep', example: 'Я сплю.' }

const run = (senseMatchPass: ReturnType<typeof vi.fn>, inputLanguage: string | null = 'en') =>
  matchCaptureCandidates(
    { userId: 'u', targetLanguage: 'ru', query: 'to eat', inputLanguage, candidates: [eat, sleep] },
    {
      anthropicPasses: { senseMatchPass: senseMatchPass as never },
      userLookupsRepository: {
        listKeptSensesByHeadwords: vi.fn().mockResolvedValue(new Map([['есть', [thereIs]]])),
      },
    }
  )

describe('matchCaptureCandidates', () => {
  test('a same-meaning match points at that term', async () => {
    const matches = await run(vi.fn().mockResolvedValue(thereIs.id))
    expect(matches).toEqual([
      {
        existingCard: { userLookupId: thereIs.id, cardId: thereIs.cardId, sessionId: thereIs.sessionId },
        otherSenses: [],
      },
      { existingCard: null, otherSenses: [] },
    ])
  })

  test('another meaning of the headword keeps Add and names the saved one', async () => {
    const matches = await run(vi.fn().mockResolvedValue(null))
    expect(matches[0]).toEqual({ existingCard: null, otherSenses: ['there is'] })
  })

  test('a pass error is treated as a new meaning', async () => {
    const matches = await run(vi.fn().mockRejectedValue(new Error('boom')))
    expect(matches[0]).toEqual({ existingCard: null, otherSenses: ['there is'] })
  })

  test('only headword hits run the pass, with the native-language query as the meaning', async () => {
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

  test('a target-language query is not passed as a meaning', async () => {
    const senseMatchPass = vi.fn().mockResolvedValue(null)
    await run(senseMatchPass, 'ru')
    expect(senseMatchPass.mock.calls[0]![0].candidate.translation).toBeNull()
  })
})
