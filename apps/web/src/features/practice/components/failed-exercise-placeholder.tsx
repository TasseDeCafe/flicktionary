import type { ReactNode } from 'react'
import { useLingui } from '@lingui/react/macro'
import { CircleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@flicktionary/ui/components/button'
import { Kbd } from '@flicktionary/ui/components/kbd'
import type { PracticePool } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { useHotkeys } from '@/hooks/use-hotkeys'
import { useStudyParkedTermAsFlashcard } from '../api/practice-hooks'
import { ExerciseLayout } from './exercise-layout'

type FailedExercisePlaceholderProps = {
  headword: string
  userLookupId: string
  pool: PracticePool
  header: ReactNode
  statusBar?: ReactNode
  showKbd: boolean
  hotkeysEnabled: boolean
  // Advance past this queue item — after Skip, or after the term was moved to
  // flashcards.
  onAdvance: () => void
}

// Terminal generation failure is a decision point, not a dead end: failed
// slots are never retried, so Skip alone would re-serve this placeholder
// every session forever. The primary action unparks the term and studies it
// as a normal flashcard instead. Editing/deleting the term stays in the
// header kebab (available here — a failed placeholder has no answer to
// spoil), and a content edit clears the failed slots server-side, so
// exercises get another chance after a fix.
export const FailedExercisePlaceholder = ({
  headword,
  userLookupId,
  pool,
  header,
  statusBar,
  showKbd,
  hotkeysEnabled,
  onAdvance,
}: FailedExercisePlaceholderProps) => {
  const { t } = useLingui()
  const studyAsFlashcard = useStudyParkedTermAsFlashcard()

  const handleStudyAsFlashcard = () => {
    studyAsFlashcard.mutate(
      { userLookupId, pool },
      {
        onSuccess: () => {
          toast.success(t`“${headword}” moved to your flashcards.`)
          onAdvance()
        },
      }
    )
  }

  useHotkeys(
    [
      { key: 'enter', enabled: true, onPress: handleStudyAsFlashcard },
      { key: 'space', enabled: true, onPress: handleStudyAsFlashcard },
      { key: 's', enabled: true, onPress: onAdvance },
      { key: 'escape', enabled: true, onPress: onAdvance },
    ],
    hotkeysEnabled && !studyAsFlashcard.isPending
  )

  return (
    <ExerciseLayout
      header={header}
      statusBar={statusBar}
      actions={
        <div className='flex gap-2'>
          <Button
            type='button'
            variant='outline'
            size='xl'
            className='flex-1'
            disabled={studyAsFlashcard.isPending}
            onClick={onAdvance}
          >
            {t`Skip`}
            {showKbd && <Kbd>S</Kbd>}
          </Button>
          <Button
            type='button'
            size='xl'
            className='flex-1'
            disabled={studyAsFlashcard.isPending}
            onClick={handleStudyAsFlashcard}
          >
            {t`Study as flashcard`}
            {showKbd && <Kbd>↵</Kbd>}
          </Button>
        </div>
      }
    >
      <div className='flex flex-col items-center gap-4 py-10 text-center'>
        <CircleAlert className='text-muted-foreground h-8 w-8' />
        <div className='flex flex-col gap-2'>
          <p className='text-muted-foreground text-sm'>{t`We couldn't create an exercise for “${headword}”.`}</p>
          <p className='text-muted-foreground text-sm'>
            {t`You can study it as a regular flashcard instead — or open the menu above to edit the term if something looks off (exercises get another try after a fix).`}
          </p>
        </div>
      </div>
    </ExerciseLayout>
  )
}
