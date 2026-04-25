import { Customer } from '../revenuecat-api'

export const mockGetCustomer = async (customerId: string): Promise<Customer | null> => {
  return {
    object: 'customer',
    id: customerId,
    project_id: 'mock-project-id',
    first_seen_at: Date.now(),
    last_seen_at: Date.now(),
    last_seen_app_version: '1.0.0',
    last_seen_country: 'US',
    last_seen_platform: 'ios',
    last_seen_platform_version: '15.0',
  }
}
