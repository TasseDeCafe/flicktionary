import { describe, expect, it, vi } from 'vitest'
import { planSenseMerges, type SenseRow } from './plan-sense-merges'
import { MockAnthropicPasses } from '../../transport/third-party/anthropic/anthropic-passes'

const row = (id: string, sense: string): SenseRow => ({
  id,
  headword: 'одалживать',
  sense,
  definition: null,
  translation: null,
  targetExample: null,
})

const group = (rows: SenseRow[]) => ({ userId: 'u', targetLanguage: 'ru', rows })

describe('planSenseMerges', () => {
  it('clusters same-meaning rows and leaves distinct senses alone', async () => {
    // borrow (a), lend (b), borrow reworded (c) → c joins a, b stays alone.
    const senseMatchPass = vi
      .fn()
      .mockResolvedValueOnce(null) // b vs [a]
      .mockResolvedValueOnce('a') // c vs [a, b]
    const plan = await planSenseMerges(group([row('a', 'borrow'), row('b', 'lend'), row('c', 'borrow (у + gen)')]), {
      anthropicPasses: MockAnthropicPasses({ senseMatchPass }),
    })

    expect(plan).toEqual([
      {
        userId: 'u',
        targetLanguage: 'ru',
        rows: [
          { id: 'a', headword: 'одалживать', sense: 'borrow' },
          { id: 'c', headword: 'одалживать', sense: 'borrow (у + gen)' },
        ],
      },
    ])
    expect(senseMatchPass.mock.calls[1]![0].existing.map((s: { userLookupId: string }) => s.userLookupId)).toEqual([
      'a',
      'b',
    ])
  })

  it('leaves a row unmerged when the pass fails', async () => {
    const onError = vi.fn()
    const plan = await planSenseMerges(group([row('a', 'sweat'), row('b', 'sweat (noun)')]), {
      anthropicPasses: MockAnthropicPasses({ senseMatchPass: vi.fn().mockRejectedValue(new Error('overloaded')) }),
      onError,
    })

    expect(plan).toEqual([])
    expect(onError).toHaveBeenCalledTimes(1)
  })
})
