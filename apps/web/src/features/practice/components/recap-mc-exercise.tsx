import { useState, type ReactNode } from 'react'
import { useLingui } from '@lingui/react/macro'
import { CircleCheck, CircleX } from 'lucide-react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { Button } from '@flicktionary/ui/components/button'
import { Kbd } from '@flicktionary/ui/components/kbd'
import { useIsMobile } from '@flicktionary/ui/hooks/use-is-mobile'
import { useHotkeys, type HotkeyBinding } from '@/hooks/use-hotkeys'
import type { RecapQueueItem } from '../utils/build-recap-questions'
import { ExerciseLayout } from './exercise-layout'
import { GlossableArea } from './glossable-area'
import { SelectableSentence } from './selectable-sentence'

type McItem = Extract<RecapQueueItem, { kind: 'mc' }>

// Session-recap multiple choice, graded entirely on the client: the recap is
// ungated bonus practice (no SRS writes, nothing consumed server-side), so the
// answer can live in the payload and there is no Skip. The stem shows the
// term's own example with the term highlighted — the term being visible
// doesn't spoil a meaning question.
export const RecapMcExercise = ({
  item,
  targetLanguage,
  header,
  onAnswered,
  onSkip,
  onNext,
}: {
  item: McItem
  targetLanguage: string
  header: ReactNode
  onAnswered: (correct: boolean) => void
  // Skip = "I don't know": advances without revealing the answer (pick an
  // option to see it) and the term retries once at the end of the queue.
  onSkip: () => void
  onNext: () => void
}) => {
  const { t } = useLingui()
  const isMobile = useIsMobile()
  const showKbd = !isMobile
  const [selected, setSelected] = useState<number | null>(null)
  const [glossOpen, setGlossOpen] = useState(false)

  const answered = selected !== null
  const correct = selected === item.answerIndex
  const headword = item.term.headword

  // The underlined term IS the question pre-answer — glossing it would answer
  // the exercise, so its span is rejected until the answer lands. Options stay
  // plain: they're native-language glosses.
  const stemSpan = item.stem ? { start: item.stem.start, end: item.stem.end } : null

  const handleSelect = (index: number) => {
    if (answered) return
    setSelected(index)
    onAnswered(index === item.answerIndex)
  }

  useHotkeys(
    [
      ...item.options.map((_, index): HotkeyBinding => ({
        key: String(index + 1),
        enabled: !answered,
        onPress: () => handleSelect(index),
      })),
      { key: 's', enabled: !answered, onPress: onSkip },
      { key: 'escape', enabled: !answered, onPress: onSkip },
      { key: 'enter', enabled: answered, onPress: onNext },
      { key: 'space', enabled: answered, onPress: onNext },
    ],
    !glossOpen
  )

  return (
    <ExerciseLayout
      header={header}
      feedback={
        answered && (
          <div
            className={cn(
              'flex items-center gap-2 text-sm font-medium',
              correct ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'
            )}
          >
            {correct ? <CircleCheck className='h-4 w-4' /> : <CircleX className='h-4 w-4' />}
            {correct ? t`Correct!` : t`Not quite.`}
          </div>
        )
      }
      actions={
        answered ? (
          <Button type='button' size='xl' className='w-full' onClick={onNext}>
            {t`Next`}
            {showKbd && <Kbd>↵</Kbd>}
          </Button>
        ) : (
          <Button type='button' variant='outline' size='xl' className='w-full' onClick={onSkip}>
            {t`Skip`}
            {showKbd && <Kbd>S</Kbd>}
          </Button>
        )
      }
    >
      {item.stem ? (
        <GlossableArea
          targetLanguage={targetLanguage}
          owners={{
            stem: {
              sourceText: item.stem.sentence,
              contextText: item.stem.sentence,
              rejectedRanges: answered || !stemSpan ? [] : [stemSpan],
            },
          }}
          onOpenChange={setGlossOpen}
          className='flex flex-col gap-3'
        >
          <SelectableSentence
            text={item.stem.sentence}
            targetLanguage={targetLanguage}
            ownerKey='stem'
            highlight={stemSpan}
            blockedRanges={answered || !stemSpan ? [] : [stemSpan]}
            className='text-lg leading-relaxed'
          />
          <p className='font-medium'>{t`What does the highlighted term mean?`}</p>
        </GlossableArea>
      ) : (
        <p className='font-medium'>{t`What does “${headword}” mean?`}</p>
      )}

      <div className='flex flex-col gap-2'>
        {item.options.map((option, index) => {
          const isSelected = selected === index
          const isCorrectOption = index === item.answerIndex
          return (
            <button
              key={index}
              type='button'
              disabled={answered}
              onClick={() => handleSelect(index)}
              className={cn(
                'flex items-center gap-3 rounded-lg border px-4 py-3 text-left text-base transition-colors',
                !answered && 'hover:bg-accent active:bg-accent',
                answered && isCorrectOption && 'border-emerald-600 bg-emerald-50 dark:bg-emerald-400/15',
                answered && isSelected && !isCorrectOption && 'border-red-500 bg-red-50 dark:bg-red-400/15',
                answered && !isSelected && !isCorrectOption && 'opacity-60'
              )}
            >
              {showKbd && <Kbd className='shrink-0'>{index + 1}</Kbd>}
              <span>{option}</span>
            </button>
          )
        })}
      </div>
    </ExerciseLayout>
  )
}
