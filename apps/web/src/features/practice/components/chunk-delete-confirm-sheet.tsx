import { useLingui } from '@lingui/react/macro'
import {
  OverlayContent,
  OverlayDescription,
  OverlayFooter,
  OverlayHeader,
  OverlayTitle,
  ResponsiveOverlay,
} from '@/components/ui/responsive-overlay'
import { Button } from '@/components/ui/button'

interface ChunkDeleteConfirmSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  headword: string
  isDeleting: boolean
  onConfirm: () => void
}

export const ChunkDeleteConfirmSheet = ({
  open,
  onOpenChange,
  headword,
  isDeleting,
  onConfirm,
}: ChunkDeleteConfirmSheetProps) => {
  const { t } = useLingui()
  return (
    <ResponsiveOverlay open={open} onOpenChange={onOpenChange}>
      <OverlayContent>
        <OverlayHeader>
          <OverlayTitle>{t`Delete "${headword}"?`}</OverlayTitle>
          <OverlayDescription>
            {t`Hides this term from Practice and Vocabulary. You can restore it from the toast right after, or by re-keeping it in a session.`}
          </OverlayDescription>
        </OverlayHeader>
        <OverlayFooter>
          <Button type='button' variant='outline' size='xl' disabled={isDeleting} onClick={() => onOpenChange(false)}>
            {t`Cancel`}
          </Button>
          <Button type='button' variant='destructive' size='xl' disabled={isDeleting} onClick={onConfirm}>
            {isDeleting ? t`Deleting…` : t`Delete`}
          </Button>
        </OverlayFooter>
      </OverlayContent>
    </ResponsiveOverlay>
  )
}
