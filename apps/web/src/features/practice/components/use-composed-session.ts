import { useEffect, useReducer, useRef } from 'react'
import type { PracticeQueueFilter } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import type { RateValue } from '@flicktionary/ui/components/rate-buttons'
import type {
  useClaimPracticeIntroduction,
  useComposePracticeQueue,
  useRateTerm,
  useRefreshPracticeQueue,
  useUndoRating,
} from '../api/practice-hooks'
import { poolForCard } from '../utils/pool-for-card'
import type { ComposedQueueItem } from './composed-queue-merge'
import { clearComposedSession, saveComposedSession, takeComposedSession } from './composed-session-snapshot'
import {
  canRerate,
  clueCapped,
  composedSessionReducer,
  displayedIndex,
  displayedItem,
  initialSessionState,
  introductionBlocked,
  introductionClaimFailed,
  introductionKey,
  isPeeking,
  liveIntroduction,
  peekRecord,
  sessionToSnapshot,
  type ActiveHint,
  type SessionCompletion,
} from './composed-session-reducer'
import type { ExerciseAnswerData } from './strengthen-types'

export { MAX_RATE_RETRIES } from './composed-session-reducer'

const POLL_INTERVAL_MS = 4000

export type ComposedSessionParams = {
  targetLanguage: string
  filter: PracticeQueueFilter
  composeQueue: ReturnType<typeof useComposePracticeQueue>['mutate']
  rateTerm: ReturnType<typeof useRateTerm>['mutate']
  undoRating: ReturnType<typeof useUndoRating>['mutate']
  claimIntroduction: ReturnType<typeof useClaimPracticeIntroduction>['mutateAsync']
  refreshQueue: ReturnType<typeof useRefreshPracticeQueue>['mutateAsync']
  // A rating parked the term as a leech (the view toasts).
  onParked: (headword: string) => void
  // An advance crossed into the completion screen — fired once per session.
  onSessionCompleted: (completion: SessionCompletion) => void
}

