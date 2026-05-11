import { stripe } from '../stripe'
import { ListStripeSubscriptionsResponse } from '../stripe-api'

// https://docs.stripe.com/api/subscriptions/list?lang=node
export const listAllSubscriptions = async (customerId: string): Promise<ListStripeSubscriptionsResponse> => {
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
}
