import { describe, expect, it } from 'vitest'
import type {
  PracticeQueueFilter,
  ReviewTerm,
  StrengthenExerciseEntry,
} from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import type { ComposedQueueItem } from './composed-queue-merge'
import type { ComposedSessionSnapshot } from './composed-session-snapshot'
import {
  canRerate,
  clueCapped,
  composedSessionReducer as reduce,
  initialSessionState,
  introductionBlocked,
  introductionClaimFailed,
  MAX_RATE_RETRIES,
  sessionToSnapshot,
  type ComposedSessionAction,
  type ComposedSessionState,
} from './composed-session-reducer'
import type { ExerciseAnswerData } from './strengthen-types'

const FILTER: PracticeQueueFilter = {
  pools: ['production', 'recognition'],
  scope: 'both',
  render: 'both',
  autoWarmup: true,
  includeOptInNew: false,
}

const card = (id: string): ComposedQueueItem => ({
  type: 'flashcard',
  card: { userLookupId: id, headword: id, skill: 'meaning_recognition', targetForm: '' } as ReviewTerm,
  retryCount: 0,
  requeuedForAgain: false,
})

const intro = (id: string): ComposedQueueItem => ({
  type: 'exercise',
  entry: { userLookupId: id, pool: 'recognition', status: 'ready' } as StrengthenExerciseEntry,
  isNewIntroduction: true,
  bypassDailyCap: false,
})

const redrillOf = (item: ComposedQueueItem): ComposedQueueItem =>
  item.type === 'flashcard' ? { ...item, requeuedForAgain: true } : item

const withQueue = (queue: ComposedQueueItem[], over: Partial<ComposedSessionState> = {}): ComposedSessionState => ({
  ...initialSessionState(null, FILTER),
  queue,
  ...over,
})

const run = (state: ComposedSessionState, ...actions: ComposedSessionAction[]) => actions.reduce(reduce, state)

const ok = (eventId: string | null, over = {}) => ({ dailyCapReached: false, parked: false, eventId, ...over })

describe('rating', () => {
  it('advances, appends the redrill, counts the pending rating and the hard term in one action', () => {
    const [a, b] = [card('a'), card('b')]
    const redrill = redrillOf(a)
    const next = reduce(withQueue([a, b], { revealed: true }), {
      type: 'rateRequested',
      item: a,
      rating: 'again',
      redrill,
    })
    expect(next.queue).toEqual([a, b, redrill])
    expect(next.index).toBe(1)
    expect(next.revealed).toBe(false)
    expect(next.pendingRatings).toBe(1)
    expect(next.sessionHard.has('a')).toBe(true)
  })

  it('drops a pending redrill on a cap refusal, keeps one the session already rated past', () => {
    const [a, b] = [card('a'), card('b')]
    const redrill = redrillOf(a)
    const requested = reduce(withQueue([a, b]), { type: 'rateRequested', item: a, rating: 'again', redrill })
    const refused = {
      type: 'rateSucceeded',
      item: a,
      rating: 'again',
      redrill,
      result: ok(null, { dailyCapReached: true }),
    } as const
    expect(reduce(requested, refused).queue).toEqual([a, b])
    expect(reduce(requested, refused).capNoticeShown).toBe(true)

    // Walk past the redrill (index 3 > its position 2) before the refusal lands.
    const walked = { ...requested, index: 3 }
    expect(reduce(walked, refused).queue).toEqual([a, b, redrill])
  })

  it('records an applied rating with its redrill; parking drops the redrill but keeps the record', () => {
    const a = card('a')
    const redrill = redrillOf(a)
    const requested = reduce(withQueue([a, card('b')]), { type: 'rateRequested', item: a, rating: 'again', redrill })
    const parked = reduce(requested, {
      type: 'rateSucceeded',
      item: a,
      rating: 'again',
      redrill,
      result: ok('ev', { parked: true }),
    })
    expect(parked.queue).toHaveLength(2)
    expect(parked.ratingRecords.get(a)).toEqual({ rating: 'again', eventId: 'ev', redrill })
  })

  it('appends retry copies up to MAX_RATE_RETRIES, carrying the clue cap and the redrill flag', () => {
    let item = { ...card('a'), requeuedForAgain: true }
    let state = withQueue([item], { clueUsed: new Set([item]) })
    for (let attempt = 0; attempt < MAX_RATE_RETRIES; attempt++) {
      state = reduce(state, { type: 'rateFailed', item, redrill: null })
      const retry = state.queue!.at(-1)!
      expect(retry).toMatchObject({ retryCount: attempt + 1, requeuedForAgain: true })
      expect(state.clueUsed.has(retry)).toBe(true)
      item = retry as typeof item
    }
    const capped = reduce(state, { type: 'rateFailed', item, redrill: null })
    expect(capped.queue).toHaveLength(state.queue!.length)
  })

  it('caps a production card the same way, through to its failed-rating retry', () => {
    const production: ComposedQueueItem = {
      type: 'flashcard',
      card: { userLookupId: 'p', headword: 'p', skill: 'meaning_production', targetForm: '' } as ReviewTerm,
      retryCount: 0,
      requeuedForAgain: false,
    }
    const shown = run(withQueue([production]), { type: 'clueShown' })
    expect(clueCapped(shown)).toBe(true)
    const failed = reduce(shown, { type: 'rateFailed', item: production, redrill: null })
    expect(failed.clueUsed.has(failed.queue!.at(-1)!)).toBe(true)
  })

  it('never carries the clue cap to an Again redrill', () => {
    const a = card('a')
    const redrill = redrillOf(a)
    const state = run(
      withQueue([a]),
      { type: 'clueShown' },
      { type: 'rateRequested', item: a, rating: 'again', redrill }
    )
    expect(state.clueUsed.has(a)).toBe(true)
    expect(clueCapped(state)).toBe(false) // the live item is the redrill
  })

  it('reports completion once, on the advance that crosses the end', () => {
    const a = card('a')
    const done = reduce(withQueue([a], { sessionHard: new Set(['x']) }), { type: 'advanced' })
    expect(done.completion).toEqual({ totalCount: 1, hardCount: 1 })
    const extended = { ...done, queue: [a, card('retry')] }
    expect(reduce(extended, { type: 'advanced' }).completion).toBe(done.completion)
  })
})

