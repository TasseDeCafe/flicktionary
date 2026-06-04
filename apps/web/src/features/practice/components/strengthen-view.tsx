import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { CircleCheck, Dumbbell, Hourglass } from 'lucide-react'
import { getLanguageName } from '@flicktionary/core/constants/supported-languages'
import { Button } from '@flicktionary/ui/components/button'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import type { StrengthenExerciseEntry } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { useStartStrengthenSession } from '../api/practice-hooks'
import { PracticeLoader } from './practice-loader'
import { McExercise } from './mc-exercise'
import { ProductionClozeExercise } from './production-cloze-exercise'
import { UseInSentenceExercise } from './use-in-sentence-exercise'
import type { ExerciseAnswerData } from './strengthen-types'

// Strengthen session: a local queue of exercises served once (the server
// consumes an exercise per answered attempt; abandoning before answering
// re-serves the same exercise on the next session start).
export const StrengthenView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { targetLanguage } = useParams({ from: '/_authenticated/_app/practice/strengthen/$targetLanguage' })
  const { pool, sessionHard } = useSearch({ from: '/_authenticated/_app/practice/strengthen/$targetLanguage' })
  const languageName = getLanguageName(targetLanguage)

  const { mutate: startSession, isPending, isError } = useStartStrengthenSession()
  const [entries, setEntries] = useState<StrengthenExerciseEntry[] | null>(null)
  const [index, setIndex] = useState(0)
  const [correctCount, setCorrectCount] = useState(0)
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    startSession(
      { targetLanguage, pool, sessionHardUserLookupIds: sessionHard ?? [] },
      { onSuccess: (resp) => setEntries(resp.data.exercises) }
    )
  }, [startSession, targetLanguage, pool, sessionHard])

  const close = () => void navigate({ to: '/practice/language/$targetLanguage', params: { targetLanguage } })

  const handleAnswered = (data: ExerciseAnswerData) => {
    if (data.correct) setCorrectCount((n) => n + 1)
  }
  const handleNext = () => setIndex((i) => i + 1)

  const current = entries?.[index] ?? null
  const total = entries?.length ?? 0
  const currentHeadword = current?.headword ?? ''

  return (
    <ModalScreen onClose={close} closeIcon='x' title={t`Strengthen · ${languageName}`}>
      <div className='flex flex-1 flex-col overflow-hidden'>
        {(isPending || entries === null) && !isError && <PracticeLoader label={t`Preparing exercises…`} />}

        {isError && (
          <div className='flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center'>
            <p className='text-lg font-semibold'>{t`Couldn't load exercises.`}</p>
            <Button type='button' size='lg' onClick={close}>
              {t`Back to ${languageName}`}
            </Button>
          </div>
        )}

        {entries !== null && entries.length === 0 && (
          <div className='flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center'>
            <CircleCheck className='h-10 w-10 text-emerald-600' />
            <p className='text-lg font-semibold'>{t`Nothing to strengthen right now.`}</p>
            <Button type='button' size='lg' onClick={close}>
              {t`Back to ${languageName}`}
            </Button>
          </div>
        )}

        {entries !== null && entries.length > 0 && !current && (
          <div className='flex flex-1 flex-col overflow-hidden'>
            <div className='flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center'>
              <CircleCheck className='h-10 w-10 text-emerald-600' />
              <p className='text-lg font-semibold'>{t`Strengthening done!`}</p>
              <p className='text-muted-foreground text-sm'>{t`${correctCount} of ${total} correct.`}</p>
            </div>
            <div className='border-t bg-white px-4 pt-2 pb-3'>
              <div className='mx-auto w-full max-w-xl'>
                <Button type='button' size='xl' className='w-full' onClick={close}>
                  {t`Back to ${languageName}`}
                </Button>
              </div>
            </div>
          </div>
        )}

        {current && (
          <div className='flex flex-1 flex-col overflow-hidden'>
            <div className='flex-1 overflow-y-auto'>
              <div className='mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-6'>
                <div className='flex items-center justify-between'>
                  <span className='text-muted-foreground inline-flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase'>
                    <Dumbbell className='h-3.5 w-3.5' />
                    {current.track === 'gate' ? t`Rehab` : t`Practice`} · {current.headword}
                  </span>
                  <span className='text-muted-foreground text-xs tabular-nums'>
                    {index + 1} / {total}
                  </span>
                </div>

                {current.status === 'generating' || !current.exerciseId || !current.payload ? (
                  <div className='flex flex-col items-center gap-4 py-10 text-center'>
                    <Hourglass className='h-8 w-8 text-gray-400' />
                    <p className='text-muted-foreground text-sm'>
                      {t`An exercise for “${currentHeadword}” is still being prepared. Check back in a minute.`}
                    </p>
                    <Button type='button' variant='outline' size='lg' onClick={handleNext}>
                      {t`Skip`}
                    </Button>
                  </div>
                ) : current.payload.type === 'mc_cloze' || current.payload.type === 'mc_comprehension' ? (
                  <McExercise
                    key={current.exerciseId}
                    exerciseId={current.exerciseId}
                    payload={current.payload}
                    onAnswered={handleAnswered}
                    onNext={handleNext}
                  />
                ) : current.payload.type === 'production_cloze' ? (
                  <ProductionClozeExercise
                    key={current.exerciseId}
                    exerciseId={current.exerciseId}
                    payload={current.payload}
                    onAnswered={handleAnswered}
                    onNext={handleNext}
                  />
                ) : (
                  <UseInSentenceExercise
                    key={current.exerciseId}
                    exerciseId={current.exerciseId}
                    payload={current.payload}
                    onAnswered={handleAnswered}
                    onNext={handleNext}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </ModalScreen>
  )
}
