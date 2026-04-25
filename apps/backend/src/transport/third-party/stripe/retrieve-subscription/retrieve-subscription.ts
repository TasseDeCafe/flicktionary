import { stripe } from '../stripe'
import { logMessage, logCustomErrorMessageAndError } from '../../sentry/error-monitoring'
import { RetrieveSubscriptionResponse } from '../stripe-api'
import Stripe from 'stripe'

import { DbInterval } from '../../../database/stripe-subscriptions/stripe-subscriptions-repository'

export const retrieveSubscription = async (subscriptionId: string): Promise<RetrieveSubscriptionResponse | null> => {
  try {
    const subscription: Stripe.Response<Stripe.Subscription> = await stripe.subscriptions.retrieve(subscriptionId)
    return {
      id: subscription.id,
      status: subscription.status,
      current_period_end: subscription.items.data[0].current_period_end ?? 0,
      cancel_at_period_end: subscription.cancel_at_period_end,
      trial_end: subscription.trial_end,
      items: {
        data: subscription.items.data.map((item) => ({
          price: {
            product: getProductId(item.price.product, subscriptionId),
          },
          plan: {
            interval: item.price.recurring?.interval as DbInterval,
            interval_count: item.price.recurring?.interval_count ?? 1,
            amount: item.price.unit_amount,
            currency: item.price.currency,
          },
        })),
      },
      metadata: {
        user_id: subscription.metadata.user_id,
      },
    }
  } catch (error) {
    logCustomErrorMessageAndError(`retrieveSubscription error, subscriptionId - ${subscriptionId}`, error)
    return null
  }
}

const getProductId = (product: string | Stripe.Product | Stripe.DeletedProduct, subscriptionId: string): string => {
  if (typeof product === 'string') {
    return product
  }
  if (product.id) {
    return product.id
  }
  logMessage(`getProductId: product - ${JSON.stringify(product)}, subscriptionId - ${subscriptionId}`)
  return 'Unknown'
}
