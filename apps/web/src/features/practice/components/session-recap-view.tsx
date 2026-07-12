import { useState } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { CircleCheck, ListChecks } from 'lucide-react'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { Button } from '@flicktionary/ui/components/button'
import { FullViewLoader } from '@flicktionary/ui/components/full-view-loader'
import { Kbd } from '@flicktionary/ui/components/kbd'
import { useIsMobile } from '@flicktionary/ui/hooks/use-is-mobile'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import { useHotkeys } from '@/hooks/use-hotkeys'
import { useListCardsBySession } from '@/features/review/api/review-hooks'
import { useGetUserPrefs } from '@/features/sessions/api/sessions-hooks'
import type { RecapCardInput, RecapQueueItem } from '../utils/build-recap-questions'
import { buildRecapQuestions, buildRecapTerms, buildRedrillQuestion } from '../utils/build-recap-questions'
import { useTermMeaning } from '../utils/use-term-meaning'
import { ExerciseHeader } from './exercise-header'
import { RecapMcExercise } from './recap-mc-exercise'
import { RecapTypedExercise } from './recap-typed-exercise'

// Zero-LLM session recap: a client-side quiz over ALL of the session's kept
// terms, built from card data already in the cache. Deliberately outside the
// SRS — no introductions, no ratings, no daily-new cap — so it can cover the
// whole session the moment reading ends; spaced onboarding still happens at
// the composed Practice queue's own pace.
export const SessionRecapView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { targetLanguage } = useParams({ from: '/_authenticated/_app/practice/recap/$targetLanguage' })
  const { studySessionId } = useSearch({ from: '/_authenticated/_app/practice/recap/$targetLanguage' })
  const languageName = getLanguageName(targetLanguage)

  const { data: cards, isError } = useListCardsBySession(studySessionId)
  const { data: userPrefs } = useGetUserPrefs()

  const close = () => void navigate({ to: '/sessions/$sessionId/review', params: { sessionId: studySessionId } })

  return (
    <ModalScreen onClose={close} closeIcon='x' title={t`Session recap · ${languageName}`}>
      <div className='flex flex-1 flex-col overflow-hidden'>
        {/* The quiz mounts once both async inputs (cards + prefs) have landed —
            the gloss resolver picks translation vs definition off the prefs, so
            building earlier could bake the wrong field into every question. The
            data check comes first so a failed background refetch mid-quiz never
            unmounts a running quiz. */}
        {cards && userPrefs ? (
          <RecapQuiz cards={cards} targetLanguage={targetLanguage} onClose={close} />
        ) : isError ? (
          <div className='flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center'>
            <p className='text-lg font-semibold'>{t`Couldn't load your terms.`}</p>
            <Button type='button' size='lg' onClick={close}>
              {t`Back to session`}
            </Button>
          </div>
        ) : (
          <FullViewLoader />
        )}
      </div>
    </ModalScreen>
  )
}

// The quiz itself, mounted once the inputs are ready. The eligible terms and
// the question queue are frozen in mount-time initializers: background card
// refetches must never rebuild the queue mid-quiz.
const RecapQuiz = ({
  cards,
  targetLanguage,
  onClose,
}: {
  cards: RecapCardInput[]
  targetLanguage: string
  onClose: () => void
}) => {
  const { t } = useLingui()
  const isMobile = useIsMobile()
  const showKbd = !isMobile
  const resolveMeaning = useTermMeaning(targetLanguage)

  // Kept beyond the initial build — redrills resample MC distractors from the
  // full set.
  const [terms] = useState(() => buildRecapTerms(cards, resolveMeaning))
  const [queue, setQueue] = useState<RecapQueueItem[]>(() => buildRecapQuestions(terms))
  const [index, setIndex] = useState(0)
  const [correctCount, setCorrectCount] = useState(0)

  const current = queue[index] ?? null
  const total = queue.length

  // One retry per missed (or skipped) term, in the other form, at the end of
  // the queue. A redrill that misses again is not re-appended.
  const appendRedrill = () => {
    if (current && !current.isRedrill) {
      const redrill = buildRedrillQuestion(current.term, terms, current.kind)
      setQueue((prev) => [...prev, redrill])
    }
  }
  const handleAnswered = (correct: boolean) => {
    if (correct) setCorrectCount((n) => n + 1)
    else appendRedrill()
  }
  const handleNext = () => setIndex((i) => i + 1)
  // Skip = "I don't know" without burning a guess: no reveal, no correct
  // credit, but the term comes back once like a miss.
  const handleSkip = () => {
    appendRedrill()
    handleNext()
  }

  // Live questions run their own hotkeys inside the recap exercise components;
  // the quiz host only covers the empty and all-done states (Enter = close).
  useHotkeys([{ key: 'enter', enabled: current == null, onPress: onClose }])

  if (queue.length === 0) {
    return (
      <div className='flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center'>
        <CircleCheck className='h-10 w-10 text-emerald-600' />
        <p className='text-lg font-semibold'>{t`Nothing to quiz yet.`}</p>
        <p className='text-muted-foreground text-sm'>
          {t`These terms don't have meanings saved yet — open a term to fill in its definition or translation.`}
        </p>
        <Button type='button' size='lg' onClick={onClose}>
          {t`Back to session`}
          {showKbd && <Kbd>↵</Kbd>}
        </Button>
      </div>
    )
  }

  if (!current) {
    return (
      <div className='flex flex-1 flex-col overflow-hidden'>
        <div className='flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center'>
          <CircleCheck className='h-10 w-10 text-emerald-600' />
          <p className='text-lg font-semibold'>{t`Recap done!`}</p>
          <p className='text-muted-foreground text-sm'>{t`${correctCount} of ${total} correct.`}</p>
        </div>
        <div className='bg-background border-t px-4 pt-2 pb-3'>
          <div className='mx-auto w-full max-w-xl'>
            <Button type='button' size='xl' className='w-full' onClick={onClose}>
              {t`Back to session`}
              {showKbd && <Kbd>↵</Kbd>}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // A typed question's headword IS the answer; MC shows the term in its stem
  // anyway, so naming it in the header spoils nothing. The counter's total can
  // grow when a miss appends its retry — bounded (at most one per term) and
  // bumping at the moment of the miss, so it reads as "added a retry" rather
  // than drift.
  const header = (
    <ExerciseHeader
      icon={<ListChecks className='h-3.5 w-3.5' />}
      label={t`Recap`}
      headword={current.kind === 'mc' ? current.term.headword : null}
      counter={`${index + 1} / ${total}`}
    />
  )
  return current.kind === 'mc' ? (
    <RecapMcExercise
      key={current.key}
      item={current}
      targetLanguage={targetLanguage}
      header={header}
      onAnswered={handleAnswered}
      onSkip={handleSkip}
      onNext={handleNext}
    />
  ) : (
    <RecapTypedExercise
      key={current.key}
      item={current}
      targetLanguage={targetLanguage}
      header={header}
      onAnswered={handleAnswered}
      onSkip={handleSkip}
      onNext={handleNext}
    />
  )
}
