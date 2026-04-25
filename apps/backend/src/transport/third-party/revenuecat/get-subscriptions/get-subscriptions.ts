import { client } from '../revenuecat'
import { ListSubscriptionsResponse } from '../revenuecat-api'
import { logWithSentry } from '../../sentry/error-monitoring'

export const getSubscriptions = async (customerId: string): Promise<ListSubscriptionsResponse | null> => {
  try {
    const response = await client.get(`/customers/${customerId}/subscriptions`)
    return response.data
  } catch (error) {
    logWithSentry({
      message: 'Error getting customer subscriptions',
      params: { customerId },
      error,
    })
    return null
  }
}
