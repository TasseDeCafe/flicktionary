import { client } from '../revenuecat'
import { Customer } from '../revenuecat-api'

export const getCustomer = async (customerId: string): Promise<Customer | null> => {
  try {
    const response = await client.get(`/customers/${customerId}`)
    return response.data
  } catch {
    // todo revenuecat: we should log an error if it's not a 404
    return null
  }
}
