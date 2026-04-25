import { STRIPE_MONTHLY_PRICE_IN_EUR, STRIPE_YEARLY_PRICE_IN_EUR } from '@template-app/core/constants/pricing-constants'
import { ALLOWED_REFERRALS } from '@template-app/core/constants/referral-constants'
import { Discounts } from '@template-app/core/constants/discount-types'

export const getMonthlyPrice = (discounts: Discounts): number => {
  const basePrice = STRIPE_MONTHLY_PRICE_IN_EUR
  if (!discounts.areActive) {
    return basePrice
  }
  return Number((((100 - discounts.monthly.discountAsPercentage) * basePrice) / 100).toFixed(2))
}

export const getYearlyPrice = (discounts: Discounts): number => {
  const basePrice = STRIPE_YEARLY_PRICE_IN_EUR
  if (!discounts.areActive) {
    return basePrice
  }
  return Number((((100 - discounts.yearly.discountAsPercentage) * basePrice) / 100).toFixed(2))
}

export const getCanSubscribeWithReferralDiscount = (referral: string, discounts: Discounts): boolean => {
  return ALLOWED_REFERRALS.includes(referral) && discounts.areActive
}

export const getMonthlyDiscountString = (
  discountPercentage: number,
  durationLimit: number | null,
  referralDiscountLabel: string,
  referralDiscountMonthLabel: string,
  referralDiscountMonthsLabel: string
): string | null => {
  if (!durationLimit) {
    return referralDiscountLabel.replace('{discount}', discountPercentage.toString())
  }
  if (durationLimit === 1) {
    return referralDiscountMonthLabel.replace('{discount}', discountPercentage.toString())
  }
  return referralDiscountMonthsLabel
    .replace('{discount}', discountPercentage.toString())
    .replace('{duration}', durationLimit.toString())
}

export const getYearlyDiscountString = (
  discountPercentage: number,
  durationLimit: number | null,
  referralDiscountLabel: string,
  referralDiscountYearLabel: string,
  referralDiscountYearsLabel: string
): string | null => {
  if (!durationLimit) {
    return referralDiscountLabel.replace('{discount}', discountPercentage.toString())
  }
  if (durationLimit === 1) {
    return referralDiscountYearLabel.replace('{discount}', discountPercentage.toString())
  }
  return referralDiscountYearsLabel
    .replace('{discount}', discountPercentage.toString())
    .replace('{duration}', durationLimit.toString())
}