// The composed practice session (see composed-practice-view.tsx for the
// surface): composedSessionReducer holds the bookkeeping; this hook runs the
// side effects — the compose, ratings and re-rates, display-time introduction
// claims, the placeholder poll, and the resume stash — and dispatches their
// outcomes. Rendering, hotkeys, navigation and queries stay in the view.
export const useComposedSession = ({
  targetLanguage,
  filter,
  composeQueue,
  rateTerm,
  undoRating,
  claimIntroduction,
  refreshQueue,
  onParked,
  onSessionCompleted,
}: ComposedSessionParams) => {
  // An interrupted same-day session (edit-term detour, back gesture) resumes
  // where it stood instead of re-composing a new onboarding batch. The lazy
  // initializer consumes the stash exactly once per mount.
  const [state, dispatch] = useReducer(composedSessionReducer, null, () =>
    initialSessionState(takeComposedSession(targetLanguage, filter), filter)
  )
  // Deliberate session end (X / Back buttons, error screen) — skips the
  // unmount save, so the next Practice entry composes fresh.
  const endedRef = useRef(false)
  // A resumed session is already started — the compose effect must not run.
  const startedRef = useRef(state.queue != null)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    // eslint-disable-next-line react-you-might-not-need-an-effect/no-pass-data-to-parent -- composeQueue is the injected compose mutation (a server request), not a parent state setter; the session composes once on mount, so there is no event site
    composeQueue(
      { targetLanguage, filter },
      {
        onSuccess: (resp) =>
          dispatch({
            type: 'composed',
            items: resp.data.items,
            dailyLimitReached: resp.data.dailyLimitReached,
            canLearnExtra: resp.data.canLearnExtra,
          }),
      }
    )
  }, [composeQueue, targetLanguage, filter])

  // Live mirror for the unmount save (a cleanup closure would otherwise see
  // the mount render's state).
  const stateRef = useRef(state)
  stateRef.current = state
  useEffect(
    () => () => {
      // Only an interrupted session is worth resuming: when nothing composed
      // yet, the live queue is exhausted (completion screen), or the user
      // deliberately ended the session, clear the stash instead of saving —
      // an ended session must also invalidate any earlier stash so it can't
      // resurface after the fact.
      const snapshot = endedRef.current ? null : sessionToSnapshot(stateRef.current, targetLanguage)
      if (snapshot) saveComposedSession(snapshot)
      else clearComposedSession()
    },
    // The route remounts this view on language/filter change, so these deps
    // make the cleanup a save-once-on-unmount.
    [targetLanguage, filter]
  )

  // The completion report is set once by the reducer, on the advance that
  // first crosses into the completion screen.
  const completionReportedRef = useRef(false)
  useEffect(() => {
    if (!state.completion || completionReportedRef.current) return
    completionReportedRef.current = true
    // eslint-disable-next-line react-you-might-not-need-an-effect/no-pass-data-to-parent -- analytics callback, not parent state; the crossing is decided by the reducer during the advancing dispatch, so the report follows its commit
    onSessionCompleted(state.completion)
  }, [state.completion, onSessionCompleted])

  // Serve-only poll while a 'generating' exercise placeholder is still at or
  // ahead of the current position, swapping it to ready/failed in place. The
  // merge starts at the index the refresh was sent from.
  const pollingRef = useRef(false)
  const { queue, index, queueFilter } = state
  const hasPendingAhead =
    queue?.slice(index).some((item) => item.type === 'exercise' && item.entry.status === 'generating') ?? false
  useEffect(() => {
    if (!hasPendingAhead) return
    const interval = setInterval(async () => {
      if (pollingRef.current) return
      pollingRef.current = true
      try {
        const resp = await refreshQueue({ targetLanguage, filter: queueFilter })
        dispatch({ type: 'placeholdersRefreshed', items: resp.data.items, fromIndex: index })
      } catch {
        // Polling is best-effort; keep the placeholder and try again next tick.
      } finally {
        pollingRef.current = false
      }
    }, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [refreshQueue, targetLanguage, queueFilter, hasPendingAhead, index])

  // Display-time claim of a planned introduction: only a claimed item shows.
  // A failed claim waits for an explicit retry; a response for an item no
  // longer on display is ignored.
  const live = liveIntroduction(state)
  const liveKey = live ? introductionKey(live) : null
  const liveClaimed = liveKey != null && state.claimedIntroductions.has(liveKey)
  const { claimErrorKey, claimAttempt } = state
  useEffect(() => {
    if (!live || !liveKey || liveClaimed) return
    if (claimErrorKey === liveKey) return

    let cancelled = false
    void claimIntroduction({
      userLookupId: live.entry.userLookupId,
      targetLanguage,
      pool: live.entry.pool,
      bypassDailyCap: live.bypassDailyCap,
    })
      .then((response) => {
        if (cancelled) return
        const status = response.data.status
        if (status === 'claimed' || status === 'already_claimed') {
          dispatch({ type: 'introductionClaimed', key: liveKey })
        } else {
          dispatch({ type: 'introductionRefused', item: live, capReached: status === 'daily_cap_reached' })
        }
      })
      .catch(() => {
        if (cancelled) return
        dispatch({ type: 'introductionClaimFailed', key: liveKey })
      })
    return () => {
      cancelled = true
    }
  }, [claimIntroduction, claimErrorKey, claimAttempt, live, liveKey, liveClaimed, targetLanguage])

  const handleRate = (rating: RateValue) => {
    const item = state.queue?.[state.index]
    if (!item || item.type !== 'flashcard') return
    const { card } = item
    // The redrill copy's identity is what the response handlers roll back.
    const redrill: ComposedQueueItem | null =
      rating === 'again' ? { type: 'flashcard', card, retryCount: item.retryCount, requeuedForAgain: true } : null
    dispatch({ type: 'rateRequested', item, rating, redrill })
    rateTerm(
      {
        userLookupId: card.userLookupId,
        rating,
        pool: poolForCard(card),
        // Facet identity of the queued card — the composed queue serves
        // citation, pronunciation and form facets alike.
        skill: card.skill,
        targetForm: card.targetForm,
      },
      {
        onSettled: () => dispatch({ type: 'rateSettled' }),
        onSuccess: (resp) => {
          dispatch({ type: 'rateSucceeded', item, rating, redrill, result: resp.data })
          if (resp.data.parked && !resp.data.dailyCapReached) onParked(card.headword)
        },
        onError: () => dispatch({ type: 'rateFailed', item, redrill }),
      }
    )
  }

  // Peek re-rate (Anki semantics, flashcard items only): undo the recorded
  // rating, then apply the new one through the full rateTerm machinery
  // (cap/introduction/leech). Single-flight: a second press while the chain
  // runs is ignored, even within one render.
  const rerateInFlightRef = useRef(false)
  const handleRerate = (item: ComposedQueueItem, newRating: RateValue) => {
    if (item.type !== 'flashcard') return
    const record = state.ratingRecords.get(item)
    if (!record || state.pendingRerate || rerateInFlightRef.current) return
    rerateInFlightRef.current = true
    const { card } = item
    const facet = {
      userLookupId: card.userLookupId,
      pool: poolForCard(card),
      skill: card.skill,
      targetForm: card.targetForm,
    }
    const finish = () => {
      rerateInFlightRef.current = false
    }
    dispatch({ type: 'rerateStarted', item })

    undoRating(
      { ...facet, eventId: record.eventId },
      {
        // Nothing changed server-side — the record holds (the hook's meta toast
        // surfaces the failure).
        onError: () => {
          finish()
          dispatch({ type: 'rerateUndoFailed' })
        },
        onSuccess: (undoResp) => {
          if (!undoResp.data.undone) {
            // Stale handle: a later rating is now the latest live event, or it
            // was already reverted. The card resurfaces for a clean rating.
            finish()
            dispatch({ type: 'rerateUnapplied', item, capReached: false })
            return
          }
          rateTerm(
            { ...facet, rating: newRating },
            {
              onError: () => {
                finish()
                dispatch({ type: 'rerateUnapplied', item, capReached: false })
              },
              onSuccess: (resp) => {
                finish()
                const { parked, dailyCapReached, eventId } = resp.data
                if (dailyCapReached || (parked && eventId === null)) {
                  // The fresh rating didn't apply (cap consumed meanwhile, or
                  // the term got parked by another surface) — card is unrated.
                  dispatch({ type: 'rerateUnapplied', item, capReached: dailyCapReached })
                  if (parked) onParked(card.headword)
                  return
                }
                dispatch({
                  type: 'rerateApplied',
                  item,
                  previous: record,
                  rating: newRating,
                  eventId: eventId as string,
                  parked,
                })
                if (parked) onParked(card.headword)
              },
            }
          )
        },
      }
    )
  }

  // Learn extra: an explicit one-tap batch past the daily-new cap, offered on
  // the completion screen when the cap stopped auto-warm-up. Re-composes with
  // learnExtraCount and starts a fresh mini-session over the result (a
  // mutation, not a URL param, so refresh/back can never repeat the bypass).
  const handleLearnExtra = (learnExtraCount: number) => {
    const extraFilter = { ...filter, learnExtraCount }
    dispatch({ type: 'learnExtraStarted', filter: extraFilter })
    composeQueue(
      { targetLanguage, filter: extraFilter },
      {
        onSuccess: (resp) =>
          dispatch({
            type: 'composed',
            items: resp.data.items,
            dailyLimitReached: resp.data.dailyLimitReached,
            canLearnExtra: resp.data.canLearnExtra,
          }),
      }
    )
  }

  return {
    queue: state.queue,
    index: state.index,
    displayedIndex: displayedIndex(state),
    current: displayedItem(state),
    isPeeking: isPeeking(state),
    revealed: state.revealed,
    reveal: () => dispatch({ type: 'revealed' }),
    currentAnswered: state.currentAnswered,
    restoredAnsweredItem: state.restoredAnsweredItem,
    dailyLimitReached: state.dailyLimitReached,
    canLearnExtra: state.canLearnExtra,
    capNoticeShown: state.capNoticeShown,
    pendingRatings: state.pendingRatings,
    pendingRerate: state.pendingRerate,
    sessionHard: state.sessionHard,
    ratingRecords: state.ratingRecords,
    exerciseOutcomes: state.exerciseOutcomes,
    claimedIntroductionCount: state.claimedIntroductions.size,
    introductionBlocked: introductionBlocked(state),
    introductionClaimFailed: introductionClaimFailed(state),
    retryIntroductionClaim: () => dispatch({ type: 'introductionClaimRetried' }),
    activeHint: state.activeHint,
    hintOutcome: state.hintOutcome,
    openHint: (hint: ActiveHint) => dispatch({ type: 'hintOpened', hint }),
    answerHint: (item: ComposedQueueItem, correct: boolean) => dispatch({ type: 'hintAnswered', item, correct }),
    closeHint: () => dispatch({ type: 'hintClosed' }),
    clueCapped: clueCapped(state),
    showClue: () => dispatch({ type: 'clueShown' }),
    peekRecord: peekRecord(state),
    canRerate: canRerate(state),
    peekOlder: () => dispatch({ type: 'peekedOlder' }),
    peekNewer: () => dispatch({ type: 'peekedNewer' }),
    stopPeeking: () => dispatch({ type: 'peekStopped' }),
    advance: () => dispatch({ type: 'advanced' }),
    handleRate,
    handleRerate,
    handleLearnExtra,
    recordExerciseAnswer: (item: ComposedQueueItem, data: ExerciseAnswerData) =>
      dispatch({ type: 'exerciseAnswered', item, data }),
    markEnded: () => {
      endedRef.current = true
    },
  }
}
