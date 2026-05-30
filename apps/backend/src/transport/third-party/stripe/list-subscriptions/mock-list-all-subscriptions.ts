import { ListStripeSubscriptionsResponse } from '../stripe-api'

export const mockListAllSubscriptions = async (customerId: string): Promise<ListStripeSubscriptionsResponse> => {
  return [
    {
      id: 'sub_free_trial_id',
      status: 'trialing',
      trial_end: 1679798400,
      created: 1679798400,
    },
  ]
}
