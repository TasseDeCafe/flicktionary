import { getConfig } from '../../../../config/environment-config'
import { stripe } from '../stripe'
import Stripe from 'stripe'

export const createCheckoutSessionUrl = async (
  customerId: string,
  priceId: string,
  userId: string,
  successPathAndHash: string,
  cancelPathAndHash: string,
  trialDays: number | undefined,
  referral: string | null,
  couponId: string | undefined
): Promise<string> => {
  const discounts = couponId ? [{ coupon: couponId }] : []
  const params: Stripe.Checkout.SessionCreateParams = {
    customer: customerId,
    success_url: `${getConfig().webUrl}${successPathAndHash}`,
    cancel_url: `${getConfig().webUrl}${cancelPathAndHash}`,
    payment_method_types: ['card', 'link'],
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      trial_period_days: trialDays,
      metadata: {
        user_id: userId,
        referral: referral,
      },
    },
    automatic_tax: {
      enabled: true,
    },
    tax_id_collection: {
      enabled: true,
    },
    billing_address_collection: 'auto',
    customer_update: {
      address: 'auto',
      name: 'auto',
    },
  }
  // stripe api returns an error if you try to pass both discounts and allow_promotion_codes fields
  if (discounts.length > 0) {
    params.discounts = discounts
  } else {
    params.allow_promotion_codes = true
  }
  const session = await stripe.checkout.sessions.create(params)
  if (!session.url) {
    throw new Error(`createCheckoutSession - session URL not found, customerId=${customerId}, priceId=${priceId}`)
  }
  return session.url
}
