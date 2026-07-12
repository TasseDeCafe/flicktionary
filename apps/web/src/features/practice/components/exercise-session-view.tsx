import { useEffect, useRef, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { CircleCheck, Dumbbell, Flame, Hourglass, MoreVertical } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { Kbd } from '@flicktionary/ui/components/kbd'
import { useIsMobile } from '@flicktionary/ui/hooks/use-is-mobile'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import { useHotkeys } from '@/hooks/use-hotkeys'
import type { StrengthenExerciseEntry } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { mergePlaceholders } from './exercise-queue-merge'
import { PracticeLoader } from './practice-loader'
import { ExerciseHeader } from './exercise-header'
import { ExerciseLayout } from './exercise-layout'
import { FailedExercisePlaceholder } from './failed-exercise-placeholder'
import { McExercise } from './mc-exercise'
import { ProductionClozeExercise } from './production-cloze-exercise'
import { UseInSentenceExercise } from './use-in-sentence-exercise'
import { TermActionsOverlay } from './term-actions-overlay'
import type { ExerciseAnswerData, ExerciseCopyVariant } from './strengthen-types'
import { useTermMeaning } from '../utils/use-term-meaning'

const POLL_INTERVAL_MS = 4000

type ExerciseSessionProps = {
  title: string
  copyVariant: ExerciseCopyVariant
  isError: boolean
  dailyLimitReached?: boolean
  backLabel: string
  // Optional serve-only re-fetch, polled while a placeholder is still ahead in
  // the queue so it can be swapped in place. Returns the latest entries, or null
  // on a failed poll (left for the next tick).
  pollExercises?: () => Promise<StrengthenExerciseEntry[] | null>
  onClose: () => void
  targetLanguage: string
  // Threaded into the header kebab's Edit-term deep-link so the focus view's
  // close re-enters THIS session (serving is resume-safe server-side).
  practiceMode: 'strengthen' | 'warmup'
  practiceStudySessionId?: string
  practiceSessionHard?: string[]
}

// The shared exercise-queue session screen behind both Strengthen (leech rehab
// + bonus) and Warm-up (exercise-first onboarding). The two differ only in
// fetch source — the caller passes entries (and an optional `pollExercises` for
// live placeholder updates) — and in copy, which `copyVariant` selects. Both
// callers set `entries` exactly once (a one-shot start mutation), so the loaded
// session mounts once and seeds its local queue from that snapshot.
export const ExerciseSessionView = ({
  entries,
  ...props
}: ExerciseSessionProps & { entries: StrengthenExerciseEntry[] | null }) => {
  const { t } = useLingui()

  if (entries === null) {
    return (
      <ModalScreen onClose={props.onClose} closeIcon='x' title={props.title}>
        <div className='flex flex-1 flex-col overflow-hidden'>
          {props.isError ? (
            <div className='flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center'>
              <p className='text-lg font-semibold'>{t`Couldn't load exercises.`}</p>
              <Button type='button' size='lg' onClick={props.onClose}>
                {props.backLabel}
              </Button>
            </div>
          ) : (
            <PracticeLoader label={t`Preparing exercises…`} />
          )}
        </div>
      </ModalScreen>
    )
  }

  return <LoadedExerciseSessionView {...props} initialEntries={entries} />
}

const LoadedExerciseSessionView = ({
  title,
  copyVariant,
  initialEntries,
  dailyLimitReached,
  backLabel,
  pollExercises,
  onClose,
  targetLanguage,
  practiceMode,
  practiceStudySessionId,
  practiceSessionHard,
}: ExerciseSessionProps & { initialEntries: StrengthenExerciseEntry[] }) => {
  const { t } = useLingui()
  const isMobile = useIsMobile()
  const showKbd = !isMobile
  const resolveMeaning = useTermMeaning(targetLanguage)
  // A one-shot snapshot of the caller's load, served once (the server consumes
  // an exercise per answered attempt; abandoning before answering re-serves
  // it). Later polls mutate this local copy in place.
  const [queue, setQueue] = useState(initialEntries)
  const [index, setIndex] = useState(0)
  const [correctCount, setCorrectCount] = useState(0)
  const [actionsOpen, setActionsOpen] = useState(false)
  // Whether the current exercise has been answered — gates the header kebab on
  // unanswered cloze exercises (see kebab derivation below).
  const [currentAnswered, setCurrentAnswered] = useState(false)

  // Poll for placeholder upgrades while a 'generating' entry is still ahead of
  // (or at) the current position. A ref guards against overlapping requests.
  const pollingRef = useRef(false)
  const hasPendingAhead = queue.slice(index).some((e) => e.status === 'generating')
  useEffect(() => {
    if (!pollExercises || !hasPendingAhead) return
    const interval = setInterval(async () => {
      if (pollingRef.current) return
      pollingRef.current = true
      try {
        const fresh = await pollExercises()
        if (fresh) setQueue((prev) => mergePlaceholders(prev, fresh, index))
      } catch {
        // Polling is best-effort; keep the placeholder and try again next tick.
      } finally {
        pollingRef.current = false
      }
    }, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [pollExercises, hasPendingAhead, index])

  const handleAnswered = (data: ExerciseAnswerData) => {
    if (data.correct) setCorrectCount((n) => n + 1)
    setCurrentAnswered(true)
  }
  const handleNext = () => {
    setCurrentAnswered(false)
    setIndex((i) => i + 1)
  }

  const current = queue[index] ?? null
  const total = queue.length

  // Live ready exercises run their own hotkeys inside the exercise components;
  // the host only covers the still-generating placeholders, whose single
  // action is Skip. Terminally 'failed' placeholders render the
  // FailedExercisePlaceholder decision card, which owns its own hotkeys.
  const placeholderDisplayed =
    !!current &&
    current.status !== 'failed' &&
    (current.status === 'generating' || !current.exerciseId || !current.payload)
  useHotkeys(
    [
      { key: 's', enabled: placeholderDisplayed, onPress: handleNext },
      { key: 'escape', enabled: placeholderDisplayed, onPress: handleNext },
      { key: 'enter', enabled: placeholderDisplayed, onPress: handleNext },
      { key: 'space', enabled: placeholderDisplayed, onPress: handleNext },
      // Empty and all-done states: Enter closes back to the caller.
      { key: 'enter', enabled: current == null, onPress: onClose },
    ],
    !actionsOpen
  )

  // The header kebab (Edit term) is withheld while it could spoil an answer
  // (the menu title + focus view reveal the headword): an unanswered cloze
  // exercise (the headword IS the cloze answer), or a 'generating' placeholder,
  // which can swap in place to a cloze on the next poll. Same rule as the
  // composed queue's kebab.
  const couldSpoilClozeAnswer =
    !!current &&
    !currentAnswered &&
    (current.status === 'generating' ||
      current.payload?.type === 'mc_cloze' ||
      current.payload?.type === 'production_cloze')
  const actionsTerm = current && !couldSpoilClozeAnswer ? current : null

  const dailyLimitNote = dailyLimitReached ? (
    <div className='flex items-center justify-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800'>
      <Flame className='h-4 w-4 shrink-0' />
      {t`Daily new-term limit reached — the rest of these terms will warm up tomorrow.`}
    </div>
  ) : null

  return (
    <ModalScreen
      onClose={onClose}
      closeIcon='x'
      title={title}
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
      {actionsTerm && (
        <TermActionsOverlay
          open={actionsOpen}
          onOpenChange={setActionsOpen}
          term={actionsTerm}
          targetLanguage={targetLanguage}
          pool={actionsTerm.pool}
          practiceMode={practiceMode}
          practiceStudySessionId={practiceStudySessionId}
          practiceSessionHard={practiceSessionHard}
        />
      )}
      <div className='flex flex-1 flex-col overflow-hidden'>
        {queue.length === 0 && (
          <div className='flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center'>
            <CircleCheck className='h-10 w-10 text-emerald-600' />
            <p className='text-lg font-semibold'>
              {copyVariant === 'warmup' ? t`Nothing to warm up right now.` : t`Nothing to strengthen right now.`}
            </p>
            {dailyLimitNote}
            <Button type='button' size='lg' onClick={onClose}>
              {backLabel}
              {showKbd && <Kbd>↵</Kbd>}
            </Button>
          </div>
        )}

        {queue.length > 0 && !current && (
          <div className='flex flex-1 flex-col overflow-hidden'>
            <div className='flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center'>
              <CircleCheck className='h-10 w-10 text-emerald-600' />
              <p className='text-lg font-semibold'>
                {copyVariant === 'warmup' ? t`Warm-up done!` : t`Strengthening done!`}
              </p>
              <p className='text-muted-foreground text-sm'>{t`${correctCount} of ${total} correct.`}</p>
              {dailyLimitNote}
            </div>
            <div className='bg-background border-t px-4 pt-2 pb-3'>
              <div className='mx-auto w-full max-w-xl'>
                <Button type='button' size='xl' className='w-full' onClick={onClose}>
                  {backLabel}
                  {showKbd && <Kbd>↵</Kbd>}
                </Button>
              </div>
            </div>
          </div>
        )}

        {current &&
          (() => {
            // The headword IS the answer for cloze types (it fills the blank),
            // so naming it in the header would give the exercise away. It's
            // fine for mc_comprehension (the term is visible in the sentence),
            // use_in_sentence (the term is the task), and terminally 'failed'
            // placeholders (nothing will show). A 'generating' placeholder is
            // NOT safe: it can swap in place to a cloze on the next poll
            // (exerciseType is null until it's ready).
            const headerLeaksAnswer =
              current.exerciseType === 'mc_cloze' ||
              current.exerciseType === 'production_cloze' ||
              current.status === 'generating'
            const trackLabel =
              current.track === 'gate' ? (copyVariant === 'warmup' ? t`Warm-up` : t`Rehab`) : t`Practice`
            // This queue is static and exercises-only, so a position counter
            // is honest here (unlike the composed queue, which grows with
            // Again-redrills and shows remaining-count chips instead).
            const header = (
              <ExerciseHeader
                icon={<Dumbbell className='h-3.5 w-3.5' />}
                label={trackLabel}
                headword={headerLeaksAnswer ? null : current.headword}
                counter={`${index + 1} / ${total}`}
              />
            )

            // Terminal failure: generation is exhausted for this term — don't
            // make the user wait on an hourglass that will never resolve.
            if (current.status === 'failed') {
              return (
                <FailedExercisePlaceholder
                  headword={current.headword}
                  userLookupId={current.userLookupId}
                  pool={current.pool}
                  header={header}
                  showKbd={showKbd}
                  hotkeysEnabled={!actionsOpen}
                  onAdvance={handleNext}
                />
              )
            }

            if (current.status === 'generating' || !current.exerciseId || !current.payload) {
              return (
                <ExerciseLayout
                  header={header}
                  actions={
                    <Button type='button' variant='outline' size='xl' className='w-full' onClick={handleNext}>
                      {t`Skip`}
                      {showKbd && <Kbd>S</Kbd>}
                    </Button>
                  }
                >
                  <div className='flex flex-col items-center gap-4 py-10 text-center'>
                    <Hourglass className='text-muted-foreground h-8 w-8 animate-pulse' />
                    <p className='text-muted-foreground text-sm'>
                      {/* Deliberately headword-less: this placeholder can swap
                          in place to a cloze whose answer is the headword. */}
                      {t`Your next exercise is still being prepared — it'll appear here automatically.`}
                    </p>
                  </div>
                </ExerciseLayout>
              )
            }
            if (current.payload.type === 'mc_cloze' || current.payload.type === 'mc_comprehension') {
              return (
                <McExercise
                  key={current.exerciseId}
                  exerciseId={current.exerciseId}
                  payload={current.payload}
                  targetLanguage={targetLanguage}
                  meaning={resolveMeaning(current)}
                  header={header}
                  copyVariant={copyVariant}
                  hotkeysEnabled={!actionsOpen}
                  onAnswered={handleAnswered}
                  onNext={handleNext}
                />
              )
            }
            if (current.payload.type === 'production_cloze') {
              return (
                <ProductionClozeExercise
                  key={current.exerciseId}
                  exerciseId={current.exerciseId}
                  payload={current.payload}
                  targetLanguage={targetLanguage}
                  meaning={resolveMeaning(current)}
                  header={header}
                  copyVariant={copyVariant}
                  hotkeysEnabled={!actionsOpen}
                  onAnswered={handleAnswered}
                  onNext={handleNext}
                />
              )
            }
            return (
              <UseInSentenceExercise
                key={current.exerciseId}
                exerciseId={current.exerciseId}
                payload={current.payload}
                meaning={resolveMeaning(current)}
                header={header}
                hotkeysEnabled={!actionsOpen}
                onAnswered={handleAnswered}
                onNext={handleNext}
              />
            )
          })()}
      </div>
    </ModalScreen>
  )
}
