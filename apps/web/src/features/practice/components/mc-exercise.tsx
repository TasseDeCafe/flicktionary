import { useState, type ReactNode } from 'react'
import { useLingui } from '@lingui/react/macro'
import { CircleCheck, CircleX, Lightbulb } from 'lucide-react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { Button } from '@flicktionary/ui/components/button'
import type { StrengthenExercisePayload } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { useSubmitExerciseAnswer } from '../api/practice-hooks'
import { BlankedSentence } from './blanked-sentence'
import { ExerciseLayout } from './exercise-layout'
import { MeaningLine, RehabProgressNote, type ExerciseAnswerData, type ExerciseCopyVariant } from './strengthen-types'

type McPayload = Extract<StrengthenExercisePayload, { type: 'mc_cloze' | 'mc_comprehension' }>

// Multiple-choice exercise (cloze or comprehension — same interaction, the
// payload decides the stem). The answer truth lives server-side: we learn
// correctIndex only from the submit response, after the exercise is consumed.
// Skipping never consumes — the same exercise re-serves next session.
export const McExercise = ({
  exerciseId,
  payload,
  meaning,
  header,
  statusBar,
  copyVariant,
  nextLabel,
  skipLabel,
  onAnswered,
  onNext,
}: {
  exerciseId: string
  payload: McPayload
  // The term's resolved meaning line (see useTermMeaning). On mc_cloze it
  // powers an opt-in Hint button — never shown unprompted, so the gate stays a
  // fair test. mc_comprehension gets no hint (its options ARE meaning
  // paraphrases, so the meaning is the answer); both types show the meaning as
  // a post-answer reminder.
  meaning?: string | null
  header: ReactNode
  statusBar?: ReactNode
  copyVariant?: ExerciseCopyVariant
  // Action-bar label overrides for hosts where "Next"/"Skip" don't fit — the
  // flashcard hint reads "Show answer"/"Back to card".
  nextLabel?: string
  skipLabel?: string
  onAnswered: (data: ExerciseAnswerData) => void
  onNext: () => void
}) => {
  const { t } = useLingui()
  const { mutate: submitAnswer, isPending } = useSubmitExerciseAnswer()
  const [selected, setSelected] = useState<number | null>(null)
  const [result, setResult] = useState<ExerciseAnswerData | null>(null)
  const [hintRevealed, setHintRevealed] = useState(false)

  const hintAvailable = payload.type === 'mc_cloze' && !!meaning

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

  // flex-1 only when sharing a row with the Hint button — standalone in the
  // bottom bar's column, flex-1 would zero the flex-basis and squash its height.
  const skipButton = (inHintRow: boolean) => (
    <Button
      type='button'
      variant='outline'
      size='xl'
      className={inHintRow ? 'flex-1' : 'w-full'}
      disabled={isPending}
      onClick={onNext}
    >
      {skipLabel ?? t`Skip`}
    </Button>
  )

  return (
    <ExerciseLayout
      header={header}
      statusBar={statusBar}
      feedback={
        result && (
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
            <MeaningLine meaning={meaning} />
            <RehabProgressNote data={result} copyVariant={copyVariant} />
          </div>
        )
      }
      actions={
        result ? (
          <Button type='button' size='xl' className='w-full' onClick={onNext}>
            {nextLabel ?? t`Next`}
          </Button>
        ) : hintAvailable && !hintRevealed ? (
          <div className='flex gap-2'>
            <Button
              type='button'
              variant='outline'
              size='xl'
              className='flex-1'
              disabled={isPending}
              onClick={() => setHintRevealed(true)}
            >
              <Lightbulb className='h-4 w-4' />
              {t`Hint`}
            </Button>
            {skipButton(true)}
          </div>
        ) : (
          skipButton(false)
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

      {hintRevealed && !result && meaning && (
        <p className='text-muted-foreground text-sm'>
          {t`Hint:`} {meaning}
        </p>
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
    </ExerciseLayout>
  )
}
