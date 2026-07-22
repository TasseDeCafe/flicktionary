import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  PracticeQueueFilter,
  ReviewTerm,
  StrengthenExerciseEntry,
} from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import type { ComposedQueueItem } from './composed-queue-merge'
import type { ExerciseAnswerData } from './strengthen-types'
import {
  clearComposedSession,
  currentDayKey,
  dropTermFromComposedSession,
  saveComposedSession,
  takeComposedSession,
  type ComposedSessionSnapshot,
} from './composed-session-snapshot'

const filter = (over: Partial<PracticeQueueFilter> = {}): PracticeQueueFilter => ({
  pools: ['production', 'recognition'],
  scope: 'both',
  render: 'both',
  autoWarmup: true,
  includeOptInNew: false,
  ...over,
})

const cardItem = (userLookupId: string): ComposedQueueItem => ({
  type: 'flashcard',
  card: { userLookupId } as ReviewTerm,
  retryCount: 0,
  requeuedForAgain: false,
})

const exerciseItem = (userLookupId: string): ComposedQueueItem => ({
  type: 'exercise',
  entry: { userLookupId } as StrengthenExerciseEntry,
  isNewIntroduction: false,
  bypassDailyCap: false,
})

const snapshot = (over: Partial<ComposedSessionSnapshot> = {}): ComposedSessionSnapshot => ({
  targetLanguage: 'en',
  filter: filter(),
  queue: [cardItem('u1'), exerciseItem('u2')],
  index: 0,
  dailyLimitReached: false,
  canLearnExtra: false,
  capNoticeShown: false,
  sessionHard: new Set(),
  ratingRecords: new Map(),
  exerciseOutcomes: new Map(),
  claimedIntroductions: new Set(),
  dayKey: currentDayKey(),
  ...over,
})

afterEach(() => {
  clearComposedSession()
  vi.useRealTimers()
})

describe('takeComposedSession', () => {
  it('resumes a matching same-day snapshot exactly once', () => {
    const saved = snapshot()
    saveComposedSession(saved)
    expect(takeComposedSession('en', filter())).toBe(saved)
    // Consumed on read — a second entry composes fresh.
    expect(takeComposedSession('en', filter())).toBeNull()
  })

  it('treats pools as an unordered set when matching the filter', () => {
    saveComposedSession(snapshot({ filter: filter({ pools: ['recognition', 'production'] }) }))
    expect(takeComposedSession('en', filter({ pools: ['production', 'recognition'] }))).not.toBeNull()
  })

  it('discards a snapshot for another language or filter', () => {
    saveComposedSession(snapshot())
    expect(takeComposedSession('de', filter())).toBeNull()
    // Discarded, not kept for a later matching entry.
    expect(takeComposedSession('en', filter())).toBeNull()

    saveComposedSession(snapshot())
    expect(takeComposedSession('en', filter({ scope: 'due_only' }))).toBeNull()
  })

  it('never resumes across a day boundary', () => {
    saveComposedSession(snapshot())
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.now() + 24 * 60 * 60 * 1000))
    expect(takeComposedSession('en', filter())).toBeNull()
  })
})

describe('dropTermFromComposedSession', () => {
  it('removes the deleted term at and after the live index, plus its bookkeeping', () => {
    const consumed = cardItem('victim')
    const liveCard = cardItem('victim')
    const liveExercise = exerciseItem('victim')
    const other = cardItem('other')
    const ratingRecords = new Map([[consumed, { rating: 'good' as const, eventId: 'e1', redrill: null }]])
    const exerciseOutcomes = new Map([[liveExercise, { correct: true } as ExerciseAnswerData]])
    saveComposedSession(
      snapshot({
        queue: [consumed, liveCard, other, liveExercise],
        index: 1,
        sessionHard: new Set(['victim', 'other']),
        ratingRecords,
        exerciseOutcomes,
      })
    )

    dropTermFromComposedSession('victim')

    const resumed = takeComposedSession('en', filter())
    // The consumed copy stays (removing it would shift the live index onto
    // the wrong card); everything at/after the index is gone.
    expect(resumed?.queue).toEqual([consumed, other])
    expect(resumed?.index).toBe(1)
    expect(resumed?.sessionHard.has('victim')).toBe(false)
    expect(resumed?.sessionHard.has('other')).toBe(true)
    expect(resumed?.ratingRecords.has(consumed)).toBe(true)
    expect(resumed?.exerciseOutcomes.has(liveExercise)).toBe(false)
  })

  it('is a no-op when nothing is stashed or the term is absent', () => {
    dropTermFromComposedSession('victim')
    const saved = snapshot({ queue: [cardItem('other')] })
    saveComposedSession(saved)
    dropTermFromComposedSession('victim')
    expect(takeComposedSession('en', filter())?.queue).toEqual([cardItem('other')])
  })
})
