import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { CircleCheck, ListChecks } from 'lucide-react'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { Button } from '@flicktionary/ui/components/button'
import { FullViewLoader } from '@flicktionary/ui/components/full-view-loader'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import { useListCardsBySession } from '@/features/review/api/review-hooks'
import { useGetUserPrefs } from '@/features/sessions/api/sessions-hooks'
import type { RecapQueueItem, RecapTerm } from '../utils/build-recap-questions'
import { buildRecapQuestions, buildRedrillQuestion } from '../utils/build-recap-questions'
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

  const { data: cards, isLoading: cardsLoading, isError } = useListCardsBySession(studySessionId)
  const { data: userPrefs } = useGetUserPrefs()
  const resolveMeaning = useTermMeaning(targetLanguage)

  const [queue, setQueue] = useState<RecapQueueItem[] | null>(null)
  const [index, setIndex] = useState(0)
  const [correctCount, setCorrectCount] = useState(0)
  // The eligible terms behind the queue — redrills resample MC distractors
  // from the full set.
  const termsRef = useRef<RecapTerm[]>([])

  // Seed once, and only when prefs have loaded — the gloss resolver picks
  // translation vs definition off them, so building earlier could bake the
  // wrong field into every question. Background card refetches never rebuild.
  useEffect(() => {
    // eslint-disable-next-line react-you-might-not-need-an-effect/no-event-handler -- seeds once when the async inputs (cards + prefs) have all landed; there is no user event, and background refetches must NOT rebuild the queue mid-quiz
    if (queue !== null || !cards || !userPrefs) return
    const seenChunks = new Set<string>()
    const terms: RecapTerm[] = []
    for (const card of cards) {
      if (card.status !== 'kept' || seenChunks.has(card.chunk.id)) continue
      const gloss = resolveMeaning(card.chunk)?.trim()
      if (!gloss) continue
      seenChunks.add(card.chunk.id)
      terms.push({
        cardId: card.id,
        chunkId: card.chunk.id,
        headword: card.chunk.headword,
        surfaceForm: card.surfaceForm,
        gloss,
        pos: card.chunk.grammar.pos ?? null,
        targetExample: card.chunk.targetExample,
      })
    }
    termsRef.current = terms
    // eslint-disable-next-line react-you-might-not-need-an-effect/no-chain-state-updates -- part of the same one-shot seed guarded above
    setQueue(buildRecapQuestions(terms))
  }, [queue, cards, userPrefs, resolveMeaning])

  const current = queue?.[index] ?? null
  const total = queue?.length ?? 0

  // One retry per missed (or skipped) term, in the other form, at the end of
  // the queue. A redrill that misses again is not re-appended.
  const appendRedrill = () => {
    if (current && !current.isRedrill) {
      const redrill = buildRedrillQuestion(current.term, termsRef.current, current.kind)
      setQueue((prev) => (prev ? [...prev, redrill] : prev))
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

  const close = () => void navigate({ to: '/sessions/$sessionId/review', params: { sessionId: studySessionId } })
  const backButton = (
    <Button type='button' size='lg' onClick={close}>
      {t`Back to session`}
    </Button>
  )

  return (
    <ModalScreen onClose={close} closeIcon='x' title={t`Session recap · ${languageName}`}>
      <div className='flex flex-1 flex-col overflow-hidden'>
        {(cardsLoading || (queue === null && !isError)) && !isError && <FullViewLoader />}

        {isError && (
          <div className='flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center'>
            <p className='text-lg font-semibold'>{t`Couldn't load your terms.`}</p>
            {backButton}
          </div>
        )}

        {queue !== null && queue.length === 0 && (
          <div className='flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center'>
            <CircleCheck className='h-10 w-10 text-emerald-600' />
            <p className='text-lg font-semibold'>{t`Nothing to quiz yet.`}</p>
            <p className='text-muted-foreground text-sm'>
              {t`These terms don't have meanings saved yet — open a term to fill in its definition or translation.`}
            </p>
            {backButton}
          </div>
        )}

        {queue !== null && queue.length > 0 && !current && (
          <div className='flex flex-1 flex-col overflow-hidden'>
            <div className='flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center'>
              <CircleCheck className='h-10 w-10 text-emerald-600' />
              <p className='text-lg font-semibold'>{t`Recap done!`}</p>
              <p className='text-muted-foreground text-sm'>{t`${correctCount} of ${total} correct.`}</p>
            </div>
            <div className='bg-background border-t px-4 pt-2 pb-3'>
              <div className='mx-auto w-full max-w-xl'>
                <Button type='button' size='xl' className='w-full' onClick={close}>
                  {t`Back to session`}
                </Button>
              </div>
            </div>
          </div>
        )}

        {current &&
          (() => {
            // A typed question's headword IS the answer; MC shows the term in
            // its stem anyway, so naming it in the header spoils nothing. The
            // counter's total can grow when a miss appends its retry — bounded
            // (at most one per term) and bumping at the moment of the miss, so
            // it reads as "added a retry" rather than drift.
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
                header={header}
                onAnswered={handleAnswered}
                onSkip={handleSkip}
                onNext={handleNext}
              />
            ) : (
              <RecapTypedExercise
                key={current.key}
                item={current}
                header={header}
                onAnswered={handleAnswered}
                onSkip={handleSkip}
                onNext={handleNext}
              />
            )
          })()}
      </div>
    </ModalScreen>
  )
}
