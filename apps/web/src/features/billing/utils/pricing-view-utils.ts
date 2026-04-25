import {
  NUMBER_OF_DAYS_IN_FREE_TRIAL,
  STRIPE_MONTHLY_PRICE_IN_EUR,
  STRIPE_YEARLY_PRICE_IN_EUR,
} from '@template-app/core/constants/pricing-constants.ts'
import { PlanType, UserStripePricingDetails } from '@template-app/api-client/orpc-contracts/billing-contract'
import { t } from '@lingui/core/macro'

export type PlanOption = {
  label: string
  value: PlanType
  priceMessage: string
  discountMessage: string | null
  additionalMessage?: string
  billedYearly?: string
}

export type PricingViewConfig = {
  plans: PlanOption[]
  subscribeButton: {
    isDisabled: boolean
    text: string
  }
  startButton: {
    shouldBeShown: boolean
    text: string
  }
}

export const getPricingViewConfig = ({
  isPendingMutation,
  clickedPlan,
  pricingDetails,
  isCreditCardRequiredForAll,
  isPremiumUser,
  hasAllowedReferral,
  currentActivePlan,
}: {
  isPendingMutation: boolean
  clickedPlan: PlanType
  pricingDetails: UserStripePricingDetails
  isCreditCardRequiredForAll: boolean
  isPremiumUser: boolean
  hasAllowedReferral: boolean
  currentActivePlan: PlanType | null
}): PricingViewConfig => {
  const planOptions: PlanOption[] = []

  const isSubscribedToFreeTrial = currentActivePlan === 'free_trial'
  const isSubscribedToMonthlyPlan = currentActivePlan === 'month'
  const isSubscribedToYearlyPlan = currentActivePlan === 'year'
  const canSubscribeWithReferralDiscount = pricingDetails?.currentlyAvailableDiscounts && !isPremiumUser

  const yearlyPrice = getYearlyPrice(pricingDetails, isSubscribedToYearlyPlan)
  const monthlyPrice = getMonthlyPrice(pricingDetails, isSubscribedToMonthlyPlan)

  const yearlyPricePerMonth = (yearlyPrice / 12).toFixed(2)
  const yearlyPriceTotal = yearlyPrice.toFixed(2)
  const monthlyPriceFormatted = monthlyPrice.toFixed(2)

  planOptions.push(
    {
      label: `${t`Yearly`}${isSubscribedToYearlyPlan ? ` ${t`(Current)`}` : ''}`,
      value: 'year',
      priceMessage: t`€${yearlyPricePerMonth}/month`,
      discountMessage: getYearlyDiscountString(pricingDetails, isSubscribedToYearlyPlan),
      additionalMessage: t`best value`,
      billedYearly: t`Billed yearly at €${yearlyPriceTotal}`,
    },
    {
      label: `${t`Monthly`}${isSubscribedToMonthlyPlan ? ` ${t`(Current)`}` : ''}`,
      value: 'month',
      priceMessage: t`€${monthlyPriceFormatted}/month`,
      discountMessage: getMonthlyDiscountString(pricingDetails, isSubscribedToMonthlyPlan),
    }
  )

  if (!hasAllowedReferral && !isCreditCardRequiredForAll) {
    planOptions.push({
      label: `${t`Free Trial`} ${isSubscribedToFreeTrial ? t`(Current)` : t`(Expired)`}`,
      value: 'free_trial',
      discountMessage: null,
      priceMessage: t`Free for ${NUMBER_OF_DAYS_IN_FREE_TRIAL} days`,
      additionalMessage: '',
    })
  }

  const getButtonText = () => {
    if (clickedPlan === 'free_trial') {
      if (canSubscribeWithReferralDiscount) {
        return t`START ${NUMBER_OF_DAYS_IN_FREE_TRIAL}-DAY FREE TRIAL`
      } else {
        if (isSubscribedToFreeTrial) {
          return t`Your current plan`
        } else {
          return t`You used your free trial`
        }
      }
    }
    if (isPremiumUser) {
      if (isPendingMutation) {
        return t`Loading...`
      } else {
        return t`Manage Subscription`
      }
    }
    if (isPendingMutation) {
      return t`Loading...`
    }
    if (currentActivePlan === 'free_trial') {
      return t`START ${NUMBER_OF_DAYS_IN_FREE_TRIAL}-DAY FREE TRIAL`
    } else {
      return t`START ${NUMBER_OF_DAYS_IN_FREE_TRIAL}-DAY FREE TRIAL`
    }
  }

  const shouldShowStartButton = () => {
    if (hasAllowedReferral || isCreditCardRequiredForAll) {
      if (isSubscribedToMonthlyPlan || isSubscribedToYearlyPlan) {
        return true
      }
    } else {
      if (
        isSubscribedToMonthlyPlan ||
        isSubscribedToYearlyPlan ||
        (isSubscribedToFreeTrial && clickedPlan === 'free_trial')
      ) {
        return true
      }
    }
    return false
  }

  return {
    plans: planOptions,
    subscribeButton: {
      isDisabled: clickedPlan === 'free_trial',
      text: getButtonText(),
    },
    startButton: {
      shouldBeShown: shouldShowStartButton(),
      text: t`Start`,
    },
  }
}

