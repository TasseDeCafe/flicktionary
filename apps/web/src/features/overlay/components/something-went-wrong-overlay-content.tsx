import { RefreshButton } from './refresh-button'
import { OverlayContent, OverlayDescription, OverlayHeader, OverlayTitle } from '@/components/ui/responsive-overlay'
import { useLingui } from '@lingui/react/macro'
import { useOverlayStore } from '@/features/overlay/stores/overlay-store'

export const SomethingWentWrongOverlayContent = () => {
  const { t } = useLingui()

  const userFacingErrorCode = useOverlayStore((state) => state.userFacingErrorCode)

  return (
    <OverlayContent className='sm:max-w-md'>
      <OverlayHeader>
        <OverlayTitle className='text-center'>{t`Error`}</OverlayTitle>
        <OverlayDescription className='text-center'>
          {t`Something went wrong. Please refresh the page and try again.`}
        </OverlayDescription>
      </OverlayHeader>
      <div className='flex flex-col gap-4'>
        <p className='text-muted-foreground text-center text-xs'>{t`error code: ${userFacingErrorCode}`}</p>
        <RefreshButton />
      </div>
    </OverlayContent>
  )
}
