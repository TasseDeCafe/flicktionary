import { useLingui } from '@lingui/react/macro'
import { Trash2 } from 'lucide-react'
import {
  ResponsiveOverlay,
  OverlayContent,
  OverlayDescription,
  OverlayHeader,
  OverlayTitle,
} from '@/components/ui/responsive-overlay'
import { OverlayActionRow } from '@flicktionary/ui/components/overlay-action-row'

type Props = {
  open: boolean
  onOpenChange: (next: boolean) => void
  sessionTitle: string
  // Opens the remove-confirmation dialog; the caller owns that dialog so the
  // preview/mutation flow stays in one place.
  onRequestRemove: () => void
}

// The session ⋮ menu (session cards + the session view header): a sheet on
// mobile, dialog on desktop. Removal is the only action today; future session
// actions belong here rather than as new header icons.
export const SessionActionsOverlay = ({ open, onOpenChange, sessionTitle, onRequestRemove }: Props) => {
  const { t } = useLingui()
  return (
    <ResponsiveOverlay open={open} onOpenChange={onOpenChange}>
      <OverlayContent>
        <OverlayHeader>
          <OverlayTitle>{sessionTitle}</OverlayTitle>
          <OverlayDescription className='sr-only'>{t`Actions for this session.`}</OverlayDescription>
        </OverlayHeader>
        <div className='flex flex-col gap-1 px-2 pb-2'>
          <OverlayActionRow
            icon={Trash2}
            label={t`Remove session`}
            description={t`Hide it from your list — kept vocabulary stays`}
            variant='destructive'
            onClick={onRequestRemove}
          />
        </div>
      </OverlayContent>
    </ResponsiveOverlay>
  )
}
