import { getSubscriptions } from './get-subscriptions/get-subscriptions'
import { components } from './revenuecat-api-types'
import { mockGetSubscriptions } from './get-subscriptions/mock-get-subscriptions'
import { getCustomer } from './get-customer/get-customer'
import { mockGetCustomer } from './get-customer/mock-get-customer'

export type ListSubscriptionsResponse = components['schemas']['ListSubscriptions']
export type Customer = components['schemas']['Customer']

export interface RevenuecatApi {
  getSubscriptions: (customerId: string) => Promise<ListSubscriptionsResponse | null>
  getCustomer: (customerId: string) => Promise<Customer | null>
}

export const RealRevenuecatApi: RevenuecatApi = {
  getSubscriptions,
  getCustomer,
}

export const MockRevenuecatApi: RevenuecatApi = {
  getSubscriptions: mockGetSubscriptions,
  getCustomer: mockGetCustomer,
}
