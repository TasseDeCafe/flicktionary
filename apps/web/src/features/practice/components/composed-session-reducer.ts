import type {
  PracticeQueueFilter,
  PracticeQueueItem,
  StrengthenExercisePayload,
} from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import type { RateValue } from '@flicktionary/ui/components/rate-buttons'
import { mergeComposedPlaceholders, toComposedQueueItem, type ComposedQueueItem } from './composed-queue-merge'
import { currentDayKey, type ComposedSessionSnapshot, type RatingRecord } from './composed-session-snapshot'
import type { ExerciseAnswerData } from './strengthen-types'

// The composed practice session's bookkeeping as a pure reducer: the local
// queue and position, Again-redrills, failed-rating retries, peek re-rate,
// rating records, hint and clue state, display-time introduction claims, and
// the resume snapshot conversions. useComposedSession owns the side effects
// (mutations, toasts, analytics) and dispatches their outcomes here.
//
// Queue items are compared by object IDENTITY everywhere (rating records,
// exercise outcomes, clue use, the resume stash), so the reducer never clones
// an item: collections are copied on write, items are carried over as-is.

// A persistently-failing rateTerm mutation re-appends its card to the queue end
// (so it isn't silently lost) — capped so a hard failure can't loop forever.
export const MAX_RATE_RETRIES = 2

// The MC exercise a pressed Hint swapped in for the current flashcard,
// snapshotted from the hint query so a background refetch can't change the
// exercise mid-interaction. Keyed to the queue item so a stale hint from a
// previous card is never honored.
export type ActiveHint = {
  item: ComposedQueueItem
  exerciseId: string
  payload: Extract<StrengthenExercisePayload, { type: 'mc_cloze' | 'mc_comprehension' }>
}

// The graded outcome of a hint: the rating it locks in (correct → 'hard',
// wrong → 'again'). The exercise is consumed at this point; Continue applies
// the rating through the normal rating path.
export type HintOutcome = {
  item: ComposedQueueItem
  correct: boolean
  rating: RateValue
}

export type SessionCompletion = { totalCount: number; hardCount: number }

export type ComposedSessionState = {
  // null until the compose lands (and while a Learn-extra batch composes).
  queue: ComposedQueueItem[] | null
  queueFilter: PracticeQueueFilter
  index: number
  // How many items behind the live index the user is re-viewing read-only.
  peekBack: number
  revealed: boolean
  // Whether the live-index exercise has been answered (gates the term kebab
  // on unanswered cloze exercises).
  currentAnswered: boolean
  activeHint: ActiveHint | null
  hintOutcome: HintOutcome | null
  // Flashcards whose word-family clue was shown: their Easy stays disabled,
  // live and on a peek re-rate. Carried to a failed rating's retry copy and to
  // a re-rate's requeued copy (the same attempt), never to an Again redrill
  // (a fresh attempt).
  clueUsed: ReadonlySet<ComposedQueueItem>
  dailyLimitReached: boolean
  // Whether recognition intro candidates remain for a Learn-extra batch.
  canLearnExtra: boolean
  capNoticeShown: boolean
  // Terms rated again/hard this session, offered to Strengthen afterwards.
  sessionHard: ReadonlySet<string>
  // Durably-applied ratings: an entry exists ⇔ the rating landed server-side
  // with an undoable event. Drives the peek re-rate buttons.
  ratingRecords: ReadonlyMap<ComposedQueueItem, RatingRecord>
  // Answered-exercise outcomes, for the read-only peek display.
  exerciseOutcomes: ReadonlyMap<ComposedQueueItem, ExerciseAnswerData>
  // `${pool}:${userLookupId}` of introductions claimed this session.
  claimedIntroductions: ReadonlySet<string>
  // The introduction whose claim failed: no automatic retry until the user
  // asks (`claimAttempt` re-triggers the claim effect).
  claimErrorKey: string | null
  claimAttempt: number
  // In-flight rateTerm calls: the completion screen waits for zero.
  pendingRatings: number
  // The peeked item whose undo → re-rate chain is in flight.
  pendingRerate: ComposedQueueItem | null
  // The resumed current item, when it was answered before the detour (the
  // server consumed it, so it renders read-only instead of re-mounting).
  restoredAnsweredItem: ComposedQueueItem | null
  // Set once, when an advance first crosses into the completion screen.
  completion: SessionCompletion | null
}