describe('re-rate', () => {
  const ratedState = (rating: 'again' | 'good') => {
    const [a, b] = [card('a'), card('b')]
    const redrill = rating === 'again' ? redrillOf(a) : null
    const state = run(
      withQueue([a, b]),
      { type: 'rateRequested', item: a, rating, redrill },
      { type: 'rateSucceeded', item: a, rating, redrill, result: ok('ev-1') },
      { type: 'peekedOlder' }
    )
    return { a, redrill, state, previous: state.ratingRecords.get(a)! }
  }

  it('offers the re-rate only while the redrill copy is unrated', () => {
    const { redrill, state } = ratedState('again')
    expect(canRerate(state)).toBe(true)
    const redrillRated = {
      ...state,
      ratingRecords: new Map(state.ratingRecords).set(redrill!, state.ratingRecords.get(state.queue![0])!),
    }
    expect(canRerate(redrillRated)).toBe(false)
  })

  it('unapplied: drops the record, requeues a fresh copy with the clue cap, raises the cap notice on a cap', () => {
    const { a, state } = ratedState('good')
    const next = run(
      { ...state, clueUsed: new Set([a]) },
      { type: 'rerateStarted', item: a },
      { type: 'rerateUnapplied', item: a, capReached: true }
    )
    const fresh = next.queue!.at(-1)!
    expect(fresh).toMatchObject({ retryCount: 0, requeuedForAgain: false })
    expect(next.ratingRecords.has(a)).toBe(false)
    expect(next.clueUsed.has(fresh)).toBe(true)
    expect(next.capNoticeShown).toBe(true)
    expect(next.pendingRerate).toBeNull()
  })

  it('again → good drops the unconsumed redrill and clears the hard mark', () => {
    const { a, state, previous } = ratedState('again')
    const next = reduce(state, {
      type: 'rerateApplied',
      item: a,
      previous,
      rating: 'good',
      eventId: 'ev-2',
      parked: false,
    })
    expect(next.queue).toHaveLength(2)
    expect(next.ratingRecords.get(a)).toEqual({ rating: 'good', eventId: 'ev-2', redrill: null })
    expect(next.sessionHard.has('a')).toBe(false)
    expect(next.peekBack).toBe(0)
  })

  it('again → good keeps a redrill the session already rated past, but forgets it in the record', () => {
    const { a, state, previous } = ratedState('again')
    const walked = { ...state, index: 3, peekBack: 3 }
    const next = reduce(walked, {
      type: 'rerateApplied',
      item: a,
      previous,
      rating: 'good',
      eventId: 'ev-2',
      parked: false,
    })
    expect(next.queue).toHaveLength(3)
    expect(next.ratingRecords.get(a)?.redrill).toBeNull()
  })

  it('good → again appends a redrill; an unchanged direction keeps the old one', () => {
    const { a, state, previous } = ratedState('good')
    const again = reduce(state, {
      type: 'rerateApplied',
      item: a,
      previous,
      rating: 'again',
      eventId: 'ev-2',
      parked: false,
    })
    const appended = again.queue!.at(-1)!
    expect(appended).toMatchObject({ requeuedForAgain: true })
    expect(again.ratingRecords.get(a)?.redrill).toBe(appended)

    const hard = reduce(state, {
      type: 'rerateApplied',
      item: a,
      previous,
      rating: 'hard',
      eventId: 'ev-3',
      parked: false,
    })
    expect(hard.queue).toHaveLength(2)
    expect(hard.sessionHard.has('a')).toBe(true)
  })
})

