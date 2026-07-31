import { useNavigate } from '@tanstack/react-router'
import { UserRoundPlus } from 'lucide-react'
import {
  OverlayContent,
  OverlayDescription,
  OverlayHeader,
  OverlayTitle,
  useCloseOverlay,
} from '@/components/ui/responsive-overlay'
import { Button } from '@flicktionary/ui/components/button'
import { useLingui } from '@lingui/react/macro'

// Shown by the central error handler when the backend answers a
// source-creating call with GUEST_SOURCE_LIMIT_REACHED: the cap doubles as the
// conversion moment, so the prompt leads straight into /save-progress.
export const GuestSourceLimitOverlayContent = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const closeOverlay = useCloseOverlay()

  const handleCreateAccount = () => {
    closeOverlay()
    void navigate({ to: '/save-progress' })
  }

  return (
    <OverlayContent className='sm:max-w-md'>
      <OverlayHeader>
        <div className='flex justify-center'>
          <UserRoundPlus className='text-foreground size-8' />
        </div>
        <OverlayTitle className='text-center'>{t`You've filled your guest library`}</OverlayTitle>
        <OverlayDescription className='text-center'>
          {t`Guest browsing includes a few sources to try Flicktionary. Create a free account to keep adding — everything you've saved carries over.`}
        </OverlayDescription>
      </OverlayHeader>
      <div className='flex flex-col gap-2'>
        <Button size='xl' className='w-full' onClick={handleCreateAccount}>
          {t`Create a free account`}
        </Button>
        <Button size='xl' variant='ghost' className='w-full' onClick={closeOverlay}>
          {t`Not now`}
        </Button>
      </div>
    </OverlayContent>
  )
}
