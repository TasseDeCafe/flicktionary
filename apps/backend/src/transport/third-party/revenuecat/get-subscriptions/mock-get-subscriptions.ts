import { components } from '../revenuecat-api-types'
import { getConfig } from '../../../../config/environment-config'

type ListSubscriptionsResponse = components['schemas']['ListSubscriptions']

export const mockGetSubscriptions = async (customerId: string): Promise<ListSubscriptionsResponse | null> => {
  const now = new Date()
  const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) // 30 days in the future
  const timestamp = now.getTime()
  const futureTimestamp = futureDate.getTime()

  return {
    object: 'list',
    items: [
      {
        object: 'subscription',
        id: 'sub_mock_123',
        customer_id: customerId,
        original_customer_id: customerId,
        product_id: 'prod_mock_123',
        starts_at: timestamp,
        ends_at: futureTimestamp,
        current_period_starts_at: timestamp,
        current_period_ends_at: futureDate.getTime(),
        gives_access: true,
        pending_payment: false,
        auto_renewal_status: 'will_renew',
        status: 'active',
        total_revenue_in_usd: {
          currency: 'USD',
          gross: 9.99,
          commission: 2.99,
          tax: 0.75,
          proceeds: 6.25,
        },
        presented_offering_id: 'offering_mock_123',
        entitlements: {
          object: 'list',
          items: [
            {
              object: 'entitlement',
              project_id: getConfig().revenuecatProjectId,
              id: 'ent_mock_123',
              lookup_key: 'premium',
              display_name: 'Premium',
              created_at: timestamp,
              products: {
                object: 'list',
                items: [
                  {
                    object: 'product',
                    id: 'prod_mock_123',
                    store_identifier: 'monthly.subscription',
                    type: 'subscription',
                    subscription: {
                      duration: 'P1M',
                      grace_period_duration: 'P3D',
                      trial_duration: 'P1W',
                    },
                    created_at: timestamp,
                    app_id: 'app_mock_123',
                    display_name: 'Premium Monthly',
                  },
                ],
                next_page: `/v2/projects/${getConfig().revenuecatProjectId}/entitlements/ent_mock_123/products?starting_after=prod_mock_123`,
                url: `/v2/projects/${getConfig().revenuecatProjectId}/entitlements/ent_mock_123/products`,
              },
            },
          ],
          next_page: `/v2/projects/${getConfig().revenuecatProjectId}/subscriptions/sub_mock_123/entitlements?starting_after=ent_mock_123`,
          url: `/v2/projects/${getConfig().revenuecatProjectId}/subscriptions/sub_mock_123/entitlements`,
        },
        environment: 'production',
        store: 'app_store',
        store_subscription_identifier: '123456789',
        ownership: 'purchased',
        country: 'US',
        management_url: 'https://apps.apple.com/account/subscriptions',
      },
    ],
    next_page: `/v2/projects/${getConfig().revenuecatProjectId}/customers/${customerId}/subscriptions?starting_after=sub_mock_123`,
    url: `/v2/projects/${getConfig().revenuecatProjectId}/customers/${customerId}/subscriptions`,
  }
}
