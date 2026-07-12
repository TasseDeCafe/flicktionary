import { useState, type ReactNode } from 'react'
import { useLingui } from '@lingui/react/macro'
import { CircleCheck, CircleX, Lightbulb } from 'lucide-react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { Button } from '@flicktionary/ui/components/button'
import { Kbd } from '@flicktionary/ui/components/kbd'
import { useIsMobile } from '@flicktionary/ui/hooks/use-is-mobile'
import type { StrengthenExercisePayload } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { useHotkeys, type HotkeyBinding } from '@/hooks/use-hotkeys'
import { useSubmitExerciseAnswer } from '../api/practice-hooks'
import type { GlossOwner } from '../utils/resolve-gloss-selection'
import { ExerciseLayout } from './exercise-layout'
import { GlossableArea } from './glossable-area'
import { SelectableSentence } from './selectable-sentence'
import { MeaningLine, RehabProgressNote, type ExerciseAnswerData, type ExerciseCopyVariant } from './strengthen-types'

type McPayload = Extract<StrengthenExercisePayload, { type: 'mc_cloze' | 'mc_comprehension' }>

// Multiple-choice exercise (cloze or comprehension — same interaction, the
// payload decides the stem). The answer truth lives server-side: we learn
// correctIndex only from the submit response, after the exercise is consumed.
// Skipping never consumes — the same exercise re-serves next session.
export const McExercise = ({
  exerciseId,
  payload,
  targetLanguage,
  meaning,
  header,
  statusBar,
  copyVariant,
  nextLabel,
  skipLabel,
  hotkeysEnabled = true,
  onAnswered,
  onNext,
}: {
  exerciseId: string
  payload: McPayload
  targetLanguage: string
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
  const [selected, setSelected] = useState<number | null>(null)
  const [result, setResult] = useState<ExerciseAnswerData | null>(null)
  const [hintRevealed, setHintRevealed] = useState(false)
  const [glossOpen, setGlossOpen] = useState(false)

  const hintAvailable = payload.type === 'mc_cloze' && !!meaning

  // Select-to-gloss gating. The cloze blank is ALWAYS rejected (the served
  // sentence contains the hidden answer at that span); the comprehension term
  // is rejected until the answer lands, then unlocks. Rows generated before
  // the term span existed can't be gated word-by-word, so their whole sentence
  // stays gloss-locked pre-answer instead.
  const blankSpan = payload.type === 'mc_cloze' ? { start: payload.blankStart, end: payload.blankEnd } : null
  const termSpan =
    payload.type === 'mc_comprehension' && payload.termStart != null && payload.termEnd != null
      ? { start: payload.termStart, end: payload.termEnd }
      : null
  const stemRejectedRanges = blankSpan ? [blankSpan] : termSpan && !result ? [termSpan] : []
  // mc_cloze options are target-language words — glossable once the answer is
  // in. mc_comprehension options are native-language paraphrases; never
  // tokenized (a native→native gloss is useless).
  const optionsGlossable = payload.type === 'mc_cloze' && !!result
  const glossOwners: Record<string, GlossOwner> = {
    stem: { sourceText: payload.sentence, contextText: payload.sentence, rejectedRanges: stemRejectedRanges },
    ...(optionsGlossable
      ? Object.fromEntries(
          payload.options.map((option, index): [string, GlossOwner] => [
            `option-${index}`,
            // The stem is the gloss context: a lone option word carries no
            // usable context of its own.
            { sourceText: option, contextText: payload.sentence, rejectedRanges: [] },
          ])
        )
      : {}),
  }

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

  const live = !result && !isPending
  useHotkeys(
    [
      ...payload.options.map(
        (_, index): HotkeyBinding => ({
          key: String(index + 1),
          enabled: live,
          onPress: () => handleSelect(index),
        })
      ),
      { key: 'h', enabled: live && hintAvailable && !hintRevealed, onPress: () => setHintRevealed(true) },
      { key: 's', enabled: live, onPress: onNext },
      { key: 'escape', enabled: live, onPress: onNext },
      { key: 'enter', enabled: !!result, onPress: onNext },
      { key: 'space', enabled: !!result, onPress: onNext },
    ],
    hotkeysEnabled && !glossOpen
  )

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
      {showKbd && <Kbd>S</Kbd>}
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
            {showKbd && <Kbd>↵</Kbd>}
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
              {showKbd && <Kbd>H</Kbd>}
            </Button>
            {skipButton(true)}
          </div>
        ) : (
          skipButton(false)
        )
      }
    >
      <GlossableArea
        targetLanguage={targetLanguage}
        owners={glossOwners}
        onOpenChange={setGlossOpen}
        className='flex flex-col gap-5'
      >
        {payload.type === 'mc_cloze' ? (
          <SelectableSentence
            text={payload.sentence}
            targetLanguage={targetLanguage}
            ownerKey='stem'
            blank={blankSpan}
            className='text-lg leading-relaxed'
          />
        ) : (
          <div className='flex flex-col gap-3'>
            <SelectableSentence
              text={payload.sentence}
              targetLanguage={targetLanguage}
              ownerKey='stem'
              // Pre-span rows can't block the term word-by-word, so the whole
              // sentence stays unselectable until answered.
              enabled={termSpan !== null || !!result}
              highlight={termSpan}
              blockedRanges={stemRejectedRanges}
              className='text-lg leading-relaxed'
            />
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
                // A disabled button swallows the pointer events the gloss
                // gesture needs, so once cloze options become glossable the
                // button stays enabled and handleSelect's result-guard does
                // the disabling instead.
                disabled={optionsGlossable ? isPending : !!result || isPending}
                aria-disabled={!!result}
                onClick={() => handleSelect(index)}
                className={cn(
                  'flex items-center gap-3 rounded-lg border px-4 py-3 text-left text-base transition-colors',
                  !result && 'hover:bg-accent active:bg-accent',
                  result && 'cursor-default',
                  isSelected && !result && 'border-foreground',
                  result && isCorrectOption && 'border-emerald-600 bg-emerald-50 dark:bg-emerald-400/15',
                  result && isSelected && !isCorrectOption && 'border-red-500 bg-red-50 dark:bg-red-400/15',
                  result && !isSelected && !isCorrectOption && 'opacity-60'
                )}
              >
                {showKbd && <Kbd className='shrink-0'>{index + 1}</Kbd>}
                {optionsGlossable ? (
                  <SelectableSentence
                    text={option}
                    targetLanguage={targetLanguage}
                    ownerKey={`option-${index}`}
                    as='span'
                  />
                ) : (
                  <span>{option}</span>
                )}
              </button>
            )
          })}
        </div>
      </GlossableArea>
    </ExerciseLayout>
  )
}
