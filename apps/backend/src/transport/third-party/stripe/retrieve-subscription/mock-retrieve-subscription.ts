import { RetrieveSubscriptionResponse } from '../stripe-api'

export const mockRetrieveSubscription = async (
  subscriptionId: string
): Promise<RetrieveSubscriptionResponse | null> => {
  return {
    id: subscriptionId,
    status: 'active',
    current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days from now
    cancel_at_period_end: false,
    trial_end: null,
    items: {
      data: [
        {
          price: {
            product: 'prod_mock123',
          },
          plan: {
            interval: 'month',
            interval_count: 1,
            amount: 1900,
            currency: 'usd',
          },
        },
      ],
    },
    metadata: {
      user_id: '00000000-0000-4000-a000-000000000001',
    },
  }
}
