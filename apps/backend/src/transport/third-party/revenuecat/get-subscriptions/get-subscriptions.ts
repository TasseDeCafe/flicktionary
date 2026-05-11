import { client } from '../revenuecat'
import { ListSubscriptionsResponse } from '../revenuecat-api'

export const getSubscriptions = async (customerId: string): Promise<ListSubscriptionsResponse> => {
  const response = await client.get(`/customers/${customerId}/subscriptions`)
  return response.data
}
