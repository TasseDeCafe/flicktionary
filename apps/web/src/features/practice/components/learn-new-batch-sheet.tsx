import { useLingui } from '@lingui/react/macro'
import {
  FloatingSheet,
  FloatingSheetBody,
  FloatingSheetContent,
  FloatingSheetDescription,
  FloatingSheetHeader,
  FloatingSheetTitle,
  type FloatingSheetAnchor,
} from '@flicktionary/ui/components/floating-sheet'
import { Button } from '@flicktionary/ui/components/button'

interface LearnNewBatchSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Anchored to the "Learn new" button that opened the sheet.
  anchor: FloatingSheetAnchor
  // Unseen (never-introduced) terms available for this language.
  newCount: number
  onConfirm: (batchSize: number) => void
}

// Batch-size options below the unseen total, so "All N" (added when the total
// itself is small enough to be a sane batch) is never duplicated by a preset —
// and 1-4 unseen terms still get exactly one option instead of a dead end.
const PRESET_BATCH_SIZES = [5, 10, 15, 20]
const MAX_ALL_OPTION = 20

// Anki-style custom study: pick how many NEW terms to learn right now. The
// chosen batch deliberately bypasses the daily-new budget (the introductions
// still count toward today, so the mixed queue won't re-add more on top).
export const LearnNewBatchSheet = ({ open, onOpenChange, anchor, newCount, onConfirm }: LearnNewBatchSheetProps) => {
  const { t } = useLingui()
  const presets = PRESET_BATCH_SIZES.filter((option) => option < newCount)
  const showAll = newCount > 0 && newCount <= MAX_ALL_OPTION
  return (
    <FloatingSheet open={open} onOpenChange={onOpenChange} anchor={anchor}>
      <FloatingSheetContent>
        <FloatingSheetHeader>
          <FloatingSheetTitle>{t`Learn new terms`}</FloatingSheetTitle>
          <FloatingSheetDescription>
            {t`${newCount} unseen term(s) available. How many do you want to learn now? They count toward today's introductions.`}
          </FloatingSheetDescription>
        </FloatingSheetHeader>
        <FloatingSheetBody>
          {presets.map((option) => (
            <Button key={option} type='button' variant='outline' size='xl' onClick={() => onConfirm(option)}>
              {t`${option} terms`}
            </Button>
          ))}
          {showAll && (
            <Button type='button' variant='outline' size='xl' onClick={() => onConfirm(newCount)}>
              {t`All ${newCount}`}
            </Button>
          )}
        </FloatingSheetBody>
      </FloatingSheetContent>
    </FloatingSheet>
  )
}
