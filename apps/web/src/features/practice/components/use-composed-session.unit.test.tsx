// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query'
import type {
  PracticeQueueFilter,
  PracticeQueueItem,
  ReviewTerm,
  StrengthenExerciseEntry,
} from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { clearComposedSession, patchTermInComposedSession } from './composed-session-snapshot'
import { MAX_RATE_RETRIES, useComposedSession } from './use-composed-session'
import type { ComposedQueueItem } from './composed-queue-merge'
import type { ExerciseAnswerData } from './strengthen-types'

// Characterizes the composed practice session's bookkeeping through its hook.
// The mutations are real react-query `useMutation`s (so per-call callbacks
// follow the real MutationObserver rules) whose server calls stay pending
// until a test settles them, in whatever order the case needs.

type Deferred<V, R> = { variables: V; resolve: (value: R) => void; reject: (error: Error) => void }

const server = <V, R>() => {
  const calls: Deferred<V, R>[] = []
  const fn = (variables: V) =>
    new Promise<R>((resolve, reject) => {
      calls.push({ variables, resolve, reject })
    })
  return { calls, fn, last: () => calls[calls.length - 1] }
}

type RateVars = { userLookupId: string; rating: string; pool: string; skill: string; targetForm: string }
type RateResp = {
  data: { accepted: true; introducedNew: boolean; dailyCapReached: boolean; parked: boolean; eventId: string | null }
}
type ComposeResp = { data: { items: PracticeQueueItem[]; dailyLimitReached: boolean; canLearnExtra: boolean } }

const rated = (eventId: string | null, over: Partial<RateResp['data']> = {}): RateResp => ({
  data: { accepted: true, introducedNew: false, dailyCapReached: false, parked: false, eventId, ...over },
})

const FILTER: PracticeQueueFilter = {
  pools: ['production', 'recognition'],
  scope: 'both',
  render: 'both',
  autoWarmup: true,
  includeOptInNew: false,
}

const card = (id: string): ReviewTerm =>
  ({ userLookupId: id, headword: `word-${id}`, skill: 'meaning_recognition', targetForm: '' }) as ReviewTerm

const flashcard = (id: string): PracticeQueueItem => ({ type: 'flashcard', card: card(id) })

const exercise = (
  id: string,
  over: Partial<StrengthenExerciseEntry> = {},
  plan: { isNewIntroduction?: boolean } = {}
): PracticeQueueItem => ({
  type: 'exercise',
  entry: {
    userLookupId: id,
    pool: 'recognition',
    headword: `word-${id}`,
    status: 'ready',
    exerciseId: `ex-${id}`,
    exerciseType: 'mc_cloze',
    payload: { type: 'mc_cloze' },
    origin: 'onboarding',
    track: 'gate',
    ...over,
  } as StrengthenExerciseEntry,
  isNewIntroduction: plan.isNewIntroduction ?? false,
  bypassDailyCap: false,
})

const ANSWER: ExerciseAnswerData = { correct: true } as ExerciseAnswerData

// Lets react-query's batched notifications and React's updates flush.
const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5))
  })

const setup = () => {
  const compose = server<unknown, ComposeResp>()
  const rate = server<RateVars, RateResp>()
  const undo = server<unknown, { data: { undone: boolean } }>()
  const claim = server<unknown, { data: { status: string } }>()
  const refresh = server<unknown, { data: { items: PracticeQueueItem[] } }>()
  const onParked = vi.fn()
  const onSessionCompleted = vi.fn()
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )

  const render = () =>
    renderHook(
      () => {
        const composeM = useMutation({ mutationFn: compose.fn })
        const rateM = useMutation({ mutationFn: rate.fn })
        const undoM = useMutation({ mutationFn: undo.fn })
        const claimM = useMutation({ mutationFn: claim.fn })
        const refreshM = useMutation({ mutationFn: refresh.fn })
        return useComposedSession({
          targetLanguage: 'ru',
          filter: FILTER,
          composeQueue: composeM.mutate as never,
          rateTerm: rateM.mutate as never,
          undoRating: undoM.mutate as never,
          claimIntroduction: claimM.mutateAsync as never,
          refreshQueue: refreshM.mutateAsync as never,
          onParked,
          onSessionCompleted,
        })
      },
      { wrapper }
    )

  // Mounts, answers the compose with `items`, and returns the hook handle.
  const start = async (items: PracticeQueueItem[], over: Partial<ComposeResp['data']> = {}) => {
    const hook = render()
    await flush()
    compose.last().resolve({ data: { items, dailyLimitReached: false, canLearnExtra: false, ...over } })
    await flush()
    return hook
  }

  return { compose, rate, undo, claim, refresh, onParked, onSessionCompleted, render, start }
}

