import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { toast } from 'sonner'
import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleX,
  Dumbbell,
  Flame,
  Hourglass,
  Lightbulb,
  MoreVertical,
} from 'lucide-react'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { Button } from '@flicktionary/ui/components/button'
import { RateButtons, type RateValue } from '@flicktionary/ui/components/rate-buttons'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import type {
  PracticeQueueFilter,
  StrengthenExercisePayload,
} from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import {
  useComposePracticeQueue,
  useHintExercise,
  useRateTerm,
  useRefreshPracticeQueue,
  useUndoRating,
} from '../api/practice-hooks'
import { FlashcardFace, poolForCard } from './flashcard-face'
import { TermActionsOverlay } from './term-actions-overlay'
import { mergeComposedPlaceholders, toComposedQueueItem, type ComposedQueueItem } from './composed-queue-merge'
import { ReviewQueueStats } from './review-queue-stats'
import type { QueueCounts } from './review-counts'
import { PracticeLoader } from './practice-loader'
import { ExerciseHeader } from './exercise-header'
import { ExerciseLayout } from './exercise-layout'
import { McExercise } from './mc-exercise'
import { ProductionClozeExercise } from './production-cloze-exercise'
import { UseInSentenceExercise } from './use-in-sentence-exercise'
import type { ExerciseAnswerData, ExerciseCopyVariant } from './strengthen-types'

const POLL_INTERVAL_MS = 4000

// A persistently-failing rateTerm mutation re-appends its card to the queue end
// (so it isn't silently lost) — capped so a hard failure can't loop forever.
const MAX_RATE_RETRIES = 2

// One durably-applied rating, keyed by the queue item it rated (object
// identity — same identity scheme as the redrill machinery). `eventId` is the
// undo handle the rating response returned; `redrill` is the in-session copy
// an 'again' rating appended (null otherwise), so a re-rate can reconcile it.
type RatingRecord = {
  rating: RateValue
  eventId: string
  redrill: ComposedQueueItem | null
}

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

const getRemainingCounts = (queue: ComposedQueueItem[], index: number): QueueCounts =>
  queue.slice(index).reduce<QueueCounts>(
    (counts, item) => {
      if (item.type === 'exercise') {
        // Bucket by learning stage, not render type: a warm-up gate is the
        // term's first encounter, a rehab gate is a term being re-learned.
        // (Bonus entries — null origin — never reach the composed queue.)
        if (item.entry.origin === 'onboarding') counts.new += 1
        else counts.learning += 1
        return counts
      }
      if (item.requeuedForAgain) {
        counts.learning += 1
        return counts
      }
      switch (item.card.srsState) {
        case null:
          counts.new += 1
          break
        case 'review':
          counts.review += 1
          break
        case 'new':
        case 'learning':
        case 'relearning':
          counts.learning += 1
          break
      }
      return counts
    },
    { new: 0, learning: 0, review: 0 }
  )

const copyVariantFor = (origin: 'onboarding' | 'leech' | null): ExerciseCopyVariant =>
  origin === 'leech' ? 'rehab' : 'warmup'

type ComposedPracticeViewProps = {
  targetLanguage: string
  filter: PracticeQueueFilter
}

