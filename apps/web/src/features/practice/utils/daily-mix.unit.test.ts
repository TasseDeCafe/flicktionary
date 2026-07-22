import { describe, expect, test } from 'vitest'
import { computeMixRecap, orderMixLanguages, plannedTotal, splitMixChain, truncateMixChips } from './daily-mix'
import type { ComposedQueueItem } from '../components/composed-queue-merge'

describe('orderMixLanguages', () => {
  test('most recent first, never-practiced last, ties alphabetical', () => {
    const ordered = orderMixLanguages([
      { targetLanguage: 'de', lastPracticedAt: '2026-07-20T10:00:00Z' },
      { targetLanguage: 'ja', lastPracticedAt: null },
      { targetLanguage: 'ru', lastPracticedAt: '2026-07-21T08:00:00Z' },
      { targetLanguage: 'it', lastPracticedAt: null },
    ])
    expect(ordered.map((e) => e.targetLanguage)).toEqual(['ru', 'de', 'it', 'ja'])
  })
})

describe('plannedTotal', () => {
  test('sums the session-plan buckets', () => {
    expect(plannedTotal({ new: 2, warmup: 3, learning: 1, review: 6 })).toBe(12)
  })
})

describe('truncateMixChips', () => {
  test('short queues pass through', () => {
    expect(truncateMixChips(['a', 'b', 'c'])).toEqual({ visible: ['a', 'b', 'c'], hiddenCount: 0 })
  })
  test('long queues keep the head and fold the tail', () => {
    const { visible, hiddenCount } = truncateMixChips(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 6)
    expect(visible).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(hiddenCount).toBe(3)
  })
})

describe('splitMixChain', () => {
  test('splits around the current language', () => {
    expect(splitMixChain(['ru', 'de', 'en'], 'de')).toEqual({ done: ['ru'], upcoming: ['en'] })
  })
  test('degrades to null when absent from the chain or empty', () => {
    expect(splitMixChain(['ru', 'de'], 'ja')).toBeNull()
    expect(splitMixChain([], 'ru')).toBeNull()
    expect(splitMixChain(undefined, 'ru')).toBeNull()
  })
})

describe('computeMixRecap', () => {
  const flashcard = (requeuedForAgain: boolean): ComposedQueueItem =>
    ({ type: 'flashcard', card: {} as never, retryCount: 0, requeuedForAgain }) as ComposedQueueItem
  const gate = (isNewIntroduction: boolean, origin: 'onboarding' | 'leech'): ComposedQueueItem =>
    ({ type: 'exercise', entry: { origin } as never, isNewIntroduction, bypassDailyCap: false }) as ComposedQueueItem

  test('counts cards once (no redrills), splits gates into new vs warmed up', () => {
    const recap = computeMixRecap({
      ratedItems: [flashcard(false), flashcard(false), flashcard(true)],
      answeredExercises: [gate(true, 'onboarding'), gate(false, 'onboarding'), gate(false, 'leech')],
      claimedIntroductionCount: 1,
    })
    expect(recap).toEqual({ cardsDone: 5, newIntroduced: 1, warmedUp: 1 })
  })

  test('a claimed-then-skipped introduction still counts as introduced', () => {
    // The gate's exercise never got answered (generating/failed placeholder was
    // skipped), but the claim already spent the daily slot server-side.
    const recap = computeMixRecap({
      ratedItems: [flashcard(false)],
      answeredExercises: [],
      claimedIntroductionCount: 2,
    })
    expect(recap).toEqual({ cardsDone: 1, newIntroduced: 2, warmedUp: 0 })
  })
})