type Hook = Awaited<ReturnType<ReturnType<typeof setup>['start']>>
const session = (hook: Hook) => hook.result.current
const rateCurrent = async (hook: Hook, rating: 'again' | 'hard' | 'good' | 'easy') => {
  act(() => session(hook).handleRate(rating))
  await flush()
}
const rerate = async (hook: Hook, item: ComposedQueueItem, rating: 'again' | 'hard' | 'good' | 'easy') => {
  act(() => session(hook).handleRerate(item, rating))
  await flush()
}
const ids = (hook: Hook) =>
  session(hook).queue!.map((item) => (item.type === 'flashcard' ? item.card.userLookupId : item.entry.userLookupId))

beforeEach(() => clearComposedSession())
afterEach(() => clearComposedSession())

describe('Again redrill', () => {
  it('appends a redrill copy in the same update as the advance', async () => {
    const t = setup()
    const hook = await t.start([flashcard('a'), flashcard('b')])
    act(() => session(hook).handleRate('again'))
    expect(session(hook).index).toBe(1)
    expect(ids(hook)).toEqual(['a', 'b', 'a'])
    const redrill = session(hook).queue![2]
    expect(redrill).toMatchObject({ type: 'flashcard', requeuedForAgain: true, retryCount: 0 })
    expect(session(hook).pendingRatings).toBe(1)
    expect(session(hook).sessionHard.has('a')).toBe(true)
  })

  it.each([
    ['a daily-cap refusal', rated(null, { dailyCapReached: true })],
    ['a leech parking', rated('ev-a', { parked: true })],
  ])('drops the unconsumed redrill on %s', async (_label, response) => {
    const t = setup()
    const hook = await t.start([flashcard('a'), flashcard('b')])
    await rateCurrent(hook, 'again')
    t.rate.calls[0].resolve(response)
    await flush()
    expect(ids(hook)).toEqual(['a', 'b'])
    expect(session(hook).pendingRatings).toBe(0)
  })

  it('keeps the rating record (with its redrill) when parking returns an event', async () => {
    const t = setup()
    const hook = await t.start([flashcard('a'), flashcard('b')])
    const original = session(hook).queue![0]
    await rateCurrent(hook, 'again')
    const redrill = session(hook).queue![2]
    t.rate.calls[0].resolve(rated('ev-a', { parked: true }))
    await flush()
    expect(t.onParked).toHaveBeenCalledWith('word-a')
    expect(session(hook).ratingRecords.get(original)).toEqual({ rating: 'again', eventId: 'ev-a', redrill })
  })

  it('records nothing and shows the cap notice on a cap refusal', async () => {
    const t = setup()
    const hook = await t.start([flashcard('a'), flashcard('b')])
    await rateCurrent(hook, 'good')
    t.rate.calls[0].resolve(rated(null, { dailyCapReached: true }))
    await flush()
    expect(session(hook).ratingRecords.size).toBe(0)
    expect(session(hook).capNoticeShown).toBe(true)
  })

  it('drops the redrill on a mutation error and appends a retry copy instead', async () => {
    const t = setup()
    const hook = await t.start([flashcard('a'), flashcard('b')])
    await rateCurrent(hook, 'again')
    t.rate.calls[0].reject(new Error('network'))
    await flush()
    expect(ids(hook)).toEqual(['a', 'b', 'a'])
    expect(session(hook).queue![2]).toMatchObject({ retryCount: 1, requeuedForAgain: false })
    expect(session(hook).pendingRatings).toBe(0)
  })

  it('drops the redrill even while it is the live card (only rated-past copies are kept)', async () => {
    const t = setup()
    const hook = await t.start([flashcard('a')])
    await rateCurrent(hook, 'again')
    // The redrill copy is now the live item; the refusal lands before it is rated.
    expect(session(hook).index).toBe(1)
    t.rate.calls[0].resolve(rated(null, { dailyCapReached: true }))
    await flush()
    expect(ids(hook)).toEqual(['a'])
    expect(session(hook).current).toBeUndefined()
  })
})