describe('introductions', () => {
  it('blocks until claimed; a failure waits for a retry', () => {
    const n = intro('n')
    let state = withQueue([n, card('a')])
    expect(introductionBlocked(state)).toBe(true)
    state = reduce(state, { type: 'introductionClaimFailed', key: 'recognition:n' })
    expect(introductionClaimFailed(state)).toBe(true)
    state = reduce(state, { type: 'introductionClaimRetried' })
    expect(introductionClaimFailed(state)).toBe(false)
    expect(state.claimAttempt).toBe(1)
    state = reduce(state, { type: 'introductionClaimed', key: 'recognition:n' })
    expect(introductionBlocked(state)).toBe(false)
  })

  it('a refusal removes the item; a cap refusal also sets both cap flags', () => {
    const n = intro('n')
    const refused = reduce(withQueue([n]), { type: 'introductionRefused', item: n, capReached: true })
    expect(refused.queue).toEqual([])
    expect(refused).toMatchObject({ dailyLimitReached: true, capNoticeShown: true, completion: null })
  })
})

describe('learn extra and resume', () => {
  it('learn extra resets the session view but keeps the session-wide tallies', () => {
    const a = card('a')
    const state = withQueue([a], {
      index: 1,
      clueUsed: new Set([a]),
      sessionHard: new Set(['a']),
      claimedIntroductions: new Set(['recognition:n']),
      capNoticeShown: true,
      completion: { totalCount: 1, hardCount: 1 },
      ratingRecords: new Map([[a, { rating: 'hard' as const, eventId: 'ev', redrill: null }]]),
    })
    const next = reduce(state, { type: 'learnExtraStarted', filter: { ...FILTER, learnExtraCount: 5 } })
    expect(next).toMatchObject({ queue: null, index: 0, queueFilter: { learnExtraCount: 5 } })
    expect(next.clueUsed.size).toBe(0)
    expect(next.ratingRecords.size).toBe(0)
    expect(next.sessionHard).toBe(state.sessionHard)
    expect(next.claimedIntroductions).toBe(state.claimedIntroductions)
    expect(next.capNoticeShown).toBe(true)
    expect(next.completion).toBe(state.completion)
  })

  it('round-trips through a snapshot, restoring an answered current exercise', () => {
    const answered: ComposedQueueItem = {
      type: 'exercise',
      entry: { userLookupId: 'x', pool: 'recognition', status: 'ready' } as StrengthenExerciseEntry,
      isNewIntroduction: false,
      bypassDailyCap: false,
    }
    const a = card('a')
    const outcome = { correct: true } as ExerciseAnswerData
    const state = withQueue([a, answered], {
      index: 1,
      exerciseOutcomes: new Map([[answered, outcome]]),
      clueUsed: new Set([a]),
    })
    const snapshot = sessionToSnapshot(state, 'ru') as ComposedSessionSnapshot
    const resumed = initialSessionState(snapshot, FILTER)
    expect(resumed.queue).toEqual([a, answered])
    expect(resumed.queue![1]).toBe(answered)
    expect(resumed.restoredAnsweredItem).toBe(answered)
    expect(resumed.currentAnswered).toBe(true)
    expect(resumed.clueUsed.has(a)).toBe(true)
  })

  it('leaves nothing to resume when the queue is exhausted or never composed', () => {
    expect(sessionToSnapshot(withQueue([card('a')], { index: 1 }), 'ru')).toBeNull()
    expect(sessionToSnapshot(initialSessionState(null, FILTER), 'ru')).toBeNull()
  })
})
