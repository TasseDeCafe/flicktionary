import { useState, type ReactNode } from 'react'
import { useLingui } from '@lingui/react/macro'
import { CircleCheck, CircleX, Eye, Lightbulb } from 'lucide-react'
import { cn } from '@flicktionary/core/utils/tailwind-utils'
import { Button } from '@flicktionary/ui/components/button'
import { Kbd } from '@flicktionary/ui/components/kbd'
import { useIsMobile } from '@flicktionary/ui/hooks/use-is-mobile'
import type { StrengthenExercisePayload } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { useHotkeys } from '@/hooks/use-hotkeys'
import { useSubmitExerciseAnswer } from '../api/practice-hooks'
import { ExerciseLayout } from './exercise-layout'
import { GlossableArea } from './glossable-area'
import { SelectableSentence } from './selectable-sentence'
import { MeaningLine, RehabProgressNote, type ExerciseAnswerData, type ExerciseCopyVariant } from './strengthen-types'

type ProductionClozePayload = Extract<StrengthenExercisePayload, { type: 'production_cloze' }>

// Typed cloze: the learner produces the missing form. Accent-insensitive,
// 1-typo-tolerant grading happens server-side; the canonical answer is
// revealed in the response for learning value. Skipping never consumes — the
// same exercise re-serves next session. Giving up (Show answer) grades as a
// miss server-side but reads softer than a wrong guess: the escalation is
// Hint → Show answer in the same button slot.
export const ProductionClozeExercise = ({
  exerciseId,
  payload,
  targetLanguage,
  meaning,
  header,
  statusBar,
  copyVariant,
  hotkeysEnabled = true,
  onAnswered,
  onNext,
}: {
  exerciseId: string
  payload: ProductionClozePayload
  targetLanguage: string
  // The term's resolved meaning line (see useTermMeaning). Behind an opt-in
  // Hint button — the payload's own generation-time hint is the fallback for
  // terms whose lookup has neither translation nor definition.
  meaning?: string | null
  header: ReactNode
  statusBar?: ReactNode
  copyVariant?: ExerciseCopyVariant
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
  const [hintRevealed, setHintRevealed] = useState(false)
  const [gaveUp, setGaveUp] = useState(false)
  const [glossOpen, setGlossOpen] = useState(false)

  const hintText = meaning ?? payload.hint
  const hintAvailable = !!hintText

  // The blank is the answer — permanently rejected so a drag sweeping across
  // it can't surface the hidden text in the gloss sheet.
  const blankSpan = { start: payload.blankStart, end: payload.blankEnd }

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

  // Give-up: grades as a miss server-side (consumes the exercise, no gate
  // credit, fresh exercise next time) but renders as a neutral reveal.
  const handleGiveUp = () => {
    if (result || isPending) return
    submitAnswer(
      { exerciseId, response: { giveUp: true } },
      {
        onSuccess: (resp) => {
          setGaveUp(true)
          setResult(resp.data)
          onAnswered(resp.data)
        },
      }
    )
  }

  // While the input has focus it owns the keyboard (its own onKeyDown handles
  // Enter-to-submit; single letters must type, not skip) — so besides the
  // post-answer advance, only Escape (which the input can't consume) rides the
  // global hook: it's the skip key that works mid-typing. allowInEditable
  // covers focus lingering on the (just-)focused input.
  useHotkeys(
    [
      { key: 'enter', enabled: !result && !isPending, onPress: handleSubmit },
      { key: 'escape', enabled: !result && !isPending, allowInEditable: true, onPress: onNext },
      { key: 'enter', enabled: !!result, allowInEditable: true, onPress: onNext },
      { key: 'space', enabled: !!result, allowInEditable: true, onPress: onNext },
    ],
    hotkeysEnabled && !glossOpen
  )

  return (
    <ExerciseLayout
      header={header}
      statusBar={statusBar}
      feedback={
        result && (
          <div className='flex flex-col gap-3'>
            {/* A voluntary give-up reads as a neutral reveal, not a failure verdict. */}
            {gaveUp ? (
              <div className='flex items-center gap-2 text-sm'>
                <Eye className='text-muted-foreground h-4 w-4' />
                {t`The answer was:`} <span className='font-semibold'>{result.correctAnswer}</span>
              </div>
            ) : (
              <>
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
              </>
            )}
            <MeaningLine meaning={hintText} />
            <RehabProgressNote data={result} copyVariant={copyVariant} />
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
              {t`Check`}
              {showKbd && <Kbd>↵</Kbd>}
            </Button>
            <div className='flex gap-2'>
              {/* Escalating disclosure in one slot: Hint first, then Show
                  answer (give-up) once the hint is out — or immediately when
                  no hint exists. Skip stays a pure defer next to it. */}
              {hintAvailable && !hintRevealed ? (
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
              ) : (
                <Button
                  type='button'
                  variant='outline'
                  size='xl'
                  className='flex-1'
                  disabled={isPending}
                  onClick={handleGiveUp}
                >
                  <Eye className='h-4 w-4' />
                  {t`Show answer`}
                </Button>
              )}
              <Button
                type='button'
                variant='outline'
                size='xl'
                className='flex-1'
                disabled={isPending}
                onClick={onNext}
              >
                {t`Skip`}
                {showKbd && <Kbd>Esc</Kbd>}
              </Button>
            </div>
          </>
        )
      }
    >
      <GlossableArea
        targetLanguage={targetLanguage}
        owners={{
          stem: { sourceText: payload.sentence, contextText: payload.sentence, rejectedRanges: [blankSpan] },
        }}
        onOpenChange={setGlossOpen}
      >
        <SelectableSentence
          text={payload.sentence}
          targetLanguage={targetLanguage}
          ownerKey='stem'
          blank={blankSpan}
          className='text-lg leading-relaxed'
        />
      </GlossableArea>
      {hintRevealed && !result && hintText && (
        <p className='text-muted-foreground text-sm'>
          {t`Hint:`} {hintText}
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
        // Desktop-only: focusing immediately makes the whole exercise
        // keyboard-drivable; on mobile it would pop the keyboard unasked.
        autoFocus={!isMobile}
        autoCapitalize='off'
        autoCorrect='off'
        spellCheck={false}
        enterKeyHint='go'
        className='disabled:bg-muted rounded-lg border px-4 py-3 text-base focus:ring-2 focus:ring-yellow-400 focus:outline-none'
      />
    </ExerciseLayout>
  )
}
