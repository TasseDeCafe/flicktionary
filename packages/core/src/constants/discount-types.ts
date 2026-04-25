export type Discounts = {
  areActive: boolean
  monthly: {
    discountAsPercentage: number
    stripeCouponId: string //  corresponds to the coupons' ids in stripe here: https://dashboard.stripe.com/coupons, do not remove coupons on stripe, it's a great documentation
    durationLimit: number | null // for example: 3 means the discount works for 3 months, null means it works forever as long as the user is subscribed
    commissionLimit: number | null // for example: 3 means that the creator will stop getting commissions after 3 months, null means it works forever as long as the user is subscribed
  }
  yearly: {
    discountAsPercentage: number
    stripeCouponId: string //  corresponds to the coupons' ids in stripe here: https://dashboard.stripe.com/coupons, do not remove coupons on stripe, it's a great documentation
    durationLimit: number | null // for example: 2 means the discount works for 2 years, null means it works forever as long as the user is subscribed
    commissionLimit: number | null // for example: 2 means that the creator will stop getting commissions after 2 years, null means it works forever as long as the user is subscribed
  }
}
