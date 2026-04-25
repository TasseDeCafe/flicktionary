import { logWithSentry } from '../../sentry/error-monitoring'
import { stripe } from '../stripe'
import Stripe from 'stripe'

export const cancelSubscription = async (subscriptionId: string): Promise<boolean> => {
  try {
    await stripe.subscriptions.cancel(subscriptionId)
    return true
  } catch (error) {
    // If the subscription is already canceled, Stripe will return this error.
    // We want the call to succeed in this scenario, so we can return true.
    if (error instanceof Stripe.errors.StripeError && error.code === 'resource_missing') {
      return true
    }

    logWithSentry({
      message: 'Error while cancelling subscription with Stripe',
      params: {
        subscriptionId: subscriptionId,
      },
      error,
    })
    return false
  }
}