// The rating response fields the bookkeeping reads.
export type RatingResult = { dailyCapReached: boolean; parked: boolean; eventId: string | null }

export type ComposedSessionAction =
  | { type: 'composed'; items: PracticeQueueItem[]; dailyLimitReached: boolean; canLearnExtra: boolean }
  | { type: 'learnExtraStarted'; filter: PracticeQueueFilter }
  | { type: 'placeholdersRefreshed'; items: PracticeQueueItem[]; fromIndex: number }
  | { type: 'introductionClaimed'; key: string }
  | { type: 'introductionRefused'; item: ComposedQueueItem; capReached: boolean }
  | { type: 'introductionClaimFailed'; key: string }
  | { type: 'introductionClaimRetried' }
  | { type: 'revealed' }
  | { type: 'clueShown' }
  | { type: 'hintOpened'; hint: ActiveHint }
  | { type: 'hintAnswered'; item: ComposedQueueItem; correct: boolean }
  | { type: 'hintClosed' }
  | { type: 'peekedOlder' }
  | { type: 'peekedNewer' }
  | { type: 'peekStopped' }
  | { type: 'exerciseAnswered'; item: ComposedQueueItem; data: ExerciseAnswerData }
  | { type: 'advanced' }
  // The live flashcard was rated: advance, and append the Again redrill copy
  // (created by the caller, which needs its identity for the response).
  | { type: 'rateRequested'; item: ComposedQueueItem; rating: RateValue; redrill: ComposedQueueItem | null }
  | {
      type: 'rateSucceeded'
      item: ComposedQueueItem
      rating: RateValue
      redrill: ComposedQueueItem | null
      result: RatingResult
    }
  | { type: 'rateFailed'; item: ComposedQueueItem; redrill: ComposedQueueItem | null }
  | { type: 'rateSettled' }
  | { type: 'rerateStarted'; item: ComposedQueueItem }
  | { type: 'rerateUndoFailed' }
  // The card ended up unrated server-side (stale undo, error after a committed
  // undo, cap refusal, parked no-op): resurface it rateable.
  | { type: 'rerateUnapplied'; item: ComposedQueueItem; capReached: boolean }
  | {
      type: 'rerateApplied'
      item: ComposedQueueItem
      previous: RatingRecord
      rating: RateValue
      eventId: string
      parked: boolean
    }

// ---------------------------------------------------------------- selectors

export const isPeeking = (state: ComposedSessionState): boolean => state.peekBack > 0

export const displayedIndex = (state: ComposedSessionState): number => state.index - state.peekBack

export const displayedItem = (state: ComposedSessionState): ComposedQueueItem | undefined =>
  state.queue?.[displayedIndex(state)]

export const clueCapped = (state: ComposedSessionState): boolean => {
  const current = displayedItem(state)
  return current != null && state.clueUsed.has(current)
}

// The rating record of the peeked item, if any.
export const peekRecord = (state: ComposedSessionState): RatingRecord | undefined => {
  const current = displayedItem(state)
  return isPeeking(state) && current ? state.ratingRecords.get(current) : undefined
}

// Peek re-rate is offered when the peeked item has a durably applied rating
// AND its redrill copy wasn't itself rated yet — once the copy is rated, the
// original's event is no longer the latest live one (the server would refuse
// the undo too; no dead buttons).
export const canRerate = (state: ComposedSessionState): boolean => {
  const record = peekRecord(state)
  return !!record && (!record.redrill || !state.ratingRecords.has(record.redrill))
}

export const introductionKey = (item: Extract<ComposedQueueItem, { type: 'exercise' }>): string =>
  `${item.entry.pool}:${item.entry.userLookupId}`

// The planned introduction on display, which must be claimed before it shows.
export const liveIntroduction = (
  state: ComposedSessionState
): Extract<ComposedQueueItem, { type: 'exercise' }> | null => {
  const current = displayedItem(state)
  return !isPeeking(state) && current?.type === 'exercise' && current.isNewIntroduction ? current : null
}

