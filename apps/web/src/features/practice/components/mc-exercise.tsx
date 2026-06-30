import { useState, type ReactNode } from 'react'
import { useLingui } from '@lingui/react/macro'
import { CircleCheck, CircleX } from 'lucide-react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { Button } from '@flicktionary/ui/components/button'
import type { StrengthenExercisePayload } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { useSubmitExerciseAnswer } from '../api/practice-hooks'
import { BlankedSentence } from './blanked-sentence'
import { ExerciseLayout } from './exercise-layout'
import { RehabProgressNote, type ExerciseAnswerData, type ExerciseCopyVariant } from './strengthen-types'

type McPayload = Extract<StrengthenExercisePayload, { type: 'mc_cloze' | 'mc_comprehension' }>

// Multiple-choice exercise (cloze or comprehension — same interaction, the
// payload decides the stem). The answer truth lives server-side: we learn
// correctIndex only from the submit response, after the exercise is consumed.
// Skipping never consumes — the same exercise re-serves next session.
export const McExercise = ({
  exerciseId,
  payload,
  header,
  copyVariant,
  onAnswered,
  onNext,
}: {
  exerciseId: string
  payload: McPayload
  header: ReactNode
  copyVariant?: ExerciseCopyVariant
  onAnswered: (data: ExerciseAnswerData) => void
  onNext: () => void
}) => {
  const { t } = useLingui()
  const { mutate: submitAnswer, isPending } = useSubmitExerciseAnswer()
  const [selected, setSelected] = useState<number | null>(null)
  const [result, setResult] = useState<ExerciseAnswerData | null>(null)

  const handleSelect = (index: number) => {
    if (result || isPending) return
    setSelected(index)
    submitAnswer(
      { exerciseId, response: { selectedIndex: index } },
      {
        onSuccess: (resp) => {
          setResult(resp.data)
          onAnswered(resp.data)
        },
      }
    )
  }

  return (
    <ExerciseLayout
      header={header}
      actions={
        result ? (
          <Button type='button' size='xl' className='w-full' onClick={onNext}>
            {t`Next`}
          </Button>
        ) : (
          <Button type='button' variant='outline' size='xl' className='w-full' disabled={isPending} onClick={onNext}>
            {t`Skip`}
          </Button>
        )
      }
    >
      {payload.type === 'mc_cloze' ? (
        <BlankedSentence sentence={payload.sentence} blankStart={payload.blankStart} blankEnd={payload.blankEnd} />
      ) : (
        <div className='flex flex-col gap-3'>
          <p className='text-lg leading-relaxed'>{payload.sentence}</p>
          <p className='font-medium'>{payload.prompt}</p>
        </div>
      )}

      <div className='flex flex-col gap-2'>
        {payload.options.map((option, index) => {
          const isSelected = selected === index
          const isCorrectOption = result?.correctIndex === index
          return (
            <button
              key={index}
              type='button'
              disabled={!!result || isPending}
              onClick={() => handleSelect(index)}
              className={cn(
                'rounded-lg border px-4 py-3 text-left text-base transition-colors',
                !result && 'hover:bg-accent active:bg-accent',
                isSelected && !result && 'border-foreground',
                result && isCorrectOption && 'border-emerald-600 bg-emerald-50 dark:bg-emerald-400/15',
                result && isSelected && !isCorrectOption && 'border-red-500 bg-red-50 dark:bg-red-400/15',
                result && !isSelected && !isCorrectOption && 'opacity-60'
              )}
            >
              {option}
            </button>
          )
        })}
      </div>

      {result && (
        <div className='flex flex-col gap-3'>
          <div
            className={cn(
              'flex items-center gap-2 text-sm font-medium',
              result.correct ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'
            )}
          >
            {result.correct ? <CircleCheck className='h-4 w-4' /> : <CircleX className='h-4 w-4' />}
            {result.correct ? t`Correct!` : t`Not quite.`}
          </div>
          <RehabProgressNote data={result} copyVariant={copyVariant} />
        </div>
      )}
    </ExerciseLayout>
  )
}
