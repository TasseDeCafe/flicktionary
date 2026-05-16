import { useLingui } from '@lingui/react/macro'
import { Pencil, Trash2 } from 'lucide-react'
import {
  OverlayContent,
  OverlayDescription,
  OverlayHeader,
  OverlayTitle,
  ResponsiveOverlay,
} from '@/components/ui/responsive-overlay'
import { OverlayActionRow } from '@/components/ui/overlay-action-row'

interface ChunkActionsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  headword: string
  canEdit: boolean
  onEdit: () => void
  onDelete: () => void
}

export const ChunkActionsSheet = ({
  open,
  onOpenChange,
  headword,
  canEdit,
  onEdit,
  onDelete,
}: ChunkActionsSheetProps) => {
  const { t } = useLingui()
  return (
    <ResponsiveOverlay open={open} onOpenChange={onOpenChange}>
      <OverlayContent>
        <OverlayHeader>
          <OverlayTitle>{headword}</OverlayTitle>
          <OverlayDescription className='sr-only'>{t`Term options.`}</OverlayDescription>
        </OverlayHeader>
        <div className='flex flex-col gap-1 px-2 pb-2'>
          <OverlayActionRow
            icon={Pencil}
            label={t`Edit term`}
            description={t`Open the focus view to edit fields, chat, or generate full exploration.`}
            disabled={!canEdit}
            onClick={onEdit}
          />
          <OverlayActionRow
            icon={Trash2}
            label={t`Delete from vocabulary`}
            description={t`Hide this term from Practice and Vocabulary. You can restore it later.`}
            variant='destructive'
            onClick={onDelete}
          />
        </div>
      </OverlayContent>
    </ResponsiveOverlay>
  )
}
