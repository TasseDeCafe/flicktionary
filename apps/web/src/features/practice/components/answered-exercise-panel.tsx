import type { ReactNode } from 'react'
import { useLingui } from '@lingui/react/macro'
import { CircleAlert, CircleCheck, CircleX } from 'lucide-react'
import { Button } from '@flicktionary/ui/components/button'
import { Kbd } from '@flicktionary/ui/components/kbd'
import { ExerciseLayout } from './exercise-layout'
import type { ExerciseAnswerData } from './strengthen-types'

// Read-only stand-in for a consumed exercise. Answering consumes the exercise
// server-side, so once an outcome exists the live component must never mount
// again — it would invite a second submit the server rejects ("Exercise is no
// longer answerable"). Rendered when peeking back over answered exercises and
// when a resumed session lands on an exercise answered before the detour.
export const AnsweredExercisePanel = ({
  outcome,
  headword,
  targetLanguage,
  header,
  statusBar,
  actionLabel,
  onAction,
  showKbd,
}: {
  // null = the exercise was skipped, not answered (peek only — skipping never
  // consumes, but a peeked item is behind the live index and stays read-only).
  outcome: ExerciseAnswerData | null
  headword: string
  targetLanguage: string
  header: ReactNode
  statusBar?: ReactNode
  actionLabel: string
  onAction: () => void
  showKbd: boolean
}) => {
  const { t } = useLingui()
  return (
    <ExerciseLayout
      header={header}
      statusBar={statusBar}
      actions={
        <Button type='button' size='xl' variant='outline' className='w-full' onClick={onAction}>
          {actionLabel}
          {showKbd && <Kbd>↵</Kbd>}
        </Button>
      }
    >
      <div className='flex flex-col items-center gap-4 py-10 text-center'>
        {outcome ? (
          outcome.correct ? (
            <CircleCheck className='h-8 w-8 text-emerald-600' />
          ) : (
            <CircleX className='text-destructive h-8 w-8' />
          )
        ) : (
          <CircleAlert className='text-muted-foreground h-8 w-8' />
        )}
        <p lang={targetLanguage} className='text-xl font-semibold'>
          {headword}
        </p>
        <p className='text-muted-foreground text-sm'>
          {outcome
            ? outcome.correct
              ? t`Answered correctly.`
              : t`Answered incorrectly.`
            : t`Skipped — it re-serves next session.`}
          &nbsp;{t`Exercise answers can't be changed.`}
        </p>
      </div>
    </ExerciseLayout>
  )
}
