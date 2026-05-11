import axios from 'axios'
import { client } from '../revenuecat'
import { Customer } from '../revenuecat-api'

export const getCustomer = async (customerId: string): Promise<Customer | null> => {
  try {
    const response = await client.get(`/customers/${customerId}`)
    return response.data
  } catch (error) {
    // 404 = customer hasn't been created in RevenueCat yet (legitimate domain
    // outcome — e.g. mobile app user who hasn't yet hit a purchase flow).
    // Anything else is an infra failure and propagates.
    if (axios.isAxiosError(error) && error.response?.status === 404) return null
    throw error
  }
}
