import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { toast } from 'sonner'
import {
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  Flame,
  Hourglass,
  Lightbulb,
  Loader2,
  MoreVertical,
  Puzzle,
} from 'lucide-react'
import { useState } from 'react'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { Button } from '@flicktionary/ui/components/button'
import { Kbd } from '@flicktionary/ui/components/kbd'
import { RATE_VALUES, RateButtons } from '@flicktionary/ui/components/rate-buttons'
import { useIsMobile } from '@flicktionary/ui/hooks/use-is-mobile'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import { POSTHOG_EVENTS } from '@/lib/analytics/posthog-events'
import { SuccessCheck } from '@/components/ui/success-check'
import { useHotkeys, type HotkeyBinding } from '@/hooks/use-hotkeys'
import type { PracticeQueueFilter } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import {
  useCardWordFamily,
  useClaimPracticeIntroduction,
  useComposePracticeQueue,
  useHintExercise,
  useRateTerm,
  useRefreshPracticeQueue,
  useUndoRating,
} from '../api/practice-hooks'
import { FlashcardFace, poolForCard } from './flashcard-face'
import { cardWordFamilyParams, frontClueFor } from '../utils/card-word-family'
import { TermActionsOverlay } from './term-actions-overlay'
import { useComposedSession } from './use-composed-session'
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
// re-composes an in-progress session. The session bookkeeping lives in
// useComposedSession; this view renders it.
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

  const { mutate: composeQueue, isPending: composePending, isError: composeError } = useComposePracticeQueue()
  const { mutateAsync: claimIntroduction } = useClaimPracticeIntroduction()
  const { mutateAsync: refreshQueue } = useRefreshPracticeQueue()
  const { mutate: rateTerm } = useRateTerm()
  const { mutate: undoRating } = useUndoRating()

  const session = useComposedSession({
    targetLanguage,
    filter,
    composeQueue,
    rateTerm,
    undoRating,
    claimIntroduction,
    refreshQueue,
    onParked: (headword) => toast.info(t`“${headword}” keeps tripping you up — it's parked for rehab exercises.`),
    onSessionCompleted: ({ totalCount, hardCount }) =>
      POSTHOG_EVENTS.practiceSessionCompleted({
        session_type: 'composed',
        target_language: targetLanguage,
        total_count: totalCount,
        hard_count: hardCount,
        is_daily_mix: mixChain != null,
      }),
  })
  const {
    queue,
    index,
    displayedIndex,
    current,
    isPeeking,
    revealed,
    reveal,
    currentAnswered,
    restoredAnsweredItem,
    dailyLimitReached,
    canLearnExtra,
    capNoticeShown,
    pendingRatings,
    pendingRerate,
    sessionHard: sessionHardSet,
    ratingRecords,
    exerciseOutcomes,
    claimedIntroductionCount,
    introductionBlocked,
    introductionClaimFailed,
    retryIntroductionClaim,
    activeHint,
    hintOutcome,
    openHint,
    answerHint,
    closeHint,
    clueCapped,
    showClue,
    peekRecord,
    canRerate,
    peekOlder,
    peekNewer,
    stopPeeking,
    advance,
    handleRate,
    handleRerate,
    handleLearnExtra,
    recordExerciseAnswer,
    markEnded,
  } = session

  // Deliberate session end (X / Back buttons, error screen): the session
  // skips its unmount save, so the next Practice entry composes fresh.
  const close = () => {
    markEnded()
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
    markEnded()
    void navigate({
      to: '/practice/composed/$targetLanguage',
      params: { targetLanguage: mixUpcoming[0] },
      search: { ...filter, mix },
    })
  }
  const [actionsOpen, setActionsOpen] = useState(false)

  const remainingCounts = queue ? getRemainingCounts(queue, index) : null

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

  // Word-family clue (#516): a recognition front may show the word's
  // structure and the relatives the learner has, before the answer. Same
  // query as the card back's line, so it costs no extra request; the upcoming
  // card's is prefetched so the Clue button is there from its first frame.
  const clueCard = currentCard?.skill === 'meaning_recognition' ? currentCard : null
  const { data: currentWordFamily } = useCardWordFamily(
    clueCard ? cardWordFamilyParams(clueCard, targetLanguage) : null
  )
  useCardWordFamily(upcomingItem?.type === 'flashcard' ? cardWordFamilyParams(upcomingItem.card, targetLanguage) : null)
  const frontClue = clueCard ? frontClueFor(currentWordFamily) : null
  // Using the clue caps the rating at Good — live and on a peek re-rate.
  const clueAvailable = frontClue != null && !revealed && !clueCapped

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
      search: { pool: 'recognition', sessionHard: [...sessionHardSet], mix },
    })
  useHotkeys(
    [
      { key: 'space', enabled: showingFront, onPress: reveal },
      { key: 'enter', enabled: showingFront, onPress: reveal },
      {
        key: 'h',
        enabled: showingFront && servableHint != null,
        onPress: () => {
          if (current && servableHint) {
            openHint({ item: current, exerciseId: servableHint.exerciseId, payload: servableHint.payload })
          }
        },
      },
      { key: 'c', enabled: showingFront && clueAvailable, onPress: showClue },
      ...RATE_VALUES.map((value, index): HotkeyBinding => ({
        key: String(index + 1),
        enabled: showingBack && !currentHintOutcome && !(value === 'easy' && clueCapped),
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
        onPress: peekOlder,
      },
      { key: 'arrowright', enabled: isPeeking, onPress: peekNewer },
      ...RATE_VALUES.map((value, index): HotkeyBinding => ({
        key: String(index + 1),
        enabled: peekRerateEnabled && !(value === 'easy' && clueCapped),
        onPress: () => {
          if (current) handleRerate(current, value)
        },
      })),
      { key: 'enter', enabled: isPeeking, onPress: stopPeeking },
      { key: 'space', enabled: isPeeking, onPress: stopPeeking },
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
          if (sessionHardSet.size > 0) openStrengthen()
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
    if (introductionClaimFailed) {
      return wrap(
        <div className='flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center'>
          <p className='text-lg font-semibold'>{t`Couldn't start this exercise.`}</p>
          <Button type='button' size='lg' onClick={retryIntroductionClaim}>
            {t`Try again`}
          </Button>
        </div>
      )
    }
    return wrap(<PracticeLoader label={t`Preparing your next exercise…`} />)
  }

  // Done: live queue exhausted (also the empty-compose case).
  if (!queue[index] && !isPeeking) {
    const sessionHard = [...sessionHardSet]
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
            ratedItems: [...ratingRecords.keys()],
            answeredExercises: [...exerciseOutcomes.keys()],
            claimedIntroductionCount,
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
        <div className='bg-background pb-safe border-t px-4 pt-2'>
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
        onClick={peekOlder}
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
        onClick={peekNewer}
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
          outcome={exerciseOutcomes.get(current) ?? null}
          headword={entry.headword}
          targetLanguage={targetLanguage}
          header={header}
          statusBar={statusRow}
          actionLabel={t`Back to current card`}
          onAction={stopPeeking}
          showKbd={showKbd}
        />
      )
    }

    // Resumed onto an exercise answered before the detour: read-only outcome
    // with a Next that advances (see restoredAnsweredItem above).
    const restoredOutcome = current === restoredAnsweredItem ? exerciseOutcomes.get(current) : undefined
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

    const handleAnswered = (data: ExerciseAnswerData) => recordExerciseAnswer(current, data)

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
        onAnswered={(data) => answerHint(current, data.correct)}
        onNext={closeHint}
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
          <FlashcardFace
            card={card}
            targetLanguage={targetLanguage}
            showBack={showBack}
            frontClue={clueCapped && !isPeeking ? frontClue : null}
          />
        </div>
      </div>
      <div className='bg-background pb-safe border-t px-4 pt-3'>
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
                    disabledValues={clueCapped ? ['easy'] : undefined}
                    showKbdHints={showKbd}
                    onSelect={(value) => handleRerate(current, value)}
                  />
                </div>
              )}
              <Button type='button' size='xl' variant='outline' className='w-full' onClick={stopPeeking}>
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
            ) : clueCapped ? (
              <div className='flex flex-col gap-1.5'>
                <p className='text-muted-foreground text-center text-xs'>{t`Clue used — Easy is off for this card.`}</p>
                <RateButtons showKbdHints={showKbd} disabledValues={['easy']} onSelect={handleRate} />
              </div>
            ) : (
              <RateButtons showKbdHints={showKbd} onSelect={handleRate} />
            )
          ) : (
            <div className='flex gap-2'>
              {clueAvailable && (
                <Button type='button' variant='outline' size='xl' className='flex-1' onClick={showClue}>
                  <Puzzle className='h-4 w-4' />
                  {t`Clue`}
                  {showKbd && <Kbd>C</Kbd>}
                </Button>
              )}
              {servableHint && (
                <Button
                  type='button'
                  variant='outline'
                  size='xl'
                  className='flex-1'
                  onClick={() =>
                    openHint({ item: current, exerciseId: servableHint.exerciseId, payload: servableHint.payload })
                  }
                >
                  <Lightbulb className='h-4 w-4' />
                  {t`Hint`}
                  {showKbd && <Kbd>H</Kbd>}
                </Button>
              )}
              <Button type='button' size='xl' className='flex-1' onClick={reveal}>
                {t`Show answer`}
                {showKbd && <Kbd>Space</Kbd>}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
