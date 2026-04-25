import { ListStripeSubscriptionsResponse } from '../stripe-api'

export const mockListAllSubscriptions = async (
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  customerId: string
): Promise<ListStripeSubscriptionsResponse | null> => {
  return [
    {
      id: 'sub_free_trial_id',
      status: 'trialing',
      trial_end: 1679798400,
      created: 1679798400,
    },
  ]
}