export const introductionBlocked = (state: ComposedSessionState): boolean => {
  const live = liveIntroduction(state)
  return live != null && !state.claimedIntroductions.has(introductionKey(live))
}

export const introductionClaimFailed = (state: ComposedSessionState): boolean => {
  const live = liveIntroduction(state)
  return live != null && introductionBlocked(state) && state.claimErrorKey === introductionKey(live)
}

// ---------------------------------------------------------------- snapshot

export const initialSessionState = (
  resumed: ComposedSessionSnapshot | null,
  filter: PracticeQueueFilter
): ComposedSessionState => {
  const current = resumed?.queue[resumed.index]
  const restoredAnsweredItem =
    resumed && current && current.type === 'exercise' && resumed.exerciseOutcomes.has(current) ? current : null
  return {
    queue: resumed?.queue ?? null,
    queueFilter: resumed?.filter ?? filter,
    index: resumed?.index ?? 0,
    peekBack: 0,
    revealed: false,
    currentAnswered: restoredAnsweredItem != null,
    activeHint: null,
    hintOutcome: null,
    clueUsed: resumed?.clueUsed ?? new Set(),
    dailyLimitReached: resumed?.dailyLimitReached ?? false,
    canLearnExtra: resumed?.canLearnExtra ?? false,
    capNoticeShown: resumed?.capNoticeShown ?? false,
    sessionHard: resumed?.sessionHard ?? new Set(),
    ratingRecords: resumed?.ratingRecords ?? new Map(),
    exerciseOutcomes: resumed?.exerciseOutcomes ?? new Map(),
    claimedIntroductions: resumed?.claimedIntroductions ?? new Set(),
    claimErrorKey: null,
    claimAttempt: 0,
    pendingRatings: 0,
    pendingRerate: null,
    restoredAnsweredItem,
    completion: null,
  }
}

// The snapshot an interrupted session leaves behind, or null when there is
// nothing worth resuming (nothing composed yet, or the queue is exhausted).
// Collections are copied: the stash helpers edit the snapshot in place during
// a detour.
export const sessionToSnapshot = (
  state: ComposedSessionState,
  targetLanguage: string
): ComposedSessionSnapshot | null => {
  if (!state.queue || !state.queue[state.index]) return null
  return {
    targetLanguage,
    filter: state.queueFilter,
    queue: [...state.queue],
    index: state.index,
    dailyLimitReached: state.dailyLimitReached,
    canLearnExtra: state.canLearnExtra,
    capNoticeShown: state.capNoticeShown,
    sessionHard: new Set(state.sessionHard),
    ratingRecords: new Map(state.ratingRecords),
    exerciseOutcomes: new Map(state.exerciseOutcomes),
    clueUsed: new Set(state.clueUsed),
    claimedIntroductions: new Set(state.claimedIntroductions),
    dayKey: currentDayKey(),
  }
}

// ---------------------------------------------------------------- reducer

const withAdded = <T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> => (set.has(value) ? set : new Set(set).add(value))

const withDeleted = <T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> => {
  if (!set.has(value)) return set
  const next = new Set(set)
  next.delete(value)
  return next
}

const withEntry = <K, V>(map: ReadonlyMap<K, V>, key: K, value: V): ReadonlyMap<K, V> => new Map(map).set(key, value)

const withoutEntry = <K, V>(map: ReadonlyMap<K, V>, key: K): ReadonlyMap<K, V> => {
  if (!map.has(key)) return map
  const next = new Map(map)
  next.delete(key)
  return next
}

const append = (state: ComposedSessionState, item: ComposedQueueItem): ComposedSessionState =>
  state.queue ? { ...state, queue: [...state.queue, item] } : state

// A copy that re-asks the same attempt keeps the original's clue cap.
const carryClueUse = (state: ComposedSessionState, from: ComposedQueueItem, to: ComposedQueueItem) =>
  state.clueUsed.has(from) ? { ...state, clueUsed: withAdded(state.clueUsed, to) } : state

