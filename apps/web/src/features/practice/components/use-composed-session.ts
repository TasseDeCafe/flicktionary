import { useEffect, useRef, useState } from 'react'
import type {
  PracticeQueueFilter,
  StrengthenExercisePayload,
} from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import type { RateValue } from '@flicktionary/ui/components/rate-buttons'
import type {
  useClaimPracticeIntroduction,
  useComposePracticeQueue,
  useRateTerm,
  useRefreshPracticeQueue,
  useUndoRating,
} from '../api/practice-hooks'
import { poolForCard } from './flashcard-face'
import { mergeComposedPlaceholders, toComposedQueueItem, type ComposedQueueItem } from './composed-queue-merge'
import {
  clearComposedSession,
  currentDayKey,
  saveComposedSession,
  takeComposedSession,
  type RatingRecord,
} from './composed-session-snapshot'
import type { ExerciseAnswerData } from './strengthen-types'

const POLL_INTERVAL_MS = 4000

// A persistently-failing rateTerm mutation re-appends its card to the queue end
// (so it isn't silently lost) — capped so a hard failure can't loop forever.
export const MAX_RATE_RETRIES = 2

// The MC exercise a pressed Hint swapped in for the current flashcard,
// snapshotted from the hint query so a background refetch can't change the
// exercise mid-interaction. Keyed to the queue item (object identity) so a
// stale hint from a previous card is never honored.
export type ActiveHint = {
  item: ComposedQueueItem
  exerciseId: string
  payload: Extract<StrengthenExercisePayload, { type: 'mc_cloze' | 'mc_comprehension' }>
}

// The graded outcome of a hint: the rating it locks in (correct → 'hard',
// wrong → 'again'). The exercise is consumed at this point; Continue applies
// the rating through the normal handleRate machinery.
export type HintOutcome = {
  item: ComposedQueueItem
  correct: boolean
  rating: RateValue
}

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
  onSessionCompleted: (params: { totalCount: number; hardCount: number }) => void
}

