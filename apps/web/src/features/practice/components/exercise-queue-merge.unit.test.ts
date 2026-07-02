import { describe, expect, it } from 'vitest'
import type { StrengthenExerciseEntry } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { mergePlaceholders } from './exercise-queue-merge'

const entry = (over: Partial<StrengthenExerciseEntry>): StrengthenExerciseEntry => ({
  exerciseId: null,
  userLookupId: 'u1',
  pool: 'recognition',
  headword: 'w',
  sense: '',
  translation: null,
  definition: null,
  track: 'gate',
  status: 'generating',
  origin: 'onboarding',
  exerciseType: null,
  payload: null,
  ...over,
})

describe('mergePlaceholders', () => {
  it('does not let a refreshed recognition exercise overwrite the production placeholder of the SAME term', () => {
    // A both-skills term: two placeholders sharing one userLookupId.
    const prev = [
      entry({ pool: 'recognition', status: 'generating' }),
      entry({ pool: 'production', status: 'generating' }),
    ]
    // Only the recognition exercise is ready so far.
    const fresh = [entry({ pool: 'recognition', status: 'ready', exerciseId: 'e-rec', exerciseType: 'mc_cloze' })]
    const next = mergePlaceholders(prev, fresh, 0)
    expect(next[0]).toMatchObject({ pool: 'recognition', status: 'ready', exerciseId: 'e-rec' })
    // The production placeholder is untouched — keyed by (pool, userLookupId).
    expect(next[1]).toMatchObject({ pool: 'production', status: 'generating' })
  })

  it('swaps each pool placeholder independently when both refresh', () => {
    const prev = [entry({ pool: 'recognition' }), entry({ pool: 'production' })]
    const fresh = [
      entry({ pool: 'recognition', status: 'ready', exerciseId: 'e-rec' }),
      entry({ pool: 'production', status: 'failed' }),
    ]
    const next = mergePlaceholders(prev, fresh, 0)
    expect(next[0]).toMatchObject({ pool: 'recognition', status: 'ready' })
    expect(next[1]).toMatchObject({ pool: 'production', status: 'failed' })
  })

  it('leaves already-passed entries (before fromIndex) untouched and returns the same ref when nothing changed', () => {
    const prev = [entry({ status: 'ready', exerciseId: 'done' }), entry({ status: 'generating' })]
    // fromIndex past the only generating slot → no change, same reference.
    const same = mergePlaceholders(prev, [entry({ status: 'ready' })], 2)
    expect(same).toBe(prev)
  })
})