const getMonthlyPrice = (pricingDetails: UserStripePricingDetails, isSubscribedToMonthlyPlan: boolean): number => {
  const basePrice = STRIPE_MONTHLY_PRICE_IN_EUR
  if (pricingDetails.hasSubscribedWithADiscount && isSubscribedToMonthlyPlan) {
    return basePrice * (1 - pricingDetails.currentDiscountInPercentage / 100)
  }
  if (!pricingDetails.currentlyAvailableDiscounts) {
    return basePrice
  }
  return ((100 - pricingDetails.currentlyAvailableDiscounts.monthly.discountAsPercentage) / 100) * basePrice
}

const getYearlyPrice = (pricingDetails: UserStripePricingDetails, isSubscribedToYearlyPlan: boolean): number => {
  const basePrice = STRIPE_YEARLY_PRICE_IN_EUR
  if (pricingDetails.hasSubscribedWithADiscount && isSubscribedToYearlyPlan) {
    return basePrice * (1 - pricingDetails.currentDiscountInPercentage / 100)
  }
  if (!pricingDetails.currentlyAvailableDiscounts) {
    return basePrice
  }
  return ((100 - pricingDetails.currentlyAvailableDiscounts.yearly.discountAsPercentage) / 100) * basePrice
}

const getMonthlyDiscountString = (
  pricingDetails: UserStripePricingDetails,
  isSubscribedToMonthlyPlan: boolean
): string | null => {
  if (pricingDetails.hasSubscribedWithADiscount && isSubscribedToMonthlyPlan) {
    const discountPercentage = pricingDetails.currentDiscountInPercentage
    return t`${discountPercentage}% off thanks to your past referral!`
  }
  if (!pricingDetails.currentlyAvailableDiscounts) {
    return null
  }
  const durationLimit = pricingDetails.currentlyAvailableDiscounts.monthly.durationLimit
  const discount = pricingDetails.currentlyAvailableDiscounts.monthly.discountAsPercentage
  if (!durationLimit) {
    return t`${discount}% off with your referral forever!`
  }
  if (durationLimit === 1) {
    return t`${discount}% off with your referral for 1 month!`
  }
  return t`${discount}% off with your referral for ${durationLimit} months!`
}

const getYearlyDiscountString = (
  pricingDetails: UserStripePricingDetails,
  isSubscribedToYearlyPlan: boolean
): string | null => {
  if (pricingDetails.hasSubscribedWithADiscount && isSubscribedToYearlyPlan) {
    const discountPercentage = pricingDetails.currentDiscountInPercentage
    return t`${discountPercentage}% off thanks to your past referral!`
  }
  if (!pricingDetails.currentlyAvailableDiscounts) {
    return null
  }
  const durationLimit = pricingDetails.currentlyAvailableDiscounts.yearly.durationLimit
  const discount = pricingDetails.currentlyAvailableDiscounts.yearly.discountAsPercentage
  if (!durationLimit) {
    return t`${discount}% off with your referral forever!`
  }
  if (durationLimit === 1) {
    return t`${discount}% off with your referral for 1 year!`
  }
  return t`${discount}% off with your referral for ${durationLimit} years!`
}
