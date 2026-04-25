import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { useNeedsSubscription } from '@/features/billing/hooks/use-needs-subscription'
import { useOverlayStore } from '@/features/overlay/stores/overlay-store'
import { OverlayId } from '@/components/ui/overlay-ids'
import { Route as premiumDemoRoute } from '@/app/routes/_authenticated/premium-demo'
import { Button } from '@/components/ui/button'

export const DashboardView = () => {
  const { t } = useLingui()
  const navigate = useNavigate()
  const { needsSubscription, isPending } = useNeedsSubscription()
  const openOverlay = useOverlayStore((state) => state.openOverlay)

  const isSubscribed = !needsSubscription && !isPending

  const handlePremiumPress = () => {
    if (isSubscribed) {
      navigate({ to: premiumDemoRoute.to })
    } else {
      openOverlay(OverlayId.PRICING)
    }
  }

  const getHeading = () => {
    if (isPending) return t`Premium`
    return isSubscribed ? t`Premium Features` : t`Unlock Premium`
  }

  const getDescription = () => {
    if (isPending) return t`Loading subscription status...`
    return isSubscribed
      ? t`Access exclusive premium features available to subscribers.`
      : t`Subscribe to unlock premium features and get the most out of the app.`
  }

  const getButtonText = () => {
    if (isPending) return t`Loading...`
    return isSubscribed ? t`View Premium Demo` : t`Subscribe Now`
  }

  return (
    <div className='flex flex-col gap-4 px-4 py-2'>
      <h1 className='text-xl font-bold'>{t`Dashboard`}</h1>

      <div className='rounded-lg p-4'>
        <h2 className='mb-2 text-lg font-semibold'>{getHeading()}</h2>
        <p className='mb-4 text-gray-600'>{getDescription()}</p>
        <Button onClick={handlePremiumPress} disabled={isPending}>
          {getButtonText()}
        </Button>
      </div>
    </div>
  )
}
