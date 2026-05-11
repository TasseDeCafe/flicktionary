import { stripe } from '../stripe'
import Stripe from 'stripe'

export const cancelSubscription = async (subscriptionId: string): Promise<void> => {
  try {
    await stripe.subscriptions.cancel(subscriptionId)
  } catch (error) {
    // If the subscription is already canceled, Stripe returns this error.
    // Treat it as success — cancel is idempotent in our domain.
    if (error instanceof Stripe.errors.StripeError && error.code === 'resource_missing') {
      return
    }
    throw error
  }
}
