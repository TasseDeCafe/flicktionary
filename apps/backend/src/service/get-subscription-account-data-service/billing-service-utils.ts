import { STRIPE_MONTHLY_PRICE_IN_EUR, STRIPE_YEARLY_PRICE_IN_EUR } from '@template-app/core/constants/pricing-constants'
import { Discounts } from '@template-app/core/constants/discount-types'
import { PlanType, UserStripePricingDetails } from '@template-app/api-client/orpc-contracts/billing-contract'

// normal means the price before discounts are applied
// we use NonNullable here because there is already a type guard where this function is called
const getPlanNormalPrice = (planType: NonNullable<PlanType>): number => {
  switch (planType) {
    case 'free_trial':
      return 0
    case 'month':
      return STRIPE_MONTHLY_PRICE_IN_EUR
    case 'year':
      return STRIPE_YEARLY_PRICE_IN_EUR
  }
}

export const calculateStripePricingDetails = (
  referral: string | null,
  referralToDiscountsMap: Record<string, Discounts>,
  amount: number | null,
  currentActivePlan: PlanType | null
): UserStripePricingDetails => {
  let currentPlanNormalPrice: number | null
  if (currentActivePlan) {
    currentPlanNormalPrice = getPlanNormalPrice(currentActivePlan)
  } else {
    currentPlanNormalPrice = null
  }
  let currentDiscountInPercentage: number
  if (currentActivePlan && currentPlanNormalPrice && amount) {
    currentDiscountInPercentage = Math.round(((currentPlanNormalPrice - amount) / currentPlanNormalPrice) * 100)
  } else {
    currentDiscountInPercentage = 0
  }
  if (referral) {
    const discountsForGivenReferral: Discounts | undefined = referralToDiscountsMap[referral]
    if (discountsForGivenReferral.areActive) {
      return {
        currentDiscountInPercentage: currentDiscountInPercentage,
        amountInEurosThatUserIsCurrentlyPayingPerInterval: amount,
        hasSubscribedWithADiscount: currentDiscountInPercentage > 0,
        currentlyAvailableDiscounts: {
          monthly: {
            discountAsPercentage: discountsForGivenReferral.monthly.discountAsPercentage,
            durationLimit: discountsForGivenReferral.monthly.durationLimit,
          },
          yearly: {
            discountAsPercentage: discountsForGivenReferral.yearly.discountAsPercentage,
            durationLimit: discountsForGivenReferral.yearly.durationLimit,
          },
        },
      }
    } else {
      return {
        currentDiscountInPercentage,
        amountInEurosThatUserIsCurrentlyPayingPerInterval: amount,
        hasSubscribedWithADiscount: currentDiscountInPercentage > 0,
        currentlyAvailableDiscounts: null,
      }
    }
  } else {
    return {
      currentDiscountInPercentage,
      amountInEurosThatUserIsCurrentlyPayingPerInterval: amount,
      hasSubscribedWithADiscount: false,
      currentlyAvailableDiscounts: null,
    }
  }
}