// Pulls a redrill copy back out — unless the session already walked past it
// (removing a consumed position would shift the queue under the live index
// onto the wrong card). The live card itself is still removable.
const dropRedrill = (state: ComposedSessionState, redrill: ComposedQueueItem | null): ComposedSessionState => {
  if (!redrill || !state.queue) return state
  const position = state.queue.indexOf(redrill)
  if (position === -1 || position < state.index) return state
  return { ...state, queue: state.queue.filter((queued) => queued !== redrill) }
}

const advance = (state: ComposedSessionState): ComposedSessionState => {
  const index = state.index + 1
  const totalCount = state.queue?.length ?? 0
  // Crossing into the completion screen. An empty compose never advances, so
  // it never counts; a retry copy re-extending the queue never re-reports.
  const completes = totalCount > 0 && index >= totalCount && state.completion == null
  return {
    ...state,
    index,
    revealed: false,
    currentAnswered: false,
    activeHint: null,
    hintOutcome: null,
    completion: completes ? { totalCount, hardCount: state.sessionHard.size } : state.completion,
  }
}

const flashcardCopy = (
  item: Extract<ComposedQueueItem, { type: 'flashcard' }>,
  over: { retryCount: number; requeuedForAgain: boolean }
): ComposedQueueItem => ({ type: 'flashcard', card: item.card, ...over })