describe('failed-rating retry copies', () => {
  it('re-appends a failed rating with retryCount+1, keeping requeuedForAgain, up to MAX_RATE_RETRIES', async () => {
    const t = setup()
    const hook = await t.start([flashcard('a')])
    for (let attempt = 0; attempt <= MAX_RATE_RETRIES; attempt++) {
      await rateCurrent(hook, 'good')
      t.rate.last().reject(new Error('network'))
      await flush()
    }
    const copies = session(hook).queue!
    expect(copies.map((item) => (item.type === 'flashcard' ? item.retryCount : -1))).toEqual([0, 1, 2])
    expect(session(hook).queue![session(hook).index]).toBeUndefined()
    expect(session(hook).pendingRatings).toBe(0)
  })

  it('keeps requeuedForAgain on a retry of a failed redrill rating', async () => {
    const t = setup()
    const hook = await t.start([flashcard('a')])
    await rateCurrent(hook, 'again')
    t.rate.calls[0].resolve(rated('ev-1'))
    await flush()
    await rateCurrent(hook, 'good') // rates the redrill copy
    t.rate.calls[1].reject(new Error('network'))
    await flush()
    expect(session(hook).queue![2]).toMatchObject({ retryCount: 1, requeuedForAgain: true })
  })
})

describe('clue cap', () => {
  it('carries to a failed rating retry copy but not to an Again redrill', async () => {
    const t = setup()
    const hook = await t.start([flashcard('a'), flashcard('b')])
    act(() => session(hook).showClue())
    expect(session(hook).clueCapped).toBe(true)
    await rateCurrent(hook, 'again')
    const redrill = session(hook).queue![2]
    t.rate.calls[0].resolve(rated('ev-a'))
    await flush()

    // b: clue, then a failed rating → its retry copy stays capped.
    act(() => session(hook).showClue())
    await rateCurrent(hook, 'good')
    t.rate.calls[1].reject(new Error('network'))
    await flush()
    const retry = session(hook).queue![3]
    expect(retry).toMatchObject({ type: 'flashcard', retryCount: 1 })

    // The live item is now a's redrill: not capped.
    expect(session(hook).current).toBe(redrill)
    expect(session(hook).clueCapped).toBe(false)
    await rateCurrent(hook, 'good')
    t.rate.calls[2].resolve(rated('ev-a2'))
    await flush()
    expect(session(hook).current).toBe(retry)
    expect(session(hook).clueCapped).toBe(true)
  })
})

// Rates the first card and peeks back at it, ready to re-rate.
const ratedAndPeeked = async (rating: 'again' | 'good') => {
  const t = setup()
  const hook = await t.start([flashcard('a'), flashcard('b'), flashcard('c')])
  const original = session(hook).queue![0]
  await rateCurrent(hook, rating)
  t.rate.calls[0].resolve(rated('ev-1'))
  await flush()
  act(() => session(hook).peekOlder())
  expect(session(hook).current).toBe(original)
  expect(session(hook).canRerate).toBe(true)
  return { t, hook, original }
}

