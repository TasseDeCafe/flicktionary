import { Discounts } from './discount-types'

export const referralToDiscount: Record<string, Discounts> = {
  tiengos: {
    areActive: true,
    monthly: {
      discountAsPercentage: 20,
      stripeCouponId: 'tiengos_monthly',
      durationLimit: 3,
      commissionLimit: null,
    },
    yearly: {
      discountAsPercentage: 40,
      stripeCouponId: 'tiengos_yearly',
      durationLimit: 1,
      commissionLimit: null,
    },
  },
  languageboost: {
    areActive: false,
    monthly: {
      discountAsPercentage: 20,
      stripeCouponId: 'languageboost_monthly',
      durationLimit: 3,
      commissionLimit: 3,
    },
    yearly: {
      discountAsPercentage: 40,
      stripeCouponId: 'languageboost_yearly',
      durationLimit: 1,
      commissionLimit: null,
    },
  },
}

export const getDiscountsForReferral = (referral: string): Discounts => {
  const discount: Discounts | undefined = referralToDiscount[referral]
  if (!discount) {
    return {
      areActive: false,
      monthly: {
        discountAsPercentage: 0,
        stripeCouponId: '',
        durationLimit: null,
        commissionLimit: null,
      },
      yearly: {
        discountAsPercentage: 0,
        stripeCouponId: '',
        durationLimit: null,
        commissionLimit: null,
      },
    }
  }
  return discount
}

export const ALLOWED_REFERRALS = Object.keys(referralToDiscount) as string[]
