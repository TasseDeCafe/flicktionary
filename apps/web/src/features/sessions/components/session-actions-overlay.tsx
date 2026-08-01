import { useLingui } from '@lingui/react/macro'
import { Globe, GlobeLock, Trash2 } from 'lucide-react'
import {
  ResponsiveOverlay,
  OverlayContent,
  OverlayDescription,
  OverlayHeader,
  OverlayTitle,
} from '@/components/ui/responsive-overlay'
import { OverlayActionRow } from '@flicktionary/ui/components/overlay-action-row'
import { useSetShared, useShareState } from '@/features/explore/api/explore-hooks'

type Props = {
  open: boolean
  onOpenChange: (next: boolean) => void
  sessionTitle: string
  // Enables the Explore share toggle. The server decides manageability
  // ('not-shareable' hides the row): only the owner of a shareable-type,
  // moderation-clean source ever sees it — recipients of shared content and
  // guests never do.
  textTrackId?: string | null
  // Opens the remove-confirmation dialog; the caller owns that dialog so the
  // preview/mutation flow stays in one place.
  onRequestRemove: () => void
}

// The session ⋮ menu (session cards + the session view header): a sheet on
// mobile, dialog on desktop.
export const SessionActionsOverlay = ({ open, onOpenChange, sessionTitle, textTrackId, onRequestRemove }: Props) => {
  const { t } = useLingui()
  const { data: shareState } = useShareState(textTrackId ?? null, open)
  const { mutate: setShared, isPending: isSettingShared } = useSetShared(textTrackId ?? null)

  const toggleShared = (shared: boolean) => {
    if (!textTrackId || isSettingShared) return
    setShared({ textTrackId, shared })
  }

  return (
    <ResponsiveOverlay open={open} onOpenChange={onOpenChange}>
      <OverlayContent>
        <OverlayHeader>
          <OverlayTitle>{sessionTitle}</OverlayTitle>
          <OverlayDescription className='sr-only'>{t`Actions for this session.`}</OverlayDescription>
        </OverlayHeader>
        <div className='flex flex-col gap-1 px-2 pb-2'>
          {shareState === 'not-shared' && (
            <OverlayActionRow
              icon={Globe}
              label={t`Share to Explore`}
              description={t`Publish to the public catalog — don't share private or copyrighted content`}
              disabled={isSettingShared}
              onClick={() => toggleShared(true)}
            />
          )}
          {shareState === 'shared' && (
            <OverlayActionRow
              icon={GlobeLock}
              label={t`Unshare from Explore`}
              description={t`Remove it from the public catalog — copies others already added stay with them`}
              disabled={isSettingShared}
              onClick={() => toggleShared(false)}
            />
          )}
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
