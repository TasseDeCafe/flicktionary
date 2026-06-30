import { useEffect, useRef, useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { CircleAlert, CircleCheck, Dumbbell, Flame, Hourglass } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import type { StrengthenExerciseEntry } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { mergePlaceholders } from './exercise-queue-merge'
import { PracticeLoader } from './practice-loader'
import { ExerciseLayout } from './exercise-layout'
import { McExercise } from './mc-exercise'
import { ProductionClozeExercise } from './production-cloze-exercise'
import { UseInSentenceExercise } from './use-in-sentence-exercise'
import type { ExerciseAnswerData, ExerciseCopyVariant } from './strengthen-types'

const POLL_INTERVAL_MS = 4000

// The shared exercise-queue session screen behind both Strengthen (leech rehab
// + bonus) and Warm-up (exercise-first onboarding). The two differ only in
// fetch source — the caller passes entries (and an optional `pollExercises` for
// live placeholder updates) — and in copy, which `copyVariant` selects. A local
// queue is served once (the server consumes an exercise per answered attempt;
// abandoning before answering re-serves it).
export const ExerciseSessionView = ({
  title,
  copyVariant,
  entries,
  isPending,
  isError,
  dailyLimitReached,
  backLabel,
  pollExercises,
  onClose,
}: {
  title: string
  copyVariant: ExerciseCopyVariant
  entries: StrengthenExerciseEntry[] | null
  isPending: boolean
  isError: boolean
  dailyLimitReached?: boolean
  backLabel: string
  // Optional serve-only re-fetch, polled while a placeholder is still ahead in
  // the queue so it can be swapped in place. Returns the latest entries, or null
  // on a failed poll (left for the next tick).
  pollExercises?: () => Promise<StrengthenExerciseEntry[] | null>
  onClose: () => void
}) => {
  const { t } = useLingui()
  const [queue, setQueue] = useState<StrengthenExerciseEntry[] | null>(null)
  const [index, setIndex] = useState(0)
  const [correctCount, setCorrectCount] = useState(0)

  // Seed the local queue from the parent's first load; later polls mutate the
  // local copy in place.
  useEffect(() => {
    if (entries && queue === null) setQueue(entries)
  }, [entries, queue])

  // Poll for placeholder upgrades while a 'generating' entry is still ahead of
  // (or at) the current position. A ref guards against overlapping requests.
  const pollingRef = useRef(false)
  const hasPendingAhead = queue?.slice(index).some((e) => e.status === 'generating') ?? false
  useEffect(() => {
    if (!pollExercises || !hasPendingAhead) return
    const interval = setInterval(async () => {
      if (pollingRef.current) return
      pollingRef.current = true
      try {
        const fresh = await pollExercises()
        if (fresh) setQueue((prev) => (prev ? mergePlaceholders(prev, fresh, index) : prev))
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
  }
  const handleNext = () => setIndex((i) => i + 1)

  const current = queue?.[index] ?? null
  const total = queue?.length ?? 0
  const currentHeadword = current?.headword ?? ''

  const dailyLimitNote = dailyLimitReached ? (
    <div className='flex items-center justify-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800'>
      <Flame className='h-4 w-4 shrink-0' />
      {t`Daily new-term limit reached — the rest of these terms will warm up tomorrow.`}
    </div>
  ) : null

  return (
    <ModalScreen onClose={onClose} closeIcon='x' title={title}>
      <div className='flex flex-1 flex-col overflow-hidden'>
        {(isPending || queue === null) && !isError && <PracticeLoader label={t`Preparing exercises…`} />}

        {isError && (
          <div className='flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center'>
            <p className='text-lg font-semibold'>{t`Couldn't load exercises.`}</p>
            <Button type='button' size='lg' onClick={onClose}>
              {backLabel}
            </Button>
          </div>
        )}

        {queue !== null && queue.length === 0 && (
          <div className='flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center'>
            <CircleCheck className='h-10 w-10 text-emerald-600' />
            <p className='text-lg font-semibold'>
              {copyVariant === 'warmup' ? t`Nothing to warm up right now.` : t`Nothing to strengthen right now.`}
            </p>
            {dailyLimitNote}
            <Button type='button' size='lg' onClick={onClose}>
              {backLabel}
            </Button>
          </div>
        )}

        {queue !== null && queue.length > 0 && !current && (
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
            // use_in_sentence (the term is the task), and placeholders (no
            // exercise content shown).
            const headerLeaksAnswer = current.exerciseType === 'mc_cloze' || current.exerciseType === 'production_cloze'
            const trackLabel =
              current.track === 'gate' ? (copyVariant === 'warmup' ? t`Warm-up` : t`Rehab`) : t`Practice`
            const header = (
              <div className='flex items-center justify-between'>
                <span className='text-muted-foreground inline-flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase'>
                  <Dumbbell className='h-3.5 w-3.5' />
                  {trackLabel}
                  {!headerLeaksAnswer && <> · {current.headword}</>}
                </span>
                <span className='text-muted-foreground text-xs tabular-nums'>
                  {index + 1} / {total}
                </span>
              </div>
            )

            // Terminal failure: generation is exhausted for this term — don't
            // make the user wait on an hourglass that will never resolve.
            if (current.status === 'failed') {
              return (
                <ExerciseLayout
                  header={header}
                  actions={
                    <Button type='button' size='xl' className='w-full' onClick={handleNext}>
                      {t`Skip`}
                    </Button>
                  }
                >
                  <div className='flex flex-col items-center gap-4 py-10 text-center'>
                    <CircleAlert className='text-muted-foreground h-8 w-8' />
                    <p className='text-muted-foreground text-sm'>
                      {t`We couldn't prepare an exercise for “${currentHeadword}” this time. It stays in your queue — skip it for now.`}
                    </p>
                  </div>
                </ExerciseLayout>
              )
            }

            if (current.status === 'generating' || !current.exerciseId || !current.payload) {
              return (
                <ExerciseLayout
                  header={header}
                  actions={
                    <Button type='button' variant='outline' size='xl' className='w-full' onClick={handleNext}>
                      {t`Skip`}
                    </Button>
                  }
                >
                  <div className='flex flex-col items-center gap-4 py-10 text-center'>
                    <Hourglass className='text-muted-foreground h-8 w-8 animate-pulse' />
                    <p className='text-muted-foreground text-sm'>
                      {t`An exercise for “${currentHeadword}” is still being prepared — it'll appear here automatically.`}
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
                  header={header}
                  copyVariant={copyVariant}
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
                  header={header}
                  copyVariant={copyVariant}
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
                header={header}
                onAnswered={handleAnswered}
                onNext={handleNext}
              />
            )
          })()}
      </div>
    </ModalScreen>
  )
}