describe('peek re-rate (undo → fresh rate)', () => {
  it('keeps the record when the undo mutation errors', async () => {
    const { t, hook, original } = await ratedAndPeeked('good')
    await rerate(hook, original, 'hard')
    expect(session(hook).pendingRerate).toBe(original)
    t.undo.calls[0].reject(new Error('network'))
    await flush()
    expect(session(hook).pendingRerate).toBeNull()
    expect(session(hook).ratingRecords.get(original)?.eventId).toBe('ev-1')
    expect(t.rate.calls).toHaveLength(1)
  })

  it('on a stale undo drops the record and requeues a fresh copy, carrying the clue cap', async () => {
    const t = setup()
    const hook = await t.start([flashcard('a'), flashcard('b')])
    const original = session(hook).queue![0]
    act(() => session(hook).showClue())
    await rateCurrent(hook, 'good')
    t.rate.calls[0].resolve(rated('ev-1'))
    await flush()
    act(() => session(hook).peekOlder())
    await rerate(hook, original, 'hard')
    t.undo.calls[0].resolve({ data: { undone: false } })
    await flush()
    expect(session(hook).ratingRecords.has(original)).toBe(false)
    expect(ids(hook)).toEqual(['a', 'b', 'a'])
    const fresh = session(hook).queue![2]
    expect(fresh).toMatchObject({ retryCount: 0, requeuedForAgain: false })
    expect(session(hook).pendingRerate).toBeNull()
    // Walk to the fresh copy: it is still clue-capped.
    act(() => session(hook).stopPeeking())
    await rateCurrent(hook, 'good')
    t.rate.calls[1].resolve(rated('ev-b'))
    await flush()
    expect(session(hook).current).toBe(fresh)
    expect(session(hook).clueCapped).toBe(true)
  })

  it.each([
    ['the fresh rating errors after a committed undo', 'error'],
    ['the fresh rating hits the daily cap', 'cap'],
    ['the term was parked elsewhere (no event)', 'parked'],
  ] as const)('requeues a fresh copy when %s', async (_label, outcome) => {
    const { t, hook, original } = await ratedAndPeeked('good')
    await rerate(hook, original, 'hard')
    t.undo.calls[0].resolve({ data: { undone: true } })
    await flush()
    const fresh = t.rate.calls[1]
    if (outcome === 'error') fresh.reject(new Error('network'))
    if (outcome === 'cap') fresh.resolve(rated(null, { dailyCapReached: true }))
    if (outcome === 'parked') fresh.resolve(rated(null, { parked: true }))
    await flush()
    expect(session(hook).ratingRecords.has(original)).toBe(false)
    expect(ids(hook)).toEqual(['a', 'b', 'c', 'a'])
    expect(session(hook).pendingRerate).toBeNull()
    expect(session(hook).capNoticeShown).toBe(outcome === 'cap')
    expect(t.onParked).toHaveBeenCalledTimes(outcome === 'parked' ? 1 : 0)
  })

  it('again → good drops the unconsumed redrill, updates the record and leaves peek', async () => {
    const { t, hook, original } = await ratedAndPeeked('again')
    expect(ids(hook)).toEqual(['a', 'b', 'c', 'a'])
    await rerate(hook, original, 'good')
    t.undo.calls[0].resolve({ data: { undone: true } })
    await flush()
    expect(t.rate.calls[1].variables).toMatchObject({ userLookupId: 'a', rating: 'good' })
    t.rate.calls[1].resolve(rated('ev-2'))
    await flush()
    expect(ids(hook)).toEqual(['a', 'b', 'c'])
    expect(session(hook).ratingRecords.get(original)).toEqual({ rating: 'good', eventId: 'ev-2', redrill: null })
    expect(session(hook).sessionHard.has('a')).toBe(false)
    expect(session(hook).isPeeking).toBe(false)
  })

  it('good → again appends a redrill and records it', async () => {
    const { t, hook, original } = await ratedAndPeeked('good')
    await rerate(hook, original, 'again')
    t.undo.calls[0].resolve({ data: { undone: true } })
    await flush()
    t.rate.calls[1].resolve(rated('ev-2'))
    await flush()
    expect(ids(hook)).toEqual(['a', 'b', 'c', 'a'])
    const redrill = session(hook).queue![3]
    expect(redrill).toMatchObject({ requeuedForAgain: true })
    expect(session(hook).ratingRecords.get(original)).toEqual({ rating: 'again', eventId: 'ev-2', redrill })
    expect(session(hook).sessionHard.has('a')).toBe(true)
  })

  it('a re-rate that newly parks the term drops the redrill and toasts', async () => {
    const { t, hook, original } = await ratedAndPeeked('again')
    await rerate(hook, original, 'again')
    t.undo.calls[0].resolve({ data: { undone: true } })
    await flush()
    t.rate.calls[1].resolve(rated('ev-2', { parked: true }))
    await flush()
    expect(ids(hook)).toEqual(['a', 'b', 'c'])
    expect(t.onParked).toHaveBeenCalledWith('word-a')
    expect(session(hook).ratingRecords.get(original)).toMatchObject({ eventId: 'ev-2', redrill: null })
  })

  it('keeps a redrill the session already reached, and offers no re-rate once that copy is rated', async () => {
    const t = setup()
    const hook = await t.start([flashcard('a')])
    const original = session(hook).queue![0]
    await rateCurrent(hook, 'again')
    t.rate.calls[0].resolve(rated('ev-1'))
    await flush()
    // The redrill copy is live and gets rated.
    await rateCurrent(hook, 'good')
    t.rate.calls[1].resolve(rated('ev-2'))
    await flush()
    act(() => session(hook).peekOlder())
    act(() => session(hook).peekOlder())
    expect(session(hook).current).toBe(original)
    expect(session(hook).canRerate).toBe(false)
  })

  it('ignores a second re-rate pressed within the same render', async () => {
    const { t, hook, original } = await ratedAndPeeked('good')
    act(() => {
      session(hook).handleRerate(original, 'hard')
      session(hook).handleRerate(original, 'easy')
    })
    await flush()
    expect(t.undo.calls).toHaveLength(1)
  })

  it('ignores a second re-rate while one is in flight', async () => {
    const { t, hook, original } = await ratedAndPeeked('good')
    await rerate(hook, original, 'hard')
    await rerate(hook, original, 'easy')
    expect(t.undo.calls).toHaveLength(1)
  })
})

