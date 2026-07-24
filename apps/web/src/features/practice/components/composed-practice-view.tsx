import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Dumbbell, Flame, Hourglass, Lightbulb, Loader2, MoreVertical } from 'lucide-react'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { Button } from '@flicktionary/ui/components/button'
import { Kbd } from '@flicktionary/ui/components/kbd'
import { RATE_VALUES, RateButtons, type RateValue } from '@flicktionary/ui/components/rate-buttons'
import { useIsMobile } from '@flicktionary/ui/hooks/use-is-mobile'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import { SuccessCheck } from '@/components/ui/success-check'
import { useHotkeys, type HotkeyBinding } from '@/hooks/use-hotkeys'
import type {
  PracticeQueueFilter,
  StrengthenExercisePayload,
} from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import {
  useClaimPracticeIntroduction,
  useComposePracticeQueue,
  useHintExercise,
  useRateTerm,
  useRefreshPracticeQueue,
  useUndoRating,
} from '../api/practice-hooks'
import { FlashcardFace, poolForCard } from './flashcard-face'
import { TermActionsOverlay } from './term-actions-overlay'
import { mergeComposedPlaceholders, toComposedQueueItem, type ComposedQueueItem } from './composed-queue-merge'
import {
  clearComposedSession,
  currentDayKey,
  saveComposedSession,
  takeComposedSession,
  type RatingRecord,
} from './composed-session-snapshot'
import { ReviewQueueStats } from './review-queue-stats'
import { getRemainingCounts } from './review-counts'
import { PracticeLoader } from './practice-loader'
import { AnsweredExercisePanel } from './answered-exercise-panel'
import { ExerciseHeader } from './exercise-header'
import { ExerciseLayout } from './exercise-layout'
import { FailedExercisePlaceholder } from './failed-exercise-placeholder'
import { McExercise } from './mc-exercise'
import { ProductionClozeExercise } from './production-cloze-exercise'
import { UseInSentenceExercise } from './use-in-sentence-exercise'
import type { ExerciseAnswerData, ExerciseCopyVariant } from './strengthen-types'
import { useTermMeaning } from '../utils/use-term-meaning'
import { computeMixRecap, splitMixChain } from '../utils/daily-mix'
import { MixInterstitial } from './mix-interstitial'

const POLL_INTERVAL_MS = 4000

// A persistently-failing rateTerm mutation re-appends its card to the queue end
// (so it isn't silently lost) — capped so a hard failure can't loop forever.
const MAX_RATE_RETRIES = 2

// The MC exercise a pressed Hint swapped in for the current flashcard,
// snapshotted from the hint query so a background refetch can't change the
// exercise mid-interaction. Keyed to the queue item (object identity) so a
// stale hint from a previous card is never honored.
type ActiveHint = {
  item: ComposedQueueItem
  exerciseId: string
  payload: Extract<StrengthenExercisePayload, { type: 'mc_cloze' | 'mc_comprehension' }>
}

// The graded outcome of a hint: the rating it locks in (correct → 'hard',
// wrong → 'again'). The exercise is consumed at this point; Continue applies
// the rating through the normal handleRate machinery.
type HintOutcome = {
  item: ComposedQueueItem
  correct: boolean
  rating: RateValue
}

const copyVariantFor = (origin: 'onboarding' | 'leech' | null): ExerciseCopyVariant =>
  origin === 'leech' ? 'rehab' : 'warmup'

type ComposedPracticeViewProps = {
  targetLanguage: string
  filter: PracticeQueueFilter
  // Daily Mix: the full ordered language chain (see daily-mix.ts). Undefined
  // outside a mix run.
  mix?: string[]
}

