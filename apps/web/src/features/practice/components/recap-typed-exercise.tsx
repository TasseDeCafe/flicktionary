import { useState, type ReactNode } from 'react'
import { useLingui } from '@lingui/react/macro'
import { CircleCheck, CircleX } from 'lucide-react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { isTypedAnswerAccepted } from '@flicktionary/core/utils/typed-answer-grading'
import { Button } from '@flicktionary/ui/components/button'
import { Kbd } from '@flicktionary/ui/components/kbd'
import { useIsMobile } from '@flicktionary/ui/hooks/use-is-mobile'
import { useHotkeys } from '@/hooks/use-hotkeys'
import type { RecapQueueItem } from '../utils/build-recap-questions'
import { ExerciseLayout } from './exercise-layout'
import { BlankedSentence } from './blanked-sentence'

type TypedItem = Extract<RecapQueueItem, { kind: 'typed' }>

// Session-recap typed recall, graded on the client with the same
// accent-insensitive, 1-typo-tolerant rules as the server-graded production
// cloze. When the term couldn't be located in its example, the sentence is
// withheld entirely — it contains the answer.
export const RecapTypedExercise = ({
  item,
  header,
  onAnswered,
  onSkip,
  onNext,
}: {
  item: TypedItem
  header: ReactNode
  onAnswered: (correct: boolean) => void
  // Skip = "I don't know": advances without revealing the answer (submit a
  // guess to see it) and the term retries once at the end of the queue.
  onSkip: () => void
  onNext: () => void
}) => {
  const { t } = useLingui()
  const isMobile = useIsMobile()
  const showKbd = !isMobile
  const [text, setText] = useState('')
  const [result, setResult] = useState<boolean | null>(null)

  const handleSubmit = () => {
    const trimmed = text.trim()
    if (!trimmed || result !== null) return
    const correct = isTypedAnswerAccepted(item.acceptedForms, trimmed)
    setResult(correct)
    onAnswered(correct)
  }

  // While the input has focus it owns the keyboard (its own onKeyDown handles
  // Enter-to-submit; single letters must type, not skip) — so besides the
  // post-answer advance, only Escape (which the input can't consume) rides
  // the global hook: it's the skip key that works mid-typing.
  useHotkeys([
    { key: 'enter', enabled: result === null, onPress: handleSubmit },
    { key: 'escape', enabled: result === null, allowInEditable: true, onPress: onSkip },
    { key: 'enter', enabled: result !== null, allowInEditable: true, onPress: onNext },
    { key: 'space', enabled: result !== null, allowInEditable: true, onPress: onNext },
  ])

  return (
    <ExerciseLayout
      header={header}
      feedback={
        result !== null && (
          <div className='flex flex-col gap-3'>
            <div
              className={cn(
                'flex items-center gap-2 text-sm font-medium',
                result ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'
              )}
            >
              {result ? <CircleCheck className='h-4 w-4' /> : <CircleX className='h-4 w-4' />}
              {result ? t`Correct!` : t`Not quite.`}
            </div>
            {!result && (
              <p className='text-sm'>
                {t`Expected:`} <span className='font-semibold'>{item.term.headword}</span>
              </p>
            )}
          </div>
        )
      }
      actions={
        result !== null ? (
          <Button type='button' size='xl' className='w-full' onClick={onNext}>
            {t`Next`}
            {showKbd && <Kbd>↵</Kbd>}
          </Button>
        ) : (
          <>
            <Button type='button' size='xl' className='w-full' disabled={!text.trim()} onClick={handleSubmit}>
              {t`Check`}
              {showKbd && <Kbd>↵</Kbd>}
            </Button>
            <Button type='button' variant='outline' size='xl' className='w-full' onClick={onSkip}>
              {t`Skip`}
              {showKbd && <Kbd>Esc</Kbd>}
            </Button>
          </>
        )
      }
    >
      <div className='flex flex-col gap-1'>
        <p className='text-muted-foreground text-sm'>{t`Type the term for:`}</p>
        <p className='text-lg font-medium'>{item.term.gloss}</p>
      </div>

      {item.blanked && (
        <BlankedSentence sentence={item.blanked.sentence} blankStart={item.blanked.start} blankEnd={item.blanked.end} />
      )}

      <input
        type='text'
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit()
        }}
        disabled={result !== null}
        placeholder={item.blanked ? t`Type the missing word…` : t`Type the term…`}
        // Desktop-only: focusing immediately makes the whole exercise
        // keyboard-drivable; on mobile it would pop the keyboard unasked.
        autoFocus={!isMobile}
        autoCapitalize='off'
        autoCorrect='off'
        spellCheck={false}
        className='disabled:bg-muted rounded-lg border px-4 py-3 text-base focus:ring-2 focus:ring-yellow-400 focus:outline-none'
      />
    </ExerciseLayout>
  )
}