describe('resume after an Edit-term detour', () => {
  it('saves on unmount and resumes queue, position, records, outcomes, clue, claims and flags', async () => {
    const t = setup()
    const hook = await t.start(
      [exercise('n', {}, { isNewIntroduction: true }), flashcard('a'), flashcard('b'), flashcard('c')],
      { dailyLimitReached: true, canLearnExtra: true }
    )
    t.claim.last().resolve({ data: { status: 'claimed' } })
    await flush()
    const introduction = session(hook).queue![0]
    act(() => session(hook).recordExerciseAnswer(introduction, ANSWER))
    act(() => session(hook).advance())
    const a = session(hook).queue![1]
    act(() => session(hook).showClue())
    await rateCurrent(hook, 'hard')
    t.rate.calls[0].resolve(rated('ev-a'))
    await flush()
    act(() => session(hook).showClue()) // on b, before the detour
    hook.unmount()

    const resumed = t.render()
    await flush()
    expect(t.compose.calls).toHaveLength(1)
    const s = resumed.result.current
    expect(s.queue).toEqual(session(hook).queue)
    expect(s.index).toBe(2)
    expect(s.ratingRecords.get(s.queue![1])).toEqual({ rating: 'hard', eventId: 'ev-a', redrill: null })
    expect(s.queue![1]).toBe(a)
    expect(s.exerciseOutcomes.get(s.queue![0])).toBe(ANSWER)
    expect(s.clueCapped).toBe(true)
    expect(s.claimedIntroductionCount).toBe(1)
    expect(s.sessionHard.has('a')).toBe(true)
    expect(s.dailyLimitReached).toBe(true)
    expect(s.canLearnExtra).toBe(true)
    expect(s.restoredAnsweredItem).toBeNull()
  })

  it('brings back an answered-but-not-advanced exercise as the restored answered item', async () => {
    const t = setup()
    const hook = await t.start([exercise('x'), flashcard('a')])
    const item = session(hook).queue![0]
    act(() => session(hook).recordExerciseAnswer(item, ANSWER))
    hook.unmount()
    const resumed = t.render()
    await flush()
    expect(resumed.result.current.restoredAnsweredItem).toBe(item)
    expect(resumed.result.current.currentAnswered).toBe(true)
  })

  it('applies stash edits made during the detour', async () => {
    const t = setup()
    const hook = await t.start([flashcard('a'), flashcard('b')])
    hook.unmount()
    patchTermInComposedSession({ id: 'a', headword: 'edited', grammar: {} } as never)
    const resumed = t.render()
    await flush()
    const first = resumed.result.current.queue![0]
    expect(first.type === 'flashcard' && first.card.headword).toBe('edited')
  })

  it.each([
    ['a deliberate end', 'ended'],
    ['an exhausted queue', 'exhausted'],
  ] as const)('does not resume after %s', async (_label, how) => {
    const t = setup()
    const hook = await t.start([flashcard('a')])
    if (how === 'ended') act(() => session(hook).markEnded())
    if (how === 'exhausted') await rateCurrent(hook, 'good')
    hook.unmount()
    t.render()
    await flush()
    expect(t.compose.calls).toHaveLength(2)
  })
})

