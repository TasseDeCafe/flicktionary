import { useState } from 'react'
import { useLingui } from '@lingui/react/macro'
import { CircleCheck, CircleX } from 'lucide-react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { Button } from '@flicktionary/ui/components/button'
import type { StrengthenExercisePayload } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { useSubmitExerciseAnswer } from '../api/practice-hooks'
import { BlankedSentence } from './blanked-sentence'
import type { ExerciseAnswerData } from './strengthen-types'

type McPayload = Extract<StrengthenExercisePayload, { type: 'mc_cloze' | 'mc_comprehension' }>

// Multiple-choice exercise (cloze or comprehension — same interaction, the
// payload decides the stem). The answer truth lives server-side: we learn
// correctIndex only from the submit response, after the exercise is consumed.
export const McExercise = ({
  exerciseId,
  payload,
  onAnswered,
  onNext,
}: {
  exerciseId: string
  payload: McPayload
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
    <div className='flex w-full flex-col gap-5'>
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
                !result && 'hover:bg-gray-50 active:bg-gray-100',
                isSelected && !result && 'border-gray-900',
                result && isCorrectOption && 'border-emerald-600 bg-emerald-50',
                result && isSelected && !isCorrectOption && 'border-red-500 bg-red-50',
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
              result.correct ? 'text-emerald-700' : 'text-red-700'
            )}
          >
            {result.correct ? <CircleCheck className='h-4 w-4' /> : <CircleX className='h-4 w-4' />}
            {result.correct ? t`Correct!` : t`Not quite.`}
          </div>
          <Button type='button' size='xl' className='w-full' onClick={onNext}>
            {t`Next`}
          </Button>
        </div>
      )}
    </div>
  )
}
