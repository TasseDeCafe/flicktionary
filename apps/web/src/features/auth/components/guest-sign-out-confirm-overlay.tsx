import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import {
  ResponsiveOverlay,
  OverlayContent,
  OverlayDescription,
  OverlayHeader,
  OverlayTitle,
} from '@/components/ui/responsive-overlay'
import { Button } from '@flicktionary/ui/components/button'

interface GuestSignOutConfirmOverlayProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  isSigningOut: boolean
  onSignOutAnyway: () => void
}

// A guest session has no credential to sign back in with, so signing out
// permanently orphans everything the guest saved. Steer them to the
// save-progress conversion flow before letting them proceed.
export const GuestSignOutConfirmOverlay = ({
  open,
  onOpenChange,
  isSigningOut,
  onSignOutAnyway,
}: GuestSignOutConfirmOverlayProps) => {
  const { t } = useLingui()
  const navigate = useNavigate()

  // Close before navigating so the drawer/dialog tears down cleanly instead of
  // being unmounted mid-open by the route change (which can leave body styles).
  const handleCreateAccount = () => {
    onOpenChange(false)
    void navigate({ to: '/save-progress' })
  }

  return (
    <ResponsiveOverlay open={open} onOpenChange={onOpenChange}>
      <OverlayContent className='sm:max-w-md'>
        <OverlayHeader>
          <OverlayTitle className='text-center'>{t`Sign out of your guest session?`}</OverlayTitle>
          <OverlayDescription className='text-center'>
            {t`There's no way to sign back in to a guest session. If you sign out now, everything you've saved — sessions, vocabulary, and practice progress — will be permanently lost. Create a free account first to keep it.`}
          </OverlayDescription>
        </OverlayHeader>
        <div className='flex flex-col gap-2'>
          <Button size='xl' onClick={handleCreateAccount} disabled={isSigningOut}>
            {t`Create account first`}
          </Button>
          <Button size='xl' variant='destructive' onClick={onSignOutAnyway} disabled={isSigningOut}>
            {isSigningOut ? t`Signing out…` : t`Sign out anyway`}
          </Button>
        </div>
      </OverlayContent>
    </ResponsiveOverlay>
  )
}