describe('introduction claims', () => {
  it('blocks a planned introduction until it is claimed', async () => {
    const t = setup()
    const hook = await t.start([exercise('n', {}, { isNewIntroduction: true })])
    expect(session(hook).introductionBlocked).toBe(true)
    expect(t.claim.calls).toHaveLength(1)
    t.claim.calls[0].resolve({ data: { status: 'already_claimed' } })
    await flush()
    expect(session(hook).introductionBlocked).toBe(false)
    expect(session(hook).claimedIntroductionCount).toBe(1)
  })

  it.each([
    ['daily_cap_reached', true],
    ['unavailable', false],
  ] as const)('a %s refusal removes the item', async (status, capFlags) => {
    const t = setup()
    const hook = await t.start([exercise('n', {}, { isNewIntroduction: true }), flashcard('a')])
    t.claim.calls[0].resolve({ data: { status } })
    await flush()
    expect(ids(hook)).toEqual(['a'])
    expect(session(hook).dailyLimitReached).toBe(capFlags)
    expect(session(hook).capNoticeShown).toBe(capFlags)
  })

  it('stays blocked after a claim error until an explicit retry, which claims once', async () => {
    const t = setup()
    const hook = await t.start([exercise('n', {}, { isNewIntroduction: true })])
    t.claim.calls[0].reject(new Error('network'))
    await flush()
    expect(session(hook).introductionClaimFailed).toBe(true)
    await flush()
    expect(t.claim.calls).toHaveLength(1)
    act(() => session(hook).retryIntroductionClaim())
    await flush()
    expect(t.claim.calls).toHaveLength(2)
    expect(session(hook).introductionClaimFailed).toBe(false)
    t.claim.calls[1].resolve({ data: { status: 'claimed' } })
    await flush()
    expect(session(hook).introductionBlocked).toBe(false)
  })

  it('ignores a claim response that lands after the item changed', async () => {
    const t = setup()
    const hook = await t.start([exercise('n', {}, { isNewIntroduction: true }), flashcard('a')])
    // Skip past the blocked introduction (the view never offers this; the
    // hook's guard is what is pinned here).
    act(() => session(hook).advance())
    await flush()
    t.claim.calls[0].resolve({ data: { status: 'unavailable' } })
    await flush()
    expect(ids(hook)).toEqual(['n', 'a'])
  })
})