// The unified Practice session: ONE local queue mixing gate exercises (parked
// warm-up + rehab terms) and due flashcards, served by composePracticeQueue
// (production-first ordering is the server's). One-shot snapshot: the queue is
// seeded from the compose response; the serve-only refresh poll only upgrades
// exercise placeholders in place, never appends. An interrupted session is
// stashed on unmount and resumed on the next matching mount (see
// composed-session-snapshot.ts), so an edit-term detour or back gesture never
// re-composes an in-progress session.
export const ComposedPracticeView = ({ targetLanguage, filter, mix }: ComposedPracticeViewProps) => {
  const { t } = useLingui()
  const isMobile = useIsMobile()
  const showKbd = !isMobile
  const resolveMeaning = useTermMeaning(targetLanguage)
  const navigate = useNavigate()
  const languageName = getLanguageName(targetLanguage)
  // Daily Mix position in the chain; null outside a mix (or when a hand-edited
  // URL doesn't contain this language — then the session behaves as plain).
  const mixChain = splitMixChain(mix, targetLanguage)
  const mixUpcoming = mixChain?.upcoming ?? []
  // Deliberate session end (X / Back buttons, error screen) — skips the
  // unmount save below, so the next Practice entry composes fresh instead of
  // resuming this session.
  const endedRef = useRef(false)
  const close = () => {
    endedRef.current = true
    // A mix is dashboard-owned (its banner is the only entry point), so every
    // mix exit — Finish, "Done for now", the header X — returns to the
    // dashboard; a plain session returns to the language landing it started
    // from.
    if (mixChain) {
      void navigate({ to: '/dashboard' })
      return
    }
    void navigate({ to: '/practice/language/$targetLanguage', params: { targetLanguage } })
  }
  const continueMix = () => {
    // A deliberate hop like close(): the finished session must not stash.
    endedRef.current = true
    void navigate({
      to: '/practice/composed/$targetLanguage',
      params: { targetLanguage: mixUpcoming[0] },
      search: { ...filter, mix },
    })
  }

  const { mutate: composeQueue, isPending: composePending, isError: composeError } = useComposePracticeQueue()
  const { mutateAsync: claimIntroduction } = useClaimPracticeIntroduction()
  const { mutateAsync: refreshQueue } = useRefreshPracticeQueue()
  const { mutate: rateTerm } = useRateTerm()
  const { mutate: undoRating } = useUndoRating()

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
  const [actionsOpen, setActionsOpen] = useState(false)
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
  // on unanswered cloze exercises (see kebab derivation below).
  const [currentAnswered, setCurrentAnswered] = useState(restoredAnsweredItem != null)
  // Flashcard hint: the MC exercise currently swapped in for the live card,
  // and the locked-in rating once it's answered (correct → hard, wrong →
  // again). Both are keyed to the queue item and cleared on advance.
  const [activeHint, setActiveHint] = useState<ActiveHint | null>(null)
  const [hintOutcome, setHintOutcome] = useState<HintOutcome | null>(null)
  const claimedIntroductionsRef = useRef<Set<string>>(resumedSession?.claimedIntroductions ?? new Set())
  const [claimIntroductionErrorKey, setClaimIntroductionErrorKey] = useState<string | null>(null)
  const [claimRetry, setClaimRetry] = useState(0)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
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
  const sessionStateRef = useRef({ queue, index, dailyLimitReached, canLearnExtra, capNoticeShown, queueFilter })
  sessionStateRef.current = { queue, index, dailyLimitReached, canLearnExtra, capNoticeShown, queueFilter }
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

  const remainingCounts = queue ? getRemainingCounts(queue, index) : null
  const isPeeking = peekBack > 0
  const displayedIndex = index - peekBack
  const current = queue?.[displayedIndex]
  const liveIntroduction = !isPeeking && current?.type === 'exercise' && current.isNewIntroduction ? current : null
  const liveIntroductionKey = liveIntroduction
    ? `${liveIntroduction.entry.pool}:${liveIntroduction.entry.userLookupId}`
    : null
  const introductionBlocked = liveIntroductionKey != null && !claimedIntroductionsRef.current.has(liveIntroductionKey)

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

  // A hint only exists for the LIVE, unrevealed flashcard of a citation
  // MEANING facet — the exercise bank tests meaning and has no facet identity,
  // so pronunciation/form cards never offer one (same restriction as leech
  // parking). The query is availability-only: null hides the button.
  const currentCard = !isPeeking && current?.type === 'flashcard' ? current.card : null
  const hintEligible =
    currentCard != null &&
    !revealed &&
    currentCard.targetForm === '' &&
    (currentCard.skill === 'meaning_recognition' || currentCard.skill === 'meaning_production')
  const { data: hintExercise } = useHintExercise(
    hintEligible && !activeHint && !hintOutcome
      ? { userLookupId: currentCard.userLookupId, pool: poolForCard(currentCard) }
      : null
  )
  // Prefetch the upcoming item's hint availability while the current one is
  // displayed: the query is cached by (userLookupId, pool), so when the queue
  // advances the footer renders Hint + Show answer from its first frame
  // instead of popping from a full-width Show answer a beat later. Redrill
  // copies share the original card's cache key, so they're covered too.
  const upcomingItem = queue?.[index + 1]
  const upcomingHintCard =
    upcomingItem?.type === 'flashcard' &&
    upcomingItem.card.targetForm === '' &&
    (upcomingItem.card.skill === 'meaning_recognition' || upcomingItem.card.skill === 'meaning_production')
      ? upcomingItem.card
      : null
  useHintExercise(
    upcomingHintCard ? { userLookupId: upcomingHintCard.userLookupId, pool: poolForCard(upcomingHintCard) } : null
  )

  // Only an MC payload can render as a hint; the server only serves MC types
  // here, so this narrowing is a type guard, not a filter.
  const servableHint =
    hintExercise != null &&
    (hintExercise.payload.type === 'mc_cloze' || hintExercise.payload.type === 'mc_comprehension')
      ? { exerciseId: hintExercise.exerciseId, payload: hintExercise.payload }
      : null
  const currentHintOutcome = hintOutcome && hintOutcome.item === current ? hintOutcome : null
  const activeHintDisplayed = activeHint != null && activeHint.item === current

  const advance = () => {
    setRevealed(false)
    setCurrentAnswered(false)
    setActiveHint(null)
    setHintOutcome(null)
    setIndex((i) => i + 1)
    indexRef.current += 1
  }

  const handleRate = (rating: RateValue) => {
    const item = queue?.[index]
    if (!item || item.type !== 'flashcard') return
    const { card } = item
    const pool = poolForCard(card)

    advance()

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
            const headword = card.headword
            toast.info(t`“${headword}” keeps tripping you up — it's parked for rehab exercises.`)
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
            setQueue((q) =>
              q
                ? [
                    ...q,
                    {
                      type: 'flashcard',
                      card,
                      retryCount: item.retryCount + 1,
                      requeuedForAgain: item.requeuedForAgain,
                    },
                  ]
                : q
            )
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
      setQueue((q) => (q ? [...q, { type: 'flashcard', card, retryCount: 0, requeuedForAgain: false }] : q))
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
            // Stale handle — a later rating (other tab, reading mode) is now
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
                  if (parked) {
                    const headword = card.headword
                    toast.info(t`“${headword}” keeps tripping you up — it's parked for rehab exercises.`)
                  }
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
                  const headword = card.headword
                  toast.info(t`“${headword}” keeps tripping you up — it's parked for rehab exercises.`)
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

  // ----- Hotkeys. One flat binding list for every state of this screen; the
  // per-binding enabled flags are mutually exclusive by construction (front vs
  // back vs hint-outcome vs peek vs placeholder), so a key can never trigger
  // twice. Live exercise items are NOT handled here — the exercise components
  // run their own useHotkeys with disjoint gates. -----
  const flashcardLive = !isPeeking && current?.type === 'flashcard' && !activeHintDisplayed
  const showingFront = flashcardLive && !revealed
  const showingBack = flashcardLive && revealed
  // Still-generating placeholders only — terminally 'failed' ones render the
  // FailedExercisePlaceholder decision card, which owns its own hotkeys
  // (Enter/Space = study as flashcard, S/Esc = skip).
  const exercisePlaceholderLive =
    !isPeeking &&
    !introductionBlocked &&
    current?.type === 'exercise' &&
    current.entry.status !== 'failed' &&
    (current.entry.status === 'generating' || !current.entry.exerciseId || !current.entry.payload)
  // The read-only panel a resume shows for an already-answered exercise — its
  // single action is Next (the live exercise components own their hotkeys, but
  // this panel is host-rendered).
  const restoredAnsweredDisplayed = !isPeeking && current != null && current === restoredAnsweredItem
  const liveExerciseDisplayed = !isPeeking && (current?.type === 'exercise' || activeHintDisplayed)
  // Peek re-rate: offered when the displayed (peeked) item has a durably
  // applied rating AND its redrill copy wasn't itself rated yet — once the
  // copy is rated, the original's event is no longer the latest live one (the
  // server would refuse the undo too; don't offer dead buttons).
  const peekRecord = isPeeking && current ? ratingRecordsRef.current.get(current) : undefined
  const canRerate = !!peekRecord && (!peekRecord.redrill || !ratingRecordsRef.current.has(peekRecord.redrill))
  const peekRerateEnabled = isPeeking && current?.type === 'flashcard' && canRerate && !pendingRerate
  // Completion screen: Enter drives its primary action (Strengthen when the
  // session produced again/hard terms, otherwise close). Space is deliberately
  // NOT bound — Anki-style space-hammering through the final cards must not
  // launch a Strengthen session by accident; Enter needs a second, deliberate
  // press since the rating keydown was consumed by the previous card.
  const sessionComplete = queue != null && !isPeeking && !queue[index]
  // Ratings/rerates still in flight after the queue exhausted: leaving now
  // would clear the exhausted snapshot and orphan a failed rating's requeue,
  // and the recap would tally short — every completion-screen exit waits.
  const isSettling = pendingRatings > 0 || pendingRerate != null
  // The header X is inert on the completion screen while ratings settle; it
  // stays a deliberate quit everywhere else.
  const guardedClose = () => {
    if (sessionComplete && isSettling) return
    close()
  }
  // In a mix, the chain rides along so Strengthen's close continues to the
  // next language instead of stranding the run on the language landing.
  const openStrengthen = () =>
    void navigate({
      to: '/practice/strengthen/$targetLanguage',
      params: { targetLanguage },
      search: { pool: 'recognition', sessionHard: [...sessionHardRef.current], mix },
    })
  useHotkeys(
    [
      { key: 'space', enabled: showingFront, onPress: () => setRevealed(true) },
      { key: 'enter', enabled: showingFront, onPress: () => setRevealed(true) },
      {
        key: 'h',
        enabled: showingFront && servableHint != null,
        onPress: () => {
          if (current && servableHint) {
            setActiveHint({ item: current, exerciseId: servableHint.exerciseId, payload: servableHint.payload })
          }
        },
      },
      ...RATE_VALUES.map((value, index): HotkeyBinding => ({
        key: String(index + 1),
        enabled: showingBack && !currentHintOutcome,
        onPress: () => handleRate(value),
      })),
      // Anki muscle memory: Space (or Enter) on the revealed back = Good.
      { key: 'space', enabled: showingBack && !currentHintOutcome, onPress: () => handleRate('good') },
      { key: 'enter', enabled: showingBack && !currentHintOutcome, onPress: () => handleRate('good') },
      // Hint outcome locked the rating — Enter/Space is the single Continue.
      {
        key: 'enter',
        enabled: showingBack && !!currentHintOutcome,
        onPress: () => currentHintOutcome && handleRate(currentHintOutcome.rating),
      },
      {
        key: 'space',
        enabled: showingBack && !!currentHintOutcome,
        onPress: () => currentHintOutcome && handleRate(currentHintOutcome.rating),
      },
      // Still-generating exercise placeholders only offer Skip.
      { key: 's', enabled: exercisePlaceholderLive, onPress: advance },
      { key: 'escape', enabled: exercisePlaceholderLive, onPress: advance },
      { key: 'enter', enabled: exercisePlaceholderLive, onPress: advance },
      { key: 'space', enabled: exercisePlaceholderLive, onPress: advance },
      // Resumed already-answered exercise: the read-only panel's single Next.
      { key: 'enter', enabled: restoredAnsweredDisplayed, onPress: advance },
      { key: 'space', enabled: restoredAnsweredDisplayed, onPress: advance },
      // Peek navigation mirrors the status-row chevrons, same disabled rules.
      {
        key: 'arrowleft',
        enabled: current != null && displayedIndex > 0 && !liveExerciseDisplayed,
        onPress: () => setPeekBack((p) => p + 1),
      },
      { key: 'arrowright', enabled: isPeeking, onPress: () => setPeekBack((p) => Math.max(0, p - 1)) },
      ...RATE_VALUES.map((value, index): HotkeyBinding => ({
        key: String(index + 1),
        enabled: peekRerateEnabled,
        onPress: () => {
          if (current) handleRerate(current, value)
        },
      })),
      { key: 'enter', enabled: isPeeking, onPress: () => setPeekBack(0) },
      { key: 'space', enabled: isPeeking, onPress: () => setPeekBack(0) },
      {
        key: 'enter',
        enabled: sessionComplete,
        onPress: () => {
          // Every completion action is blocked while ratings settle.
          if (isSettling) return
          if (mixUpcoming.length > 0) {
            continueMix()
            return
          }
          if (sessionHardRef.current.size > 0) openStrengthen()
          else close()
        },
      },
    ],
    !actionsOpen
  )

  // The header kebab (Edit term) targets whichever term the displayed item
  // drills — flashcard or exercise alike. It is withheld while it could spoil
  // an answer (the menu title + focus view reveal the headword, which would let
  // a gate be passed on a peeked answer): an unanswered cloze exercise (the
  // headword IS the cloze answer — same rule as the exercise header's
  // headerLeaksAnswer), or a 'generating' placeholder, which can swap in place
  // to a cloze on the next poll. Peeked items are behind the live index, which
  // the placeholder merge never touches — they already display their headword,
  // so the kebab stays.
  const couldSpoilClozeAnswer =
    current?.type === 'exercise' &&
    !isPeeking &&
    !currentAnswered &&
    (current.entry.status === 'generating' ||
      current.entry.payload?.type === 'mc_cloze' ||
      current.entry.payload?.type === 'production_cloze')
  // Same rule for an unanswered flashcard-hint cloze: a production card hides
  // its headword, and the hint's mc_cloze answer IS the headword.
  const couldSpoilHintAnswer =
    activeHint != null && activeHint.item === current && hintOutcome == null && activeHint.payload.type === 'mc_cloze'
  const actionsTerm =
    current && !couldSpoilClozeAnswer && !couldSpoilHintAnswer
      ? current.type === 'exercise'
        ? current.entry
        : current.card
      : null

  const wrap = (children: React.ReactNode) => (
    <ModalScreen
      onClose={guardedClose}
      closeIcon='x'
      title={languageName}
      rightSlot={
        actionsTerm ? (
          <Button
            type='button'
            variant='ghost'
            size='icon'
            aria-label={t`Term actions`}
            onClick={() => setActionsOpen(true)}
          >
            <MoreVertical className='h-5 w-5' />
          </Button>
        ) : undefined
      }
    >
      {children}
      {actionsTerm && <TermActionsOverlay open={actionsOpen} onOpenChange={setActionsOpen} term={actionsTerm} />}
    </ModalScreen>
  )

  // Every close-routed CTA shares this label: a mix exits to the dashboard, a
  // plain session to its language landing (see close above).
  const closeLabel = mixChain ? t`Back to dashboard` : t`Back to ${languageName}`

  if (composeError) {
    return wrap(
      <div className='flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center'>
        <p className='text-lg font-semibold'>{t`Couldn't load your practice session.`}</p>
        <Button type='button' size='lg' onClick={close}>
          {closeLabel}
        </Button>
      </div>
    )
  }

  if (composePending || queue === null) {
    return wrap(<PracticeLoader label={t`Preparing your session…`} />)
  }

  if (introductionBlocked) {
    if (claimIntroductionErrorKey === liveIntroductionKey) {
      return wrap(
        <div className='flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center'>
          <p className='text-lg font-semibold'>{t`Couldn't start this exercise.`}</p>
          <Button
            type='button'
            size='lg'
            onClick={() => {
              setClaimIntroductionErrorKey(null)
              setClaimRetry((value) => value + 1)
            }}
          >
            {t`Try again`}
          </Button>
        </div>
      )
    }
    return wrap(<PracticeLoader label={t`Preparing your next exercise…`} />)
  }

  // Done: live queue exhausted (also the empty-compose case).
  if (!queue[index] && !isPeeking) {
    const sessionHard = [...sessionHardRef.current]
    const hardCount = sessionHard.length

    // Mid-mix: the interstitial replaces the completion screen — recap of this
    // language, chain progress, and the hand-off to the next language.
    if (mixChain && mixUpcoming.length > 0) {
      return wrap(
        <MixInterstitial
          targetLanguage={targetLanguage}
          done={mixChain.done}
          upcoming={mixUpcoming}
          recap={computeMixRecap({
            ratedItems: [...ratingRecordsRef.current.keys()],
            answeredExercises: [...exerciseOutcomesRef.current.keys()],
            claimedIntroductionCount: claimedIntroductionsRef.current.size,
          })}
          hardCount={hardCount}
          isSettling={isSettling}
          onStrengthen={openStrengthen}
          onContinue={continueMix}
          onExit={close}
          showKbd={showKbd}
        />
      )
    }

    const emptyQueueLabel =
      filter.scope === 'new_only'
        ? t`Nothing new to learn right now.`
        : filter.scope === 'due_only'
          ? t`No reviews are due right now.`
          : t`Nothing to practice right now.`
    // canLearnExtra gates on actual candidates: with the budget exhausted but
    // nothing left to introduce, the offer would compose an empty batch. In a
    // mix the offer is suppressed — extra learning stays on the per-language
    // landing so the chain's pacing isn't derailed.
    const showLearnExtra =
      canLearnExtra &&
      (dailyLimitReached || capNoticeShown) &&
      filter.autoWarmup &&
      filter.scope !== 'due_only' &&
      mixChain == null
    return wrap(
      <div className='flex flex-1 flex-col overflow-hidden'>
        <div className='flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center'>
          <SuccessCheck />
          <p className='text-lg font-semibold'>{queue.length === 0 ? emptyQueueLabel : t`All done!`}</p>
          {/* Final language of a Daily Mix run. */}
          {mixChain != null && (
            <p className='text-muted-foreground text-sm'>{t`Mix complete — every language is done.`}</p>
          )}
          {isSettling && (
            <p className='text-muted-foreground flex items-center gap-2 text-sm'>
              <Loader2 className='h-4 w-4 animate-spin' />
              {t`Saving your ratings…`}
            </p>
          )}
          {(dailyLimitReached || capNoticeShown) && (
            <div className='flex items-center justify-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800'>
              <Flame className='h-4 w-4 shrink-0' />
              {t`Daily new-term limit reached — more terms enter tomorrow.`}
            </div>
          )}
          {showLearnExtra && (
            <div className='flex flex-col items-center gap-2'>
              <p className='text-muted-foreground text-sm'>{t`Want to keep going anyway?`}</p>
              <div className='flex gap-2'>
                {[5, 10, 20].map((n) => (
                  <Button
                    key={n}
                    type='button'
                    variant='outline'
                    size='sm'
                    disabled={isSettling}
                    onClick={() => handleLearnExtra(n)}
                  >
                    {t`Learn ${n} extra`}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {hardCount > 0 && (
            <p className='text-muted-foreground text-sm'>
              {t`${hardCount} term(s) gave you trouble. A quick exercise round can lock them in — optional.`}
            </p>
          )}
        </div>
        <div className='bg-background border-t px-4 pt-2 pb-3'>
          <div className='mx-auto flex w-full max-w-xl flex-col gap-2'>
            {hardCount > 0 ? (
              <>
                <Button type='button' size='xl' className='w-full' disabled={isSettling} onClick={openStrengthen}>
                  <Dumbbell className='h-4 w-4' />
                  {t`Strengthen`}
                  {showKbd && <Kbd>↵</Kbd>}
                </Button>
                <Button
                  type='button'
                  variant='outline'
                  size='xl'
                  className='w-full'
                  disabled={isSettling}
                  onClick={close}
                >
                  {mixChain ? t`Finish` : t`Back to ${languageName}`}
                </Button>
              </>
            ) : (
              <Button type='button' size='xl' className='w-full' disabled={isSettling} onClick={close}>
                {mixChain ? t`Finish` : t`Back to ${languageName}`}
                {showKbd && <Kbd>↵</Kbd>}
              </Button>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (!current) return wrap(<PracticeLoader label={t`Preparing your session…`} />)

  // One queue-status row for every item type: peek chevrons framing the
  // remaining-count chips. The back chevron is withheld while a live exercise
  // (or flashcard hint) is displayed — peeking away unmounts it, and
  // remounting an already-answered (consumed) exercise would offer options
  // that can no longer be submitted. (`liveExerciseDisplayed` is derived above
  // the early returns, next to the hotkey bindings that share it.)
  const statusRow = (
    <div className='flex items-center justify-between gap-2'>
      <Button
        type='button'
        variant='ghost'
        size='icon'
        aria-label={t`Previous card`}
        disabled={displayedIndex <= 0 || liveExerciseDisplayed}
        onClick={() => setPeekBack((p) => p + 1)}
      >
        <ChevronLeft className='h-5 w-5' />
      </Button>
      {remainingCounts && <ReviewQueueStats counts={remainingCounts} />}
      <Button
        type='button'
        variant='ghost'
        size='icon'
        aria-label={t`Forward`}
        disabled={!isPeeking}
        onClick={() => setPeekBack((p) => Math.max(0, p - 1))}
      >
        <ChevronRight className='h-5 w-5' />
      </Button>
    </div>
  )

  // ----- Exercise items render through the shared exercise components
  // (ExerciseLayout), with the shared status row in their bottom bar. -----
  if (current.type === 'exercise') {
    const entry = current.entry
    const copyVariant = copyVariantFor(entry.origin)
    // A live 'generating' placeholder can swap in place to a cloze on the next
    // poll (exerciseType is null until it's ready), so it must not name the
    // headword either. Peeked placeholders are behind the live index and never
    // swap, so naming is safe there (the peek body shows the headword anyway).
    const headerLeaksAnswer =
      entry.exerciseType === 'mc_cloze' ||
      entry.exerciseType === 'production_cloze' ||
      (entry.status === 'generating' && !isPeeking)
    const trackLabel = entry.track === 'gate' ? (copyVariant === 'warmup' ? t`Warm-up` : t`Rehab`) : t`Practice`
    // No position counter here: the composed queue grows mid-session
    // (Again-redrills append), so position/total reads as broken. The status
    // row's chips are the queue-status UI.
    const header = (
      <ExerciseHeader
        icon={<Dumbbell className='h-3.5 w-3.5' />}
        label={trackLabel}
        headword={headerLeaksAnswer ? null : entry.headword}
      />
    )

    // Peeked exercise: read-only outcome — a consumed exercise can't be
    // re-answered, so there is nothing interactive to restore. The status
    // row's chevrons keep the peek walk going past exercises to earlier
    // flashcards.
    if (isPeeking) {
      return wrap(
        <AnsweredExercisePanel
          outcome={exerciseOutcomesRef.current.get(current) ?? null}
          headword={entry.headword}
          targetLanguage={targetLanguage}
          header={header}
          statusBar={statusRow}
          actionLabel={t`Back to current card`}
          onAction={() => setPeekBack(0)}
          showKbd={showKbd}
        />
      )
    }

    // Resumed onto an exercise answered before the detour: read-only outcome
    // with a Next that advances (see restoredAnsweredItem above).
    const restoredOutcome = current === restoredAnsweredItem ? exerciseOutcomesRef.current.get(current) : undefined
    if (restoredOutcome) {
      return wrap(
        <AnsweredExercisePanel
          outcome={restoredOutcome}
          headword={entry.headword}
          targetLanguage={targetLanguage}
          header={header}
          statusBar={statusRow}
          actionLabel={t`Next`}
          onAction={advance}
          showKbd={showKbd}
        />
      )
    }

    const handleAnswered = (data: ExerciseAnswerData) => {
      exerciseOutcomesRef.current.set(current, data)
      setCurrentAnswered(true)
    }

    if (entry.status === 'failed') {
      return wrap(
        <FailedExercisePlaceholder
          headword={entry.headword}
          userLookupId={entry.userLookupId}
          pool={entry.pool}
          header={header}
          statusBar={statusRow}
          showKbd={showKbd}
          hotkeysEnabled={!actionsOpen}
          onAdvance={advance}
        />
      )
    }
    if (entry.status === 'generating' || !entry.exerciseId || !entry.payload) {
      return wrap(
        <ExerciseLayout
          header={header}
          statusBar={statusRow}
          actions={
            <Button type='button' variant='outline' size='xl' className='w-full' onClick={advance}>
              {t`Skip`}
              {showKbd && <Kbd>S</Kbd>}
            </Button>
          }
        >
          <div className='flex flex-col items-center gap-4 py-10 text-center'>
            <Hourglass className='text-muted-foreground h-8 w-8 animate-pulse' />
            <p className='text-muted-foreground text-sm'>
              {/* Deliberately headword-less: this placeholder can swap in place
                  to a cloze whose answer is the headword. */}
              {t`Your next exercise is still being prepared — it'll appear here automatically.`}
            </p>
          </div>
        </ExerciseLayout>
      )
    }
    if (entry.payload.type === 'mc_cloze' || entry.payload.type === 'mc_comprehension') {
      return wrap(
        <McExercise
          key={entry.exerciseId}
          exerciseId={entry.exerciseId}
          payload={entry.payload}
          targetLanguage={targetLanguage}
          meaning={resolveMeaning(entry)}
          header={header}
          statusBar={statusRow}
          copyVariant={copyVariant}
          hotkeysEnabled={!actionsOpen}
          onAnswered={handleAnswered}
          onNext={advance}
        />
      )
    }
    if (entry.payload.type === 'production_cloze') {
      return wrap(
        <ProductionClozeExercise
          key={entry.exerciseId}
          exerciseId={entry.exerciseId}
          payload={entry.payload}
          targetLanguage={targetLanguage}
          meaning={resolveMeaning(entry)}
          header={header}
          statusBar={statusRow}
          copyVariant={copyVariant}
          hotkeysEnabled={!actionsOpen}
          onAnswered={handleAnswered}
          onNext={advance}
        />
      )
    }
    return wrap(
      <UseInSentenceExercise
        key={entry.exerciseId}
        exerciseId={entry.exerciseId}
        payload={entry.payload}
        meaning={resolveMeaning(entry)}
        header={header}
        statusBar={statusRow}
        hotkeysEnabled={!actionsOpen}
        onAnswered={handleAnswered}
        onNext={advance}
      />
    )
  }

  // ----- Flashcard items. -----
  const card = current.card

  // Hint mode: the MC exercise swapped in for the live card. Answering
  // consumes the exercise and locks the rating (correct → hard, wrong →
  // again); "Show answer" then reveals the card back, where Continue applies
  // it through the normal handleRate machinery (redrill, records, leech
  // toast). Backing out before answering consumes nothing — the same exercise
  // re-serves on the next hint press.
  if (activeHint && activeHint.item === current) {
    const hintHeader = <ExerciseHeader icon={<Lightbulb className='h-3.5 w-3.5' />} label={t`Hint`} />
    return wrap(
      <McExercise
        key={activeHint.exerciseId}
        exerciseId={activeHint.exerciseId}
        payload={activeHint.payload}
        targetLanguage={targetLanguage}
        meaning={resolveMeaning(card)}
        header={hintHeader}
        statusBar={statusRow}
        nextLabel={t`Show answer`}
        skipLabel={t`Back to card`}
        hotkeysEnabled={!actionsOpen}
        onAnswered={(data) =>
          setHintOutcome({ item: current, correct: data.correct, rating: data.correct ? 'hard' : 'again' })
        }
        onNext={() => {
          setActiveHint(null)
          if (hintOutcome?.item === current) setRevealed(true)
        }}
      />
    )
  }

  // Peeked cards are always shown fully (front + back), read-only.
  // (`servableHint`, `currentHintOutcome` and the peek re-rate state are
  // derived above the early returns, next to the hotkey bindings.)
  const showBack = revealed || isPeeking

  return wrap(
    <div className='flex flex-1 flex-col overflow-hidden'>
      <div className='flex-1 overflow-y-auto'>
        <div className='mx-auto flex w-full max-w-xl flex-col items-center gap-4 px-4 py-8 text-center'>
          <FlashcardFace card={card} targetLanguage={targetLanguage} showBack={showBack} />
        </div>
      </div>
      <div className='bg-background border-t px-4 py-3'>
        <div className='mx-auto flex w-full max-w-xl flex-col gap-3'>
          {statusRow}
          {isPeeking ? (
            <>
              {canRerate && peekRecord && (
                <div className='flex flex-col gap-1.5'>
                  <p className='text-muted-foreground text-center text-xs'>{t`Change your rating`}</p>
                  <RateButtons
                    value={peekRecord.rating}
                    disabled={pendingRerate != null}
                    showKbdHints={showKbd}
                    onSelect={(value) => handleRerate(current, value)}
                  />
                </div>
              )}
              <Button type='button' size='xl' variant='outline' className='w-full' onClick={() => setPeekBack(0)}>
                {t`Back to current card`}
                {showKbd && <Kbd>↵</Kbd>}
              </Button>
            </>
          ) : showBack ? (
            currentHintOutcome ? (
              // The hint fixed the rating; the back is for studying, not
              // re-grading — a single Continue applies it and advances.
              <div className='flex flex-col gap-1.5'>
                <p className='text-muted-foreground text-center text-xs'>
                  {currentHintOutcome.correct
                    ? t`Hint used — this card counts as Hard.`
                    : t`Hint used — this card counts as Again.`}
                </p>
                <Button
                  type='button'
                  size='xl'
                  className='w-full'
                  onClick={() => handleRate(currentHintOutcome.rating)}
                >
                  {t`Continue`}
                  {showKbd && <Kbd>↵</Kbd>}
                </Button>
              </div>
            ) : (
              <RateButtons showKbdHints={showKbd} onSelect={handleRate} />
            )
          ) : servableHint ? (
            <div className='flex gap-2'>
              <Button
                type='button'
                variant='outline'
                size='xl'
                className='flex-1'
                onClick={() =>
                  setActiveHint({ item: current, exerciseId: servableHint.exerciseId, payload: servableHint.payload })
                }
              >
                <Lightbulb className='h-4 w-4' />
                {t`Hint`}
                {showKbd && <Kbd>H</Kbd>}
              </Button>
              <Button type='button' size='xl' className='flex-1' onClick={() => setRevealed(true)}>
                {t`Show answer`}
                {showKbd && <Kbd>Space</Kbd>}
              </Button>
            </div>
          ) : (
            <Button type='button' size='xl' className='w-full' onClick={() => setRevealed(true)}>
              {t`Show answer`}
              {showKbd && <Kbd>Space</Kbd>}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
