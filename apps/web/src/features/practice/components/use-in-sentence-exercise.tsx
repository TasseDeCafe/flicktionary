import { useState, type ReactNode } from 'react'
import { useLingui } from '@lingui/react/macro'
import { CircleCheck, MessageCircle, Sparkles } from 'lucide-react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { Button } from '@flicktionary/ui/components/button'
import type { StrengthenExercisePayload } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { useSubmitExerciseAnswer } from '../api/practice-hooks'
import { ExerciseLayout } from './exercise-layout'
import type { ExerciseAnswerData } from './strengthen-types'

type UseInSentencePayload = Extract<StrengthenExercisePayload, { type: 'use_in_sentence' }>

// Free production, LLM-graded — clearly labelled "bonus" and never part of a
// rehab gate. Grading errors degrade server-side to attempt-only, so this
// component can treat every response as a success with optional feedback.
// Skipping never consumes — the same exercise re-serves next session.
export const UseInSentenceExercise = ({
  exerciseId,
  payload,
  header,
  onAnswered,
  onNext,
}: {
  exerciseId: string
  payload: UseInSentencePayload
  header: ReactNode
  onAnswered: (data: ExerciseAnswerData) => void
  onNext: () => void
}) => {
  const { t } = useLingui()
  const { mutate: submitAnswer, isPending } = useSubmitExerciseAnswer()
  const [text, setText] = useState('')
  const [result, setResult] = useState<ExerciseAnswerData | null>(null)
  const term = payload.term

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
              {isPending ? t`Checking…` : t`Check`}
            </Button>
            <Button type='button' variant='outline' size='xl' className='w-full' disabled={isPending} onClick={onNext}>
              {t`Skip`}
            </Button>
          </>
        )
      }
    >
      <div className='flex items-center gap-2'>
        <span className='inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700'>
          <Sparkles className='h-3 w-3' />
          {t`Bonus`}
        </span>
      </div>
      <div className='flex flex-col gap-1'>
        <p className='text-lg font-semibold'>{t`Use “${term}” in a sentence`}</p>
        {payload.prompt && <p className='text-muted-foreground text-sm'>{payload.prompt}</p>}
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={!!result || isPending}
        rows={3}
        placeholder={t`Write your sentence…`}
        className='disabled:bg-muted resize-none rounded-lg border px-4 py-3 text-base focus:ring-2 focus:ring-yellow-400 focus:outline-none'
      />

      {result && (
        <div
          className={cn(
            'flex items-start gap-2 text-sm',
            result.correct ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'
          )}
        >
          {result.correct ? (
            <CircleCheck className='mt-0.5 h-4 w-4 shrink-0' />
          ) : (
            <MessageCircle className='mt-0.5 h-4 w-4 shrink-0' />
          )}
          <span>{result.feedback ?? (result.correct ? t`Nice!` : t`Keep practicing this one.`)}</span>
        </div>
      )}
    </ExerciseLayout>
  )
}