// The composed practice session's bookkeeping (see composed-practice-view.tsx
// for the surface): the local queue and position, Again-redrills, failed-
// rating retries, peek re-rate, rating records, hint and clue state, the
// display-time introduction claims, the placeholder poll, and the resume
// stash. Rendering, hotkeys, navigation and queries stay in the view.
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
  // Deliberate session end (X / Back buttons, error screen) — skips the
  // unmount save below, so the next Practice entry composes fresh instead of
  // resuming this session.
  const endedRef = useRef(false)
  const markEnded = () => {
    endedRef.current = true
  }

  // An interrupted same-day session (edit-term detour, back gesture) resumes
  // where it stood instead of re-composing a new onboarding batch. Lazy
  // initializer: the take consumes the stash
  // exactly once per mount, and every piece of session state seeds from it.
  const [resumedSession] = useState(() => takeComposedSession(targetLanguage, filter))
  const [queue, setQueue] = useState<ComposedQueueItem[] | null>(resumedSession?.queue ?? null)
  const [queueFilter, setQueueFilter] = useState<PracticeQueueFilter>(resumedSession?.filter ?? filter)
  const [index, setIndex] = useState(resumedSession?.index ?? 0)
  // Mirror of `index` for async rate callbacks: rolling back an optimistic
  // redrill copy must know whether the copy was already consumed.
  const indexRef = useRef(resumedSession?.index ?? 0)
  const [revealed, setRevealed] = useState(false)
  const [capNoticeShown, setCapNoticeShown] = useState(resumedSession?.capNoticeShown ?? false)
  const [dailyLimitReached, setDailyLimitReached] = useState(resumedSession?.dailyLimitReached ?? false)
  // Whether recognition intro candidates remain for a Learn-extra batch — the
  // compose response knows; a bare dailyLimitReached no longer implies it.
  const [canLearnExtra, setCanLearnExtra] = useState(resumedSession?.canLearnExtra ?? false)
  // Peek-back: how many items behind the live index we're re-viewing read-only.
  const [peekBack, setPeekBack] = useState(0)
  // A resumed session is already started — the compose effect must not run.
  const startedRef = useRef(resumedSession != null)
  // Terms rated again/hard this session — offered post-session Strengthen
  // exercises. Parked terms are exercises here (never flashcards), so the set
  // stays non-parked by construction.
  const sessionHardRef = useRef<Set<string>>(resumedSession?.sessionHard ?? new Set())
  // Durably-applied ratings keyed by queue-item identity: an entry exists ⇔
  // the rating landed server-side with an undoable event. Drives the peek
  // re-rate buttons (flashcard items only — a consumed exercise can't be
  // un-answered).
  const ratingRecordsRef = useRef<Map<ComposedQueueItem, RatingRecord>>(resumedSession?.ratingRecords ?? new Map())
  // Answered-exercise outcomes, for the read-only peek display.
  const exerciseOutcomesRef = useRef<Map<ComposedQueueItem, ExerciseAnswerData>>(
    resumedSession?.exerciseOutcomes ?? new Map()
  )
  // The peeked item whose undo→re-rate chain is in flight (disables the peek
  // rate buttons until the chain settles).
  const [pendingRerate, setPendingRerate] = useState<ComposedQueueItem | null>(null)
  // In-flight rateTerm mutations. handleRate advances optimistically and
  // records the rating only on success, so the completion screen can render
  // before the last rating lands — a mix Continue must wait for zero or the
  // recap undercounts and a failed rating's requeue is lost.
  const [pendingRatings, setPendingRatings] = useState(0)
  // The resumed current item, when it was answered before the detour. The
  // answer state lived inside the (unmounted) exercise component and the
  // server consumed the exercise, so the render path swaps in the read-only
  // answered panel for this one item instead of remounting the live component
  // — whose re-submit would be rejected as no longer answerable.
  const [restoredAnsweredItem] = useState<ComposedQueueItem | null>(() => {
    if (!resumedSession) return null
    const item = resumedSession.queue[resumedSession.index]
    return item && item.type === 'exercise' && resumedSession.exerciseOutcomes.has(item) ? item : null
  })
  // Whether the live-index exercise has been answered — gates the header kebab
  // on unanswered cloze exercises (see kebab derivation in the view).
  const [currentAnswered, setCurrentAnswered] = useState(restoredAnsweredItem != null)
  // Flashcard hint: the MC exercise currently swapped in for the live card,
  // and the locked-in rating once it's answered (correct → hard, wrong →
  // again). Both are keyed to the queue item and cleared on advance.
  const [activeHint, setActiveHint] = useState<ActiveHint | null>(null)
  const [hintOutcome, setHintOutcome] = useState<HintOutcome | null>(null)
  // Flashcards whose word-family clue was shown (recognition fronts). Kept
  // past the advance: it also caps the peek re-rate, and it rides the resume
  // snapshot so a detour can't hand back an Easy the clue already spent.
  const [clueUsed, setClueUsed] = useState<Set<ComposedQueueItem>>(() => resumedSession?.clueUsed ?? new Set())
  const claimedIntroductionsRef = useRef<Set<string>>(resumedSession?.claimedIntroductions ?? new Set())
  const [claimIntroductionErrorKey, setClaimIntroductionErrorKey] = useState<string | null>(null)
  const [claimRetry, setClaimRetry] = useState(0)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    // eslint-disable-next-line react-you-might-not-need-an-effect/no-pass-data-to-parent -- composeQueue is the injected compose mutation (a server request), not a parent state setter; the session composes once on mount, so there is no event site
    composeQueue(
      { targetLanguage, filter },
      {
        onSuccess: (resp) => {
          setQueue(resp.data.items.map(toComposedQueueItem))
          setDailyLimitReached(resp.data.dailyLimitReached)
          setCanLearnExtra(resp.data.canLearnExtra)
        },
      }
    )
  }, [composeQueue, targetLanguage, filter])

  // Live mirror of the snapshot-worthy state for the unmount save below (a
  // cleanup closure would otherwise see the mount render's values).
  const sessionStateRef = useRef({
    queue,
    index,
    dailyLimitReached,
    canLearnExtra,
    capNoticeShown,
    queueFilter,
    clueUsed,
  })
  sessionStateRef.current = { queue, index, dailyLimitReached, canLearnExtra, capNoticeShown, queueFilter, clueUsed }
  useEffect(
    () => () => {
      const snapshot = sessionStateRef.current
      // Only an interrupted session is worth resuming: when nothing composed
      // yet, the live queue is exhausted (completion screen), or the user
      // deliberately ended the session (close()), clear the stash instead of
      // saving — an ended session must also invalidate any earlier stash so
      // it can't resurface after the fact.
      if (endedRef.current || !snapshot.queue || !snapshot.queue[snapshot.index]) {
        clearComposedSession()
        return
      }
      saveComposedSession({
        targetLanguage,
        filter: snapshot.queueFilter,
        queue: snapshot.queue,
        index: snapshot.index,
        dailyLimitReached: snapshot.dailyLimitReached,
        canLearnExtra: snapshot.canLearnExtra,
        capNoticeShown: snapshot.capNoticeShown,
        sessionHard: sessionHardRef.current,
        ratingRecords: ratingRecordsRef.current,
        exerciseOutcomes: exerciseOutcomesRef.current,
        clueUsed: snapshot.clueUsed,
        claimedIntroductions: claimedIntroductionsRef.current,
        dayKey: currentDayKey(),
      })
    },
    // The route remounts this view on language/filter change, so these deps
    // make the cleanup a save-once-on-unmount.
    [targetLanguage, filter]
  )

  // Serve-only poll while a 'generating' exercise placeholder is still at or
  // ahead of the current position, swapping it to ready/failed in place.
  const pollingRef = useRef(false)
  const hasPendingAhead =
    queue?.slice(index).some((item) => item.type === 'exercise' && item.entry.status === 'generating') ?? false
  useEffect(() => {
    if (!hasPendingAhead) return
    const interval = setInterval(async () => {
      if (pollingRef.current) return
      pollingRef.current = true
      try {
        const resp = await refreshQueue({ targetLanguage, filter: queueFilter })
        setQueue((prev) => (prev ? mergeComposedPlaceholders(prev, resp.data.items, index) : prev))
      } catch {
        // Polling is best-effort; keep the placeholder and try again next tick.
      } finally {
        pollingRef.current = false
      }
    }, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [refreshQueue, targetLanguage, queueFilter, hasPendingAhead, index])

  const isPeeking = peekBack > 0
  const displayedIndex = index - peekBack
  const current = queue?.[displayedIndex]
  const liveIntroduction = !isPeeking && current?.type === 'exercise' && current.isNewIntroduction ? current : null
  const liveIntroductionKey = liveIntroduction
    ? `${liveIntroduction.entry.pool}:${liveIntroduction.entry.userLookupId}`
    : null
  const introductionBlocked = liveIntroductionKey != null && !claimedIntroductionsRef.current.has(liveIntroductionKey)
  const introductionClaimFailed = introductionBlocked && claimIntroductionErrorKey === liveIntroductionKey

  useEffect(() => {
    if (!liveIntroduction || !liveIntroductionKey) return
    if (claimedIntroductionsRef.current.has(liveIntroductionKey)) return
    if (claimIntroductionErrorKey === liveIntroductionKey) return

    let cancelled = false
    void claimIntroduction({
      userLookupId: liveIntroduction.entry.userLookupId,
      targetLanguage,
      pool: liveIntroduction.entry.pool,
      bypassDailyCap: liveIntroduction.bypassDailyCap,
    })
      .then((response) => {
        if (cancelled) return
        const status = response.data.status
        if (status === 'claimed' || status === 'already_claimed') {
          claimedIntroductionsRef.current.add(liveIntroductionKey)
        } else {
          setQueue((existing) => (existing ? existing.filter((item) => item !== liveIntroduction) : existing))
          if (status === 'daily_cap_reached') {
            setDailyLimitReached(true)
            setCapNoticeShown(true)
          }
        }
      })
      .catch(() => {
        if (cancelled) return
        setClaimIntroductionErrorKey(liveIntroductionKey)
      })
    return () => {
      cancelled = true
    }
  }, [claimIntroduction, claimIntroductionErrorKey, claimRetry, liveIntroduction, liveIntroductionKey, targetLanguage])

  const retryIntroductionClaim = () => {
    setClaimIntroductionErrorKey(null)
    setClaimRetry((value) => value + 1)
  }

  // Using the clue caps the rating at Good — live and on a peek re-rate.
  const clueCapped = current != null && clueUsed.has(current)
  const showClue = () => {
    if (current) setClueUsed((used) => new Set(used).add(current))
  }
  // A failed rating's recovery copy re-asks the same attempt, so it keeps the
  // clue's cap (unlike an Again redrill, which is a fresh attempt).
  const carryClueUse = (from: ComposedQueueItem, to: ComposedQueueItem) =>
    setClueUsed((used) => (used.has(from) ? new Set(used).add(to) : used))

  // One completion event per session, even if a failed rating's retry copy
  // re-extends the queue after the completion screen already appeared.
  const completionCapturedRef = useRef(false)
  // `queuedRedrillCount` lets handleRate signal a redrill appended in the same
  // render (invisible to this closure's `queue`) so the completion capture
  // doesn't fire while the session is about to continue.
  const advanceBy = (queuedRedrillCount: number) => {
    setRevealed(false)
    setCurrentAnswered(false)
    setActiveHint(null)
    setHintOutcome(null)
    setIndex((i) => i + 1)
    indexRef.current += 1
    // Crossing into the completion screen — an empty compose (nothing served)
    // never advances, so it never counts as a completed session.
    const totalCount = (queue?.length ?? 0) + queuedRedrillCount
    if (totalCount > 0 && indexRef.current >= totalCount && !completionCapturedRef.current) {
      completionCapturedRef.current = true
      onSessionCompleted({ totalCount, hardCount: sessionHardRef.current.size })
    }
  }
  const advance = () => advanceBy(0)

  const handleRate = (rating: RateValue) => {
    const item = queue?.[index]
    if (!item || item.type !== 'flashcard') return
    const { card } = item
    const pool = poolForCard(card)

    if (rating === 'again' || rating === 'hard') {
      sessionHardRef.current.add(card.userLookupId)
    }

    // Anki-style: an 'again' card keeps coming back until it gets a
    // non-'again' rating. The redrill copy is appended in the same render as
    // the index advance; rolled back (by identity) on the outcomes that must
    // not redrill: cap-rejected rating, leech parking, mutation error.
    const redrill: ComposedQueueItem | null =
      rating === 'again' ? { type: 'flashcard', card, retryCount: item.retryCount, requeuedForAgain: true } : null
    if (redrill) setQueue((q) => (q ? [...q, redrill] : q))
    advanceBy(redrill ? 1 : 0)
    const dropRedrill = () => {
      if (!redrill) return
      setQueue((q) => {
        if (!q) return q
        const position = q.indexOf(redrill)
        // Already consumed (re-rated before the response landed): removing it
        // now would shift the queue under the live index onto the wrong card.
        if (position === -1 || position < indexRef.current) return q
        return q.filter((queued) => queued !== redrill)
      })
    }

    setPendingRatings((count) => count + 1)
    rateTerm(
      {
        userLookupId: card.userLookupId,
        rating,
        pool,
        // Facet identity of the queued card — the composed queue serves
        // citation, pronunciation and form facets alike.
        skill: card.skill,
        targetForm: card.targetForm,
      },
      {
        onSettled: () => setPendingRatings((count) => count - 1),
        onSuccess: (resp) => {
          if (resp.data.dailyCapReached) {
            // Nothing applied (no event) — no record, nothing to re-rate.
            dropRedrill()
            if (!capNoticeShown) setCapNoticeShown(true)
            return
          }
          if (resp.data.parked) {
            // The term crossed the leech threshold and left every practice
            // queue — don't redrill it in-session; rehab gates bring it back.
            dropRedrill()
            onParked(card.headword)
            if (resp.data.eventId) {
              ratingRecordsRef.current.set(item, { rating, eventId: resp.data.eventId, redrill })
            }
            return
          }
          if (resp.data.eventId) {
            ratingRecordsRef.current.set(item, { rating, eventId: resp.data.eventId, redrill })
          }
        },
        onError: () => {
          dropRedrill()
          if (item.retryCount < MAX_RATE_RETRIES) {
            const retry: ComposedQueueItem = {
              type: 'flashcard',
              card,
              retryCount: item.retryCount + 1,
              requeuedForAgain: item.requeuedForAgain,
            }
            setQueue((q) => (q ? [...q, retry] : q))
            carryClueUse(item, retry)
          }
        },
      }
    )
  }

  // Peek re-rate (Anki semantics, flashcard items only): undo the recorded
  // rating, then apply the new one through the full rateTerm machinery
  // (cap/introduction/leech). Any outcome that leaves the card unrated
  // server-side (stale undo, cap refusal, parked no-op, error after a
  // committed undo) drops the record and re-appends a fresh item so the card
  // resurfaces rateable.
  const handleRerate = (item: ComposedQueueItem, newRating: RateValue) => {
    if (item.type !== 'flashcard') return
    const record = ratingRecordsRef.current.get(item)
    if (!record || pendingRerate) return
    const { card } = item
    const pool = poolForCard(card)
    setPendingRerate(item)

    const requeueFresh = () => {
      ratingRecordsRef.current.delete(item)
      const fresh: ComposedQueueItem = { type: 'flashcard', card, retryCount: 0, requeuedForAgain: false }
      setQueue((q) => (q ? [...q, fresh] : q))
      carryClueUse(item, fresh)
    }

    undoRating(
      {
        userLookupId: card.userLookupId,
        pool,
        skill: card.skill,
        targetForm: card.targetForm,
        eventId: record.eventId,
      },
      {
        // Mutation error: nothing changed server-side — keep the record (the
        // hook's meta toast surfaces the failure).
        onError: () => setPendingRerate(null),
        onSuccess: (undoResp) => {
          if (!undoResp.data.undone) {
            // Stale handle — a later rating (e.g. another tab) is now
            // the latest live event, or it was already reverted. The server
            // refused to restore; treat the card as unknown-but-consistent:
            // drop the record and let it resurface for a clean rating.
            requeueFresh()
            setPendingRerate(null)
            return
          }
          rateTerm(
            {
              userLookupId: card.userLookupId,
              rating: newRating,
              pool,
              skill: card.skill,
              targetForm: card.targetForm,
            },
            {
              onError: () => {
                requeueFresh()
                setPendingRerate(null)
              },
              onSuccess: (resp) => {
                const parked = resp.data.parked
                if (resp.data.dailyCapReached || (parked && resp.data.eventId === null)) {
                  // The fresh rating didn't apply (cap consumed meanwhile, or
                  // the term got parked by another surface) — card is unrated.
                  requeueFresh()
                  if (resp.data.dailyCapReached && !capNoticeShown) setCapNoticeShown(true)
                  if (parked) onParked(card.headword)
                  setPendingRerate(null)
                  return
                }

                // Applied (incl. newly-parked-with-eventId). Reconcile the
                // redrill copy with the rating change.
                const oldRedrill = record.redrill
                let newRedrill: ComposedQueueItem | null = oldRedrill
                const dropOldRedrill = () => {
                  if (!oldRedrill) return
                  setQueue((q) => {
                    if (!q) return q
                    const position = q.indexOf(oldRedrill)
                    // Already consumed: the live index walked past it — can't
                    // pull a card the session already showed.
                    if (position === -1 || position < indexRef.current) return q
                    return q.filter((queued) => queued !== oldRedrill)
                  })
                  newRedrill = null
                }
                if (parked) {
                  // Newly parked: out of rotation — no redrill either way.
                  dropOldRedrill()
                  onParked(card.headword)
                } else if (record.rating === 'again' && newRating !== 'again') {
                  dropOldRedrill()
                } else if (record.rating !== 'again' && newRating === 'again') {
                  const fresh: ComposedQueueItem = {
                    type: 'flashcard',
                    card,
                    retryCount: item.retryCount,
                    requeuedForAgain: true,
                  }
                  setQueue((q) => (q ? [...q, fresh] : q))
                  newRedrill = fresh
                }

                // Keyed by lookupId — may over-clear when a redrill copy is
                // still hard; acceptable, Strengthen is best-effort.
                if (newRating === 'again' || newRating === 'hard') {
                  sessionHardRef.current.add(card.userLookupId)
                } else {
                  sessionHardRef.current.delete(card.userLookupId)
                }

                ratingRecordsRef.current.set(item, {
                  rating: newRating,
                  eventId: resp.data.eventId as string,
                  redrill: newRedrill,
                })
                setPeekBack(0)
                setPendingRerate(null)
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
    setQueue(null)
    setIndex(0)
    indexRef.current = 0
    setPeekBack(0)
    setRevealed(false)
    setCurrentAnswered(false)
    setActiveHint(null)
    setHintOutcome(null)
    setClueUsed(new Set())
    const extraFilter = { ...filter, learnExtraCount }
    setQueueFilter(extraFilter)
    ratingRecordsRef.current.clear()
    exerciseOutcomesRef.current.clear()
    composeQueue(
      { targetLanguage, filter: extraFilter },
      {
        onSuccess: (resp) => {
          setQueue(resp.data.items.map(toComposedQueueItem))
          setDailyLimitReached(resp.data.dailyLimitReached)
          setCanLearnExtra(resp.data.canLearnExtra)
        },
      }
    )
  }

  const recordExerciseAnswer = (item: ComposedQueueItem, data: ExerciseAnswerData) => {
    exerciseOutcomesRef.current.set(item, data)
    setCurrentAnswered(true)
  }

  // Peek re-rate: offered when the displayed (peeked) item has a durably
  // applied rating AND its redrill copy wasn't itself rated yet — once the
  // copy is rated, the original's event is no longer the latest live one (the
  // server would refuse the undo too; don't offer dead buttons).
  const peekRecord = isPeeking && current ? ratingRecordsRef.current.get(current) : undefined
  const canRerate = !!peekRecord && (!peekRecord.redrill || !ratingRecordsRef.current.has(peekRecord.redrill))

  return {
    queue,
    index,
    displayedIndex,
    current,
    isPeeking,
    revealed,
    reveal: () => setRevealed(true),
    currentAnswered,
    restoredAnsweredItem,
    dailyLimitReached,
    canLearnExtra,
    capNoticeShown,
    pendingRatings,
    pendingRerate,
    sessionHard: sessionHardRef.current,
    ratingRecords: ratingRecordsRef.current,
    exerciseOutcomes: exerciseOutcomesRef.current,
    claimedIntroductionCount: claimedIntroductionsRef.current.size,
    introductionBlocked,
    introductionClaimFailed,
    retryIntroductionClaim,
    activeHint,
    hintOutcome,
    openHint: (hint: ActiveHint) => setActiveHint(hint),
    answerHint: (item: ComposedQueueItem, correct: boolean) =>
      setHintOutcome({ item, correct, rating: correct ? 'hard' : 'again' }),
    // "Show answer" after the hint: back to the card, revealed when answered.
    closeHint: () => {
      setActiveHint(null)
      if (hintOutcome?.item === current) setRevealed(true)
    },
    clueCapped,
    showClue,
    peekRecord,
    canRerate,
    peekOlder: () => setPeekBack((p) => p + 1),
    peekNewer: () => setPeekBack((p) => Math.max(0, p - 1)),
    stopPeeking: () => setPeekBack(0),
    advance,
    handleRate,
    handleRerate,
    handleLearnExtra,
    recordExerciseAnswer,
    markEnded,
  }
}
