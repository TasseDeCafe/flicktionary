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

type ProductionClozePayload = Extract<StrengthenExercisePayload, { type: 'production_cloze' }>

// Typed cloze: the learner produces the missing form. Accent-insensitive,
// 1-typo-tolerant grading happens server-side; the canonical answer is
// revealed in the response for learning value. Skipping never consumes — the
// same exercise re-serves next session.
export const ProductionClozeExercise = ({
  exerciseId,
  payload,
  header,
  copyVariant,
  onAnswered,
  onNext,
}: {
  exerciseId: string
  payload: ProductionClozePayload
  header: ReactNode
  copyVariant?: ExerciseCopyVariant
  onAnswered: (data: ExerciseAnswerData) => void
  onNext: () => void
}) => {
  const { t } = useLingui()
  const { mutate: submitAnswer, isPending } = useSubmitExerciseAnswer()
  const [text, setText] = useState('')
  const [result, setResult] = useState<ExerciseAnswerData | null>(null)

  const handleSubmit = () => {
    const trimmed = text.trim()
    if (!trimmed || result || isPending) return
    submitAnswer(
      { exerciseId, response: { text: trimmed } },
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
          <>
            <Button
              type='button'
              size='xl'
              className='w-full'
              disabled={!text.trim() || isPending}
              onClick={handleSubmit}
            >
              {t`Check`}
            </Button>
            <Button type='button' variant='outline' size='xl' className='w-full' disabled={isPending} onClick={onNext}>
              {t`Skip`}
            </Button>
          </>
        )
      }
    >
      <BlankedSentence sentence={payload.sentence} blankStart={payload.blankStart} blankEnd={payload.blankEnd} />
      {payload.hint && (
        <p className='text-muted-foreground text-sm'>
          {t`Hint:`} {payload.hint}
        </p>
      )}

      <input
        type='text'
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit()
        }}
        disabled={!!result || isPending}
        placeholder={t`Type the missing word…`}
        autoCapitalize='off'
        autoCorrect='off'
        spellCheck={false}
        className='disabled:bg-muted rounded-lg border px-4 py-3 text-base focus:ring-2 focus:ring-yellow-400 focus:outline-none'
      />

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
          {result.correctAnswer && !result.correct && (
            <p className='text-sm'>
              {t`Expected:`} <span className='font-semibold'>{result.correctAnswer}</span>
            </p>
          )}
          <RehabProgressNote data={result} copyVariant={copyVariant} />
        </div>
      )}
    </ExerciseLayout>
  )
}
