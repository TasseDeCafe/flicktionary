import { useEffect, useState } from 'react'
import {
  OverlayContent,
  OverlayDescription,
  OverlayHeader,
  OverlayTitle,
  useCloseOverlay,
} from '@/components/ui/responsive-overlay'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { getConfig } from '@/config/environment-config'
import { POSTHOG_EVENTS } from '@/lib/analytics/posthog-events'
import { Route as freeTrialExplanationRoute } from '@/app/routes/_authenticated/pricing/free-trial-explanation'
import { Route as checkoutSuccessRoute } from '@/app/routes/_authenticated/pricing/checkout-success'
import { Route as pricingRoute } from '@/app/routes/_authenticated/pricing/index'
import { getPricingViewConfig, PricingViewConfig } from '@/features/billing/utils/pricing-view-utils'
import { toast } from 'sonner'
import { useNavigate } from '@tanstack/react-router'
import { PlanInterval } from '@template-app/core/constants/pricing-constants'
import { PlanType } from '@template-app/api-client/orpc-contracts/billing-contract'
import { useGetSubscriptionDetails } from '@/features/billing/api/billing-hooks'
import { useCheckoutMutation } from '@/features/checkout/api/checkout-hooks'
import { useLingui } from '@lingui/react/macro'
import { useTrackingStore, getHasAllowedReferral } from '@/stores/tracking-store'

export const PricingOverlayContent = () => {
  const { t } = useLingui()
  const [clickedPlan, setClickedPlan] = useState<PlanType>('year')
  const hasAllowedReferral = useTrackingStore(getHasAllowedReferral)
  const navigate = useNavigate()
  const closeOverlay = useCloseOverlay()

  const handlePlanOptionClick = (planType: PlanType) => {
    POSTHOG_EVENTS.clickPlan('plan_radio_button', planType)
    if (isPremiumUser) {
      if (planType === 'free_trial') {
        toast.info(t`You have already used your free trial.`)
      } else {
        toast.info(t`To change your current plan type, please click on "Manage Subscription".`)
      }
    } else {
      setClickedPlan(planType)
    }
  }

  const { mutate, isPending: isPendingCheckoutMutation } = useCheckoutMutation()

  const { data: subscriptionData } = useGetSubscriptionDetails()

  const stripeDetails = subscriptionData?.stripeDetails
  const currentActivePlan = stripeDetails?.currentActivePlan || null
  const pricing = stripeDetails?.userPricingDetails || null

  useEffect(() => {
    if (currentActivePlan) {
      if (hasAllowedReferral || getConfig().featureFlags.isCreditCardRequiredForAll()) {
        if (currentActivePlan !== 'free_trial') {
          setClickedPlan(currentActivePlan)
        }
      } else {
        setClickedPlan(currentActivePlan)
      }
    }
  }, [currentActivePlan, hasAllowedReferral])

  const isPremiumUser = !!subscriptionData?.isPremiumUser

  const handleCTAClick = () => {
    POSTHOG_EVENTS.click('subscribe_button')
    if (hasAllowedReferral || getConfig().featureFlags.isCreditCardRequiredForAll()) {
      closeOverlay()
      navigate({ to: freeTrialExplanationRoute.to, search: { planInterval: clickedPlan as 'month' | 'year' } })
    } else {
      mutate({
        successPathAndHash: checkoutSuccessRoute.to,
        cancelPathAndHash: pricingRoute.to,
        planInterval: clickedPlan as PlanInterval,
      })
    }
  }

  const pricingViewConfig: PricingViewConfig = getPricingViewConfig({
    isPendingMutation: isPendingCheckoutMutation,
    clickedPlan: clickedPlan,
    pricingDetails: pricing || {
      amountInEurosThatUserIsCurrentlyPayingPerInterval: null,
      hasSubscribedWithADiscount: false,
      currentlyAvailableDiscounts: null,
      currentDiscountInPercentage: 0,
    },
    isCreditCardRequiredForAll: getConfig().featureFlags.isCreditCardRequiredForAll(),
    isPremiumUser: isPremiumUser,
    hasAllowedReferral,
    currentActivePlan,
  })

  return (
    <OverlayContent className='sm:max-w-md'>
      <OverlayHeader>
        <OverlayTitle>{t`Subscribe to access premium features`}</OverlayTitle>
        <OverlayDescription>{t`Choose a plan to unlock all features`}</OverlayDescription>
      </OverlayHeader>
      <div className='flex flex-col gap-4'>
        <RadioGroup
          value={clickedPlan ?? undefined}
          onValueChange={(value) => handlePlanOptionClick(value as PlanType)}
          disabled={isPremiumUser}
        >
          {pricingViewConfig.plans.map((option) => (
            <div key={option.value ?? 'none'} className='flex items-start space-x-3 rounded-lg border p-4'>
              <RadioGroupItem value={option.value ?? ''} id={`modal-${option.value}`} />
              <div className='flex flex-1 flex-col gap-1'>
                <div className='flex items-center gap-2'>
                  <Label htmlFor={`modal-${option.value}`} className='cursor-pointer font-medium'>
                    {option.label}
                  </Label>
                  {option.additionalMessage && <Badge variant='secondary'>{option.additionalMessage}</Badge>}
                </div>
                <div className='text-sm font-semibold'>{option.priceMessage}</div>
                {option.discountMessage && <div className='text-sm text-green-600'>{option.discountMessage}</div>}
                {option.billedYearly && <div className='text-muted-foreground text-sm'>{option.billedYearly}</div>}
              </div>
            </div>
          ))}
        </RadioGroup>

        <div className='flex flex-col gap-2'>
          <Button onClick={handleCTAClick} disabled={pricingViewConfig.subscribeButton.isDisabled}>
            {pricingViewConfig.subscribeButton.text}
          </Button>
          <Button variant='ghost' onClick={() => closeOverlay()}>
            {t`Maybe later`}
          </Button>
        </div>
      </div>
    </OverlayContent>
  )
}