// The unified Practice session: ONE local queue mixing gate exercises (parked
// warm-up + rehab terms) and due flashcards, served by composePracticeQueue
// (production-first ordering is the server's). One-shot snapshot: the queue is
// seeded from the compose response; the serve-only refresh poll only upgrades
// exercise placeholders in place, never appends.
export const ComposedPracticeView = ({ targetLanguage, filter }: ComposedPracticeViewProps) => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const languageName = getLanguageName(targetLanguage)
  const close = () => void navigate({ to: '/practice/language/$targetLanguage', params: { targetLanguage } })

  const { mutate: composeQueue, isPending: composePending, isError: composeError } = useComposePracticeQueue()
  const { mutateAsync: refreshQueue } = useRefreshPracticeQueue()
  const { mutate: rateTerm } = useRateTerm()
  const { mutate: undoRating } = useUndoRating()

  const [queue, setQueue] = useState<ComposedQueueItem[] | null>(null)
  const [index, setIndex] = useState(0)
  // Mirror of `index` for async rate callbacks: rolling back an optimistic
  // redrill copy must know whether the copy was already consumed.
  const indexRef = useRef(0)
  const [revealed, setRevealed] = useState(false)
  const [capNoticeShown, setCapNoticeShown] = useState(false)
  const [dailyLimitReached, setDailyLimitReached] = useState(false)
  // Peek-back: how many items behind the live index we're re-viewing read-only.
  const [peekBack, setPeekBack] = useState(0)
  const startedRef = useRef(false)
  // Terms rated again/hard this session — offered post-session Strengthen
  // exercises. Parked terms are exercises here (never flashcards), so the set
  // stays non-parked by construction.
  const sessionHardRef = useRef<Set<string>>(new Set())
  // Durably-applied ratings keyed by queue-item identity: an entry exists ⇔
  // the rating landed server-side with an undoable event. Drives the peek
  // re-rate buttons (flashcard items only — a consumed exercise can't be
  // un-answered).
  const ratingRecordsRef = useRef<Map<ComposedQueueItem, RatingRecord>>(new Map())
  // Answered-exercise outcomes, for the read-only peek display.
  const exerciseOutcomesRef = useRef<Map<ComposedQueueItem, ExerciseAnswerData>>(new Map())
  // The peeked item whose undo→re-rate chain is in flight (disables the peek
  // rate buttons until the chain settles).
  const [pendingRerate, setPendingRerate] = useState<ComposedQueueItem | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)
  // Whether the live-index exercise has been answered — gates the header kebab
  // on unanswered cloze exercises (see kebab derivation below).
  const [currentAnswered, setCurrentAnswered] = useState(false)
  // Flashcard hint: the MC exercise currently swapped in for the live card,
  // and the locked-in rating once it's answered (correct → hard, wrong →
  // again). Both are keyed to the queue item and cleared on advance.
  const [activeHint, setActiveHint] = useState<ActiveHint | null>(null)
  const [hintOutcome, setHintOutcome] = useState<HintOutcome | null>(null)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    composeQueue(
      { targetLanguage, filter },
      {
        onSuccess: (resp) => {
          setQueue(resp.data.items.map(toComposedQueueItem))
          setDailyLimitReached(resp.data.dailyLimitReached)
        },
      }
    )
  }, [composeQueue, targetLanguage, filter])

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
        const resp = await refreshQueue({ targetLanguage, filter })
        setQueue((prev) => (prev ? mergeComposedPlaceholders(prev, resp.data.items, index) : prev))
      } catch {
        // Polling is best-effort; keep the placeholder and try again next tick.
      } finally {
        pollingRef.current = false
      }
    }, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [refreshQueue, targetLanguage, filter, hasPendingAhead, index])

  const remainingCounts = queue ? getRemainingCounts(queue, index) : null
  const isPeeking = peekBack > 0
  const displayedIndex = index - peekBack
  const current = queue?.[displayedIndex]

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
    ratingRecordsRef.current.clear()
    exerciseOutcomesRef.current.clear()
    composeQueue(
      { targetLanguage, filter: { ...filter, learnExtraCount } },
      {
        onSuccess: (resp) => {
          setQueue(resp.data.items.map(toComposedQueueItem))
          setDailyLimitReached(resp.data.dailyLimitReached)
        },
      }
    )
  }

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
  const actionsPool = current ? (current.type === 'exercise' ? current.entry.pool : poolForCard(current.card)) : null

  const wrap = (children: React.ReactNode) => (
    <ModalScreen
      onClose={close}
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
      {actionsTerm && actionsPool && (
        <TermActionsOverlay
          open={actionsOpen}
          onOpenChange={setActionsOpen}
          term={actionsTerm}
          targetLanguage={targetLanguage}
          pool={actionsPool}
          practiceMode='flashcards'
        />
      )}
    </ModalScreen>
  )

  if (composeError) {
    return wrap(
      <div className='flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center'>
        <p className='text-lg font-semibold'>{t`Couldn't load your practice session.`}</p>
        <Button type='button' size='lg' onClick={close}>
          {t`Back to ${languageName}`}
        </Button>
      </div>
    )
  }

  if (composePending || queue === null) {
    return wrap(<PracticeLoader label={t`Preparing your session…`} />)
  }

  // Done: live queue exhausted (also the empty-compose case).
  if (!queue[index] && !isPeeking) {
    const sessionHard = [...sessionHardRef.current]
    const hardCount = sessionHard.length
    const emptyQueueLabel =
      filter.scope === 'new_only'
        ? t`Nothing new to learn right now.`
        : filter.scope === 'due_only'
          ? t`No reviews are due right now.`
          : t`Nothing to practice right now.`
    const openStrengthen = () =>
      void navigate({
        to: '/practice/strengthen/$targetLanguage',
        params: { targetLanguage },
        search: { pool: 'recognition', sessionHard },
      })
    const showLearnExtra = (dailyLimitReached || capNoticeShown) && filter.autoWarmup && filter.scope !== 'due_only'
    return wrap(
      <div className='flex flex-1 flex-col overflow-hidden'>
        <div className='flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center'>
          <CircleCheck className='h-10 w-10 text-emerald-600' />
          <p className='text-lg font-semibold'>{queue.length === 0 ? emptyQueueLabel : t`All done!`}</p>
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
                  <Button key={n} type='button' variant='outline' size='sm' onClick={() => handleLearnExtra(n)}>
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
                <Button type='button' size='xl' className='w-full' onClick={openStrengthen}>
                  <Dumbbell className='h-4 w-4' />
                  {t`Strengthen`}
                </Button>
                <Button type='button' variant='outline' size='xl' className='w-full' onClick={close}>
                  {t`Back to ${languageName}`}
                </Button>
              </>
            ) : (
              <Button type='button' size='xl' className='w-full' onClick={close}>
                {t`Back to ${languageName}`}
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
  // that can no longer be submitted.
  const liveExerciseDisplayed =
    !isPeeking && (current.type === 'exercise' || (activeHint != null && activeHint.item === current))
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
      const outcome = exerciseOutcomesRef.current.get(current)
      return wrap(
        <ExerciseLayout
          header={header}
          statusBar={statusRow}
          actions={
            <Button type='button' size='xl' variant='outline' className='w-full' onClick={() => setPeekBack(0)}>
              {t`Back to current card`}
            </Button>
          }
        >
          <div className='flex flex-col items-center gap-4 py-10 text-center'>
            {outcome ? (
              outcome.correct ? (
                <CircleCheck className='h-8 w-8 text-emerald-600' />
              ) : (
                <CircleX className='text-destructive h-8 w-8' />
              )
            ) : (
              <CircleAlert className='text-muted-foreground h-8 w-8' />
            )}
            <p lang={targetLanguage} className='text-xl font-semibold'>
              {entry.headword}
            </p>
            <p className='text-muted-foreground text-sm'>
              {outcome
                ? outcome.correct
                  ? t`Answered correctly.`
                  : t`Answered incorrectly.`
                : t`Skipped — it re-serves next session.`}
              &nbsp;{t`Exercise answers can't be changed.`}
            </p>
          </div>
        </ExerciseLayout>
      )
    }

    const handleAnswered = (data: ExerciseAnswerData) => {
      exerciseOutcomesRef.current.set(current, data)
      setCurrentAnswered(true)
    }

    if (entry.status === 'failed') {
      const headword = entry.headword
      return wrap(
        <ExerciseLayout
          header={header}
          statusBar={statusRow}
          actions={
            <Button type='button' size='xl' className='w-full' onClick={advance}>
              {t`Skip`}
            </Button>
          }
        >
          <div className='flex flex-col items-center gap-4 py-10 text-center'>
            <CircleAlert className='text-muted-foreground h-8 w-8' />
            <p className='text-muted-foreground text-sm'>
              {t`We couldn't prepare an exercise for “${headword}” this time. It stays in your queue — skip it for now.`}
            </p>
          </div>
        </ExerciseLayout>
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
          header={header}
          statusBar={statusRow}
          copyVariant={copyVariant}
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
          header={header}
          statusBar={statusRow}
          copyVariant={copyVariant}
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
        header={header}
        statusBar={statusRow}
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
        header={hintHeader}
        statusBar={statusRow}
        nextLabel={t`Show answer`}
        skipLabel={t`Back to card`}
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

  // Only an MC payload can render as a hint; the server only serves MC types
  // here, so this narrowing is a type guard, not a filter.
  const servableHint =
    hintExercise != null &&
    (hintExercise.payload.type === 'mc_cloze' || hintExercise.payload.type === 'mc_comprehension')
      ? { exerciseId: hintExercise.exerciseId, payload: hintExercise.payload }
      : null
  const currentHintOutcome = hintOutcome && hintOutcome.item === current ? hintOutcome : null

  // Peeked cards are always shown fully (front + back), read-only.
  const showBack = revealed || isPeeking

  // Peek re-rate: offered when the displayed (peeked) item has a durably
  // applied rating AND its redrill copy wasn't itself rated yet — once the
  // copy is rated, the original's event is no longer the latest live one (the
  // server would refuse the undo too; don't offer dead buttons).
  const peekRecord = isPeeking ? ratingRecordsRef.current.get(current) : undefined
  const canRerate = !!peekRecord && (!peekRecord.redrill || !ratingRecordsRef.current.has(peekRecord.redrill))

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
                    onSelect={(value) => handleRerate(current, value)}
                  />
                </div>
              )}
              <Button type='button' size='xl' variant='outline' className='w-full' onClick={() => setPeekBack(0)}>
                {t`Back to current card`}
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
                </Button>
              </div>
            ) : (
              <RateButtons onSelect={handleRate} />
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
              </Button>
              <Button type='button' size='xl' className='flex-1' onClick={() => setRevealed(true)}>
                {t`Show answer`}
              </Button>
            </div>
          ) : (
            <Button type='button' size='xl' className='w-full' onClick={() => setRevealed(true)}>
              {t`Show answer`}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
