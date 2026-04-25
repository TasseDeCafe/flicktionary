import { stripe } from '../stripe'
import { logCustomErrorMessageAndError } from '../../sentry/error-monitoring'
import { ListStripeSubscriptionsResponse } from '../stripe-api'

// https://docs.stripe.com/api/subscriptions/list?lang=node
export const listAllSubscriptions = async (customerId: string): Promise<ListStripeSubscriptionsResponse | null> => {
  try {
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      expand: ['data.latest_invoice'],
      status: 'all',
    })
    return subscriptions.data.map((subscription) => ({
      id: subscription.id,
      status: subscription.status,
      trial_end: subscription.trial_end,
      created: subscription.created,
    }))
  } catch (error) {
    logCustomErrorMessageAndError(`listSubscriptions - error, customerId - ${customerId}`, error)
    return null
  }
}
