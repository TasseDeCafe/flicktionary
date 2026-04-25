import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Route as checkoutSuccessRoute } from '@/app/routes/_authenticated/pricing/checkout-success'
import { Route as pricingRoute } from '@/app/routes/_authenticated/pricing/index'
import { Route as freeTrialExplanationRoute } from '@/app/routes/_authenticated/pricing/free-trial-explanation'
import { FullViewLoader } from '@/components/ui/full-view-loader'
import { useCheckoutMutation } from '@/features/checkout/api/checkout-hooks'
import { useTrackingStore } from '@/stores/tracking-store'
import { useIsUserSetupComplete } from '@/features/user/api/user-hooks'
import { Route as RedirectToCheckOutRoute } from '@/app/routes/_authenticated/redirect-to-check-out/$planInterval'

// This component is reached after the route /from-landing.
// We want to redirect users who clicked on the premium button on the landing page to be directed to the checkout page
// right after signing up. We need this additional route because Supabase login will strip search params from the url,
// so we have to send the user to a new route that uses a query param in order to preserve the priceId.
export const RedirectToCheckOut = () => {
  const navigate = useNavigate()
  const { planInterval } = RedirectToCheckOutRoute.useParams()
  const referral = useTrackingStore((state) => state.referral)
  const isUserSetupComplete = useIsUserSetupComplete()

  const { mutate, isPending } = useCheckoutMutation()

  useEffect(() => {
    if (!isUserSetupComplete || isPending) {
      return
    }

    if (referral) {
      navigate({ to: freeTrialExplanationRoute.to, search: { planInterval } })
    } else {
      mutate({
        successPathAndHash: checkoutSuccessRoute.to,
        cancelPathAndHash: pricingRoute.to,
        planInterval: planInterval,
      })
    }
  }, [planInterval, mutate, isPending, isUserSetupComplete, referral, navigate])

  return <FullViewLoader />
}
