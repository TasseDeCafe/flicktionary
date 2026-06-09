import { useLingui } from '@lingui/react/macro'
import { ExternalLink, Pencil, Trash2 } from 'lucide-react'
import type { ChunkRow } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import {
  ResponsiveOverlay,
  OverlayContent,
  OverlayDescription,
  OverlayHeader,
  OverlayTitle,
} from '@/components/ui/responsive-overlay'
import { OverlayActionRow } from '@flicktionary/ui/components/overlay-action-row'

interface VocabularyActionDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  chunk: ChunkRow | null
  onEdit: (chunk: ChunkRow) => void
  onOpenSource: (chunk: ChunkRow) => void
  onRequestDelete: (chunk: ChunkRow) => void
}

export const VocabularyActionDrawer = ({
  open,
  onOpenChange,
  chunk,
  onEdit,
  onOpenSource,
  onRequestDelete,
}: VocabularyActionDrawerProps) => {
  const { t } = useLingui()

  if (!chunk) return null

  const canEdit = chunk.studySessionId !== null && chunk.firstCardId !== null
  const canOpenSource = chunk.studySessionId !== null && chunk.sourceAvailable

  return (
    <ResponsiveOverlay open={open} onOpenChange={onOpenChange}>
      <OverlayContent>
        <OverlayHeader>
          <OverlayTitle>{chunk.headword}</OverlayTitle>
          <OverlayDescription className='sr-only'>{t`Actions for this vocabulary term.`}</OverlayDescription>
        </OverlayHeader>
        <div className='flex flex-col gap-1 px-2 pb-2'>
          {canEdit && (
            <OverlayActionRow
              icon={Pencil}
              label={t`Edit term`}
              description={t`Open the focus view to edit fields, forms, and skills.`}
              onClick={() => onEdit(chunk)}
            />
          )}
          {canOpenSource && (
            <OverlayActionRow
              icon={ExternalLink}
              label={t`Open source`}
              description={t`Jump to the session this term came from`}
              onClick={() => onOpenSource(chunk)}
            />
          )}
          <OverlayActionRow
            icon={Trash2}
            label={t`Delete`}
            description={t`Hide from vocabulary and Practice`}
            variant='destructive'
            onClick={() => onRequestDelete(chunk)}
          />
        </div>
      </OverlayContent>
    </ResponsiveOverlay>
  )
}
