import { useLingui } from '@lingui/react/macro'
import {
  FloatingSheet,
  FloatingSheetContent,
  FloatingSheetDescription,
  FloatingSheetFooter,
  FloatingSheetHeader,
  FloatingSheetTitle,
  type FloatingSheetAnchor,
} from '@flicktionary/ui/components/floating-sheet'
import { Button } from '@flicktionary/ui/components/button'

interface ChunkDeleteConfirmSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  headword: string
  // Reused from the actions sheet so the confirmation appears in the same spot.
  anchor: FloatingSheetAnchor
  isDeleting: boolean
  onConfirm: () => void
}

export const ChunkDeleteConfirmSheet = ({
  open,
  onOpenChange,
  headword,
  anchor,
  isDeleting,
  onConfirm,
}: ChunkDeleteConfirmSheetProps) => {
  const { t } = useLingui()
  return (
    <FloatingSheet open={open} onOpenChange={onOpenChange} anchor={anchor}>
      <FloatingSheetContent>
        <FloatingSheetHeader>
          <FloatingSheetTitle>{t`Delete "${headword}"?`}</FloatingSheetTitle>
          <FloatingSheetDescription>
            {t`Hides this term from Practice and Vocabulary. You can restore it from the toast right after, or by re-keeping it in a session.`}
          </FloatingSheetDescription>
        </FloatingSheetHeader>
        <FloatingSheetFooter>
          <Button type='button' variant='outline' size='xl' disabled={isDeleting} onClick={() => onOpenChange(false)}>
            {t`Cancel`}
          </Button>
          <Button type='button' variant='destructive' size='xl' disabled={isDeleting} onClick={onConfirm}>
            {isDeleting ? t`Deleting…` : t`Delete`}
          </Button>
        </FloatingSheetFooter>
      </FloatingSheetContent>
    </FloatingSheet>
  )
}
