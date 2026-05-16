import { useLingui } from '@lingui/react/macro'
import type { ChunkRow } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { Button } from '@/components/ui/button'
import {
  ResponsiveOverlay,
  OverlayContent,
  OverlayDescription,
  OverlayFooter,
  OverlayHeader,
  OverlayTitle,
} from '@/components/ui/responsive-overlay'

interface VocabularyDeleteConfirmDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  chunk: ChunkRow | null
  onConfirm: (chunk: ChunkRow) => void
  isDeleting?: boolean
}

export const VocabularyDeleteConfirmDrawer = ({
  open,
  onOpenChange,
  chunk,
  onConfirm,
  isDeleting,
}: VocabularyDeleteConfirmDrawerProps) => {
  const { t } = useLingui()

  if (!chunk) return null

  const headword = chunk.headword

  return (
    <ResponsiveOverlay open={open} onOpenChange={onOpenChange}>
      <OverlayContent>
        <OverlayHeader>
          <OverlayTitle>{t`Delete "${headword}"?`}</OverlayTitle>
          <OverlayDescription>
            {t`Hides this term from your vocabulary and Practice. You can revive it by re-keeping it in a session.`}
          </OverlayDescription>
        </OverlayHeader>
        <OverlayFooter>
          <Button type='button' variant='outline' size='xl' disabled={isDeleting} onClick={() => onOpenChange(false)}>
            {t`Cancel`}
          </Button>
          <Button type='button' variant='destructive' size='xl' disabled={isDeleting} onClick={() => onConfirm(chunk)}>
            {isDeleting ? t`Deleting…` : t`Delete`}
          </Button>
        </OverlayFooter>
      </OverlayContent>
    </ResponsiveOverlay>
  )
}
