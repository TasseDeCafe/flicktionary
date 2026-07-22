import { useLingui } from '@lingui/react/macro'
import { Button } from '@flicktionary/ui/components/button'
import {
  ResponsiveOverlay,
  OverlayContent,
  OverlayHeader,
  OverlayTitle,
  OverlayDescription,
  OverlayFooter,
} from '@/components/ui/responsive-overlay'
import { useGetSessionDeletePreview, useRemoveStudySession } from '../api/sessions-hooks'

type Props = {
  open: boolean
  sessionId: string | null
  sessionTitle: string
  onOpenChange: (next: boolean) => void
  // Fires after a successful removal — the session view uses it to navigate
  // away from the now-gone session; list hosts don't need it.
  onRemoved?: () => void
}

export const SessionRemoveDialog = ({ open, sessionId, sessionTitle, onOpenChange, onRemoved }: Props) => {
  const { t } = useLingui()
  const { data: preview, isLoading } = useGetSessionDeletePreview(open ? sessionId : null)
  const { mutate: removeSession, isPending } = useRemoveStudySession()

  const canConfirm = !!sessionId && !isLoading && !isPending

  const { highlightCount, cardCount, keptCardCount } = preview ?? {}

  const handleConfirm = () => {
    if (!sessionId) return
    removeSession(
      { sessionId },
      {
        onSuccess: () => {
          onOpenChange(false)
          onRemoved?.()
        },
      }
    )
  }

  return (
    <ResponsiveOverlay open={open} onOpenChange={onOpenChange}>
      <OverlayContent>
        <OverlayHeader>
          <OverlayTitle>{t`Remove "${sessionTitle}"?`}</OverlayTitle>
          <OverlayDescription>
            {t`This hides the session from your list. Your kept vocabulary stays in your collection. The source text is retained so you can trace your kept words back to where you learned them. To erase everything, delete your account.`}
          </OverlayDescription>
        </OverlayHeader>

        <div className='px-4 pb-2 text-sm sm:px-0'>
          {isLoading && <p className='text-muted-foreground'>{t`Loading…`}</p>}
          {preview && (
            <ul className='text-muted-foreground space-y-1'>
              <li>{t`${highlightCount} highlight(s)`}</li>
              <li>{t`${cardCount} card(s) — of which ${keptCardCount} kept`}</li>
            </ul>
          )}
        </div>

        <OverlayFooter>
          <Button variant='outline' size='xl' onClick={() => onOpenChange(false)} disabled={isPending}>
            {t`Cancel`}
          </Button>
          <Button variant='destructive' size='xl' onClick={handleConfirm} disabled={!canConfirm}>
            {isPending ? t`Removing…` : t`Remove`}
          </Button>
        </OverlayFooter>
      </OverlayContent>
    </ResponsiveOverlay>
  )
}
