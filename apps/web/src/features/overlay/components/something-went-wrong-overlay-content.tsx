import { RefreshButton } from './refresh-button'
import {
  OverlayContent,
  OverlayDescription,
  OverlayFooter,
  OverlayHeader,
  OverlayTitle,
} from '@/components/ui/responsive-overlay'
import { useLingui } from '@lingui/react/macro'
import { useOverlayStore } from '@/features/overlay/stores/overlay-store'

export const SomethingWentWrongOverlayContent = () => {
  const { t } = useLingui()

  const userFacingErrorCode = useOverlayStore((state) => state.userFacingErrorCode)

  return (
    <OverlayContent className='w-11/12 rounded-xl bg-white p-8 sm:max-w-md'>
      <OverlayHeader className='mb-5'>
        <OverlayTitle>Error</OverlayTitle>
        <OverlayDescription className='hidden'></OverlayDescription>
      </OverlayHeader>
      <p className='text-sm text-gray-500'>{t`Something went wrong. Please refresh the page and try again.`}</p>
      <p className='text-sm text-gray-500'>{t`error code: ${userFacingErrorCode}`}</p>
      <OverlayFooter>
        <RefreshButton />
      </OverlayFooter>
    </OverlayContent>
  )
}
