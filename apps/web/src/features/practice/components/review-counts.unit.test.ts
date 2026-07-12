import { describe, expect, it } from 'vitest'
import type {
  ReviewTerm,
  StrengthenExerciseEntry,
} from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import type { ComposedQueueItem } from './composed-queue-merge'
import { getRemainingCounts } from './review-counts'

const gate = (over: {
  isNewIntroduction?: boolean
  origin?: 'onboarding' | 'leech'
  userLookupId?: string
}): ComposedQueueItem => ({
  type: 'exercise',
  entry: {
    userLookupId: over.userLookupId ?? 'u1',
    origin: over.origin ?? 'onboarding',
  } as StrengthenExerciseEntry,
  isNewIntroduction: over.isNewIntroduction ?? false,
  bypassDailyCap: false,
})

const flashcard = (srsState: ReviewTerm['srsState'], requeuedForAgain = false): ComposedQueueItem => ({
  type: 'flashcard',
  card: { userLookupId: 'u2', srsState } as ReviewTerm,
  retryCount: 0,
  requeuedForAgain,
})

describe('getRemainingCounts', () => {
  it('splits gates into new (introduced this compose) vs warm-up (backlog) vs learning (rehab)', () => {
    const queue = [
      gate({ isNewIntroduction: true }),
      gate({ isNewIntroduction: false, origin: 'onboarding' }),
      gate({ isNewIntroduction: false, origin: 'leech' }),
    ]
    expect(getRemainingCounts(queue, 0)).toEqual({ new: 1, warmup: 1, learning: 1, review: 0 })
  })

  it('buckets flashcards by srsState, with redrill copies always learning', () => {
    const queue = [
      flashcard(null),
      flashcard('review'),
      flashcard('new'),
      flashcard('learning'),
      flashcard('relearning'),
      flashcard('review', true),
    ]
    expect(getRemainingCounts(queue, 0)).toEqual({ new: 1, warmup: 0, learning: 4, review: 1 })
  })

  it('counts only the not-yet-reached tail', () => {
    const queue = [gate({ isNewIntroduction: true }), flashcard('review')]
    expect(getRemainingCounts(queue, 1)).toEqual({ new: 0, warmup: 0, learning: 0, review: 1 })
  })
})
