import { useState, type ReactNode } from 'react'
import { useLingui } from '@lingui/react/macro'
import { CircleCheck, MessageCircle, Sparkles } from 'lucide-react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { Button } from '@flicktionary/ui/components/button'
import { Kbd } from '@flicktionary/ui/components/kbd'
import { useIsMobile } from '@flicktionary/ui/hooks/use-is-mobile'
import type { StrengthenExercisePayload } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { useHotkeys } from '@/hooks/use-hotkeys'
import { useSubmitExerciseAnswer } from '../api/practice-hooks'
import { ExerciseLayout } from './exercise-layout'
import { MeaningLine, type ExerciseAnswerData } from './strengthen-types'

type UseInSentencePayload = Extract<StrengthenExercisePayload, { type: 'use_in_sentence' }>

// Free production, LLM-graded — clearly labelled "bonus" and never part of a
// rehab gate. Grading errors degrade server-side to attempt-only, so this
// component can treat every response as a success with optional feedback.
// Skipping never consumes — the same exercise re-serves next session.
export const UseInSentenceExercise = ({
  exerciseId,
  payload,
  meaning,
  header,
  statusBar,
  hotkeysEnabled = true,
  onAnswered,
  onNext,
}: {
  exerciseId: string
  payload: UseInSentencePayload
  // The term's resolved meaning line (see useTermMeaning), shown as a
  // post-answer reminder. No hint gating here — the term is named in the task
  // itself, so there is nothing to spoil.
  meaning?: string | null
  header: ReactNode
  statusBar?: ReactNode
  // Host gate for the hotkeys — off while an overlay (term-actions kebab) is
  // open above the exercise.
  hotkeysEnabled?: boolean
  onAnswered: (data: ExerciseAnswerData) => void
  onNext: () => void
}) => {
  const { t } = useLingui()
  const isMobile = useIsMobile()
  const showKbd = !isMobile
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

  // The focused textarea owns the keyboard (its own Enter-to-submit below);
  // the global hook carries the post-answer advance plus Escape — the skip
  // key that still works mid-typing.
  useHotkeys(
    [
      { key: 'enter', enabled: !result && !isPending, onPress: handleSubmit },
      { key: 'escape', enabled: !result && !isPending, allowInEditable: true, onPress: onNext },
      { key: 'enter', enabled: !!result, allowInEditable: true, onPress: onNext },
      { key: 'space', enabled: !!result, allowInEditable: true, onPress: onNext },
    ],
    hotkeysEnabled
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
            <MeaningLine meaning={meaning} />
          </div>
        )
      }
      actions={
        result ? (
          <Button type='button' size='xl' className='w-full' onClick={onNext}>
            {t`Next`}
            {showKbd && <Kbd>↵</Kbd>}
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
              {showKbd && <Kbd>↵</Kbd>}
            </Button>
            <Button type='button' variant='outline' size='xl' className='w-full' disabled={isPending} onClick={onNext}>
              {t`Skip`}
              {showKbd && <Kbd>Esc</Kbd>}
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
        onKeyDown={(e) => {
          // Chat-style: Enter submits, Shift+Enter inserts the (rare) newline.
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSubmit()
          }
        }}
        disabled={!!result || isPending}
        // Desktop-only: focusing immediately makes the whole exercise
        // keyboard-drivable; on mobile it would pop the keyboard unasked.
        autoFocus={!isMobile}
        rows={3}
        placeholder={t`Write your sentence…`}
        className='disabled:bg-muted resize-none rounded-lg border px-4 py-3 text-base focus:ring-2 focus:ring-yellow-400 focus:outline-none'
      />
    </ExerciseLayout>
  )
}