describe('placeholder refresh', () => {
  it('upgrades a generating placeholder in place, using the index the refresh was sent at', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const t = setup()
      const hook = await t.start([
        exercise('g', { status: 'generating', exerciseId: null, payload: null }),
        flashcard('a'),
      ])
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000)
      })
      expect(t.refresh.calls).toHaveLength(1)
      // Skip the placeholder while its refresh is in flight.
      act(() => session(hook).advance())
      t.refresh.calls[0].resolve({ data: { items: [exercise('g'), flashcard('a')] } })
      await flush()
      const upgraded = session(hook).queue![0]
      expect(upgraded.type === 'exercise' && upgraded.entry.status).toBe('ready')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('completion, settling and learn extra', () => {
  it('counts in-flight ratings and fires completion once, only on advance', async () => {
    const t = setup()
    const hook = await t.start([flashcard('a'), flashcard('b')])
    await rateCurrent(hook, 'hard')
    await rateCurrent(hook, 'good')
    expect(t.onSessionCompleted).toHaveBeenCalledTimes(1)
    expect(t.onSessionCompleted).toHaveBeenCalledWith({ totalCount: 2, hardCount: 1 })
    // A failed rating's retry copy re-extends the queue; finishing it again
    // does not fire a second completion.
    t.rate.calls[1].reject(new Error('network'))
    await flush()
    await rateCurrent(hook, 'good')
    expect(t.onSessionCompleted).toHaveBeenCalledTimes(1)
  })

  it('does not fire completion when a claim refusal empties the tail', async () => {
    const t = setup()
    const hook = await t.start([exercise('n', {}, { isNewIntroduction: true })])
    t.claim.calls[0].resolve({ data: { status: 'unavailable' } })
    await flush()
    expect(session(hook).queue).toEqual([])
    expect(t.onSessionCompleted).not.toHaveBeenCalled()
  })

  it('clears hint state on advance', async () => {
    const t = setup()
    const hook = await t.start([flashcard('a'), flashcard('b')])
    const item = session(hook).queue![0]
    act(() => session(hook).openHint({ item, exerciseId: 'h', payload: { type: 'mc_comprehension' } as never }))
    act(() => session(hook).answerHint(item, false))
    expect(session(hook).hintOutcome).toMatchObject({ rating: 'again', correct: false })
    act(() => session(hook).closeHint())
    expect(session(hook).revealed).toBe(true)
    await rateCurrent(hook, 'again')
    expect(session(hook).activeHint).toBeNull()
    expect(session(hook).hintOutcome).toBeNull()
    expect(session(hook).revealed).toBe(false)
  })

  it('learn extra resets the queue state but keeps Strengthen, claims, cap notice and the completion guard', async () => {
    const t = setup()
    const hook = await t.start([exercise('n', {}, { isNewIntroduction: true }), flashcard('a')])
    t.claim.calls[0].resolve({ data: { status: 'claimed' } })
    await flush()
    act(() => session(hook).advance())
    await rateCurrent(hook, 'hard')
    t.rate.calls[0].resolve(rated(null, { dailyCapReached: true }))
    await flush()
    expect(t.onSessionCompleted).toHaveBeenCalledTimes(1)

    act(() => session(hook).handleLearnExtra(5))
    expect(session(hook).queue).toBeNull()
    await flush()
    expect(t.compose.last().variables).toEqual({ targetLanguage: 'ru', filter: { ...FILTER, learnExtraCount: 5 } })
    t.compose.last().resolve({ data: { items: [flashcard('x')], dailyLimitReached: false, canLearnExtra: false } })
    await flush()
    expect(session(hook).index).toBe(0)
    expect(session(hook).ratingRecords.size).toBe(0)
    expect(session(hook).exerciseOutcomes.size).toBe(0)
    expect(session(hook).sessionHard.has('a')).toBe(true)
    expect(session(hook).claimedIntroductionCount).toBe(1)
    expect(session(hook).capNoticeShown).toBe(true)
    expect(session(hook).dailyLimitReached).toBe(false)
    await rateCurrent(hook, 'good')
    expect(t.onSessionCompleted).toHaveBeenCalledTimes(1)
  })
})

describe('overlapping ratings', () => {
  // Current behavior: the shared rateTerm observer keeps only the LATEST
  // mutate call's callbacks, so the first rating's bookkeeping is lost.
  it('loses the earlier rating’s callbacks when two ratings overlap', async () => {
    const t = setup()
    const hook = await t.start([flashcard('a'), flashcard('b'), flashcard('c')])
    await rateCurrent(hook, 'good')
    await rateCurrent(hook, 'good')
    t.rate.calls[0].resolve(rated('ev-a'))
    await flush()
    t.rate.calls[1].resolve(rated('ev-b'))
    await flush()
    expect([...session(hook).ratingRecords.values()].map((record) => record.eventId)).toEqual(['ev-b'])
    expect(session(hook).pendingRatings).toBe(1)
  })
})