export const composedSessionReducer = (
  state: ComposedSessionState,
  action: ComposedSessionAction
): ComposedSessionState => {
  switch (action.type) {
    case 'composed':
      return {
        ...state,
        queue: action.items.map(toComposedQueueItem),
        dailyLimitReached: action.dailyLimitReached,
        canLearnExtra: action.canLearnExtra,
      }

    // A fresh mini-session over the extra batch. Strengthen candidates,
    // claimed introductions, the cap notice and the completion report carry
    // over; the new compose sets the limit flags.
    case 'learnExtraStarted':
      return {
        ...state,
        queue: null,
        index: 0,
        peekBack: 0,
        revealed: false,
        currentAnswered: false,
        activeHint: null,
        hintOutcome: null,
        clueUsed: new Set(),
        queueFilter: action.filter,
        ratingRecords: new Map(),
        exerciseOutcomes: new Map(),
      }

    // Upgrades placeholders from `fromIndex` — the position when the refresh
    // was SENT, so an item skipped while it was in flight still upgrades.
    case 'placeholdersRefreshed':
      return state.queue
        ? { ...state, queue: mergeComposedPlaceholders(state.queue, action.items, action.fromIndex) }
        : state

    case 'introductionClaimed':
      return { ...state, claimedIntroductions: withAdded(state.claimedIntroductions, action.key) }

    case 'introductionRefused': {
      const queue = state.queue ? state.queue.filter((item) => item !== action.item) : state.queue
      return action.capReached
        ? { ...state, queue, dailyLimitReached: true, capNoticeShown: true }
        : { ...state, queue }
    }

    case 'introductionClaimFailed':
      return { ...state, claimErrorKey: action.key }

    case 'introductionClaimRetried':
      return { ...state, claimErrorKey: null, claimAttempt: state.claimAttempt + 1 }

    case 'revealed':
      return { ...state, revealed: true }

    case 'clueShown': {
      const current = displayedItem(state)
      return current ? { ...state, clueUsed: withAdded(state.clueUsed, current) } : state
    }

    case 'hintOpened':
      return { ...state, activeHint: action.hint }

    case 'hintAnswered':
      return {
        ...state,
        hintOutcome: { item: action.item, correct: action.correct, rating: action.correct ? 'hard' : 'again' },
      }

    // "Show answer" after the hint: back to the card, revealed once answered.
    case 'hintClosed':
      return {
        ...state,
        activeHint: null,
        revealed: state.hintOutcome?.item === displayedItem(state) ? true : state.revealed,
      }

    case 'peekedOlder':
      return { ...state, peekBack: state.peekBack + 1 }

    case 'peekedNewer':
      return { ...state, peekBack: Math.max(0, state.peekBack - 1) }

    case 'peekStopped':
      return { ...state, peekBack: 0 }

    case 'exerciseAnswered':
      return {
        ...state,
        exerciseOutcomes: withEntry(state.exerciseOutcomes, action.item, action.data),
        currentAnswered: true,
      }

    case 'advanced':
      return advance(state)

    // Anki-style: an 'again' card keeps coming back until it gets a
    // non-'again' rating. The redrill copy is appended in the same update as
    // the advance, so the Learning count never dips.
    case 'rateRequested': {
      if (action.item.type !== 'flashcard') return state
      const { userLookupId } = action.item.card
      const hard = action.rating === 'again' || action.rating === 'hard'
      let next: ComposedSessionState = {
        ...state,
        sessionHard: hard ? withAdded(state.sessionHard, userLookupId) : state.sessionHard,
        pendingRatings: state.pendingRatings + 1,
      }
      if (action.redrill) next = append(next, action.redrill)
      return advance(next)
    }

    case 'rateSucceeded': {
      const { result } = action
      // Cap refusal: nothing applied (no event) — no record, no redrill.
      if (result.dailyCapReached) return { ...dropRedrill(state, action.redrill), capNoticeShown: true }
      // Parked: the term left every practice queue — no in-session redrill;
      // rehab gates bring it back.
      const next = result.parked ? dropRedrill(state, action.redrill) : state
      if (!result.eventId) return next
      return {
        ...next,
        ratingRecords: withEntry(next.ratingRecords, action.item, {
          rating: action.rating,
          eventId: result.eventId,
          redrill: action.redrill,
        }),
      }
    }

    // A failed rating re-appends the card (same attempt: keeps the clue cap
    // and the redrill flag) until MAX_RATE_RETRIES.
    case 'rateFailed': {
      const next = dropRedrill(state, action.redrill)
      const { item } = action
      if (item.type !== 'flashcard' || item.retryCount >= MAX_RATE_RETRIES) return next
      const retry = flashcardCopy(item, { retryCount: item.retryCount + 1, requeuedForAgain: item.requeuedForAgain })
      return carryClueUse(append(next, retry), item, retry)
    }

    case 'rateSettled':
      return { ...state, pendingRatings: state.pendingRatings - 1 }

    case 'rerateStarted':
      return { ...state, pendingRerate: action.item }

    // The undo never reached the server: the record still holds.
    case 'rerateUndoFailed':
      return { ...state, pendingRerate: null }

    case 'rerateUnapplied': {
      const { item } = action
      if (item.type !== 'flashcard') return { ...state, pendingRerate: null }
      const fresh = flashcardCopy(item, { retryCount: 0, requeuedForAgain: false })
      const next = carryClueUse(
        append({ ...state, ratingRecords: withoutEntry(state.ratingRecords, item) }, fresh),
        item,
        fresh
      )
      return {
        ...next,
        capNoticeShown: next.capNoticeShown || action.capReached,
        pendingRerate: null,
      }
    }

    // Applied (incl. newly parked with an event): reconcile the redrill copy
    // with the rating change and replace the record.
    case 'rerateApplied': {
      const { item, previous, rating } = action
      if (item.type !== 'flashcard') return state
      let next = state
      let redrill = previous.redrill
      const wasAgain = previous.rating === 'again'
      if (action.parked || (wasAgain && rating !== 'again')) {
        next = dropRedrill(next, previous.redrill)
        redrill = null
      } else if (!wasAgain && rating === 'again') {
        const fresh = flashcardCopy(item, { retryCount: item.retryCount, requeuedForAgain: true })
        next = append(next, fresh)
        redrill = fresh
      }
      // Keyed by lookupId — may over-clear when a redrill copy is still hard;
      // acceptable, Strengthen is best-effort.
      const { userLookupId } = item.card
      const hard = rating === 'again' || rating === 'hard'
      return {
        ...next,
        sessionHard: hard ? withAdded(next.sessionHard, userLookupId) : withDeleted(next.sessionHard, userLookupId),
        ratingRecords: withEntry(next.ratingRecords, item, { rating, eventId: action.eventId, redrill }),
        peekBack: 0,
        pendingRerate: null,
      }
    }
  }
}
