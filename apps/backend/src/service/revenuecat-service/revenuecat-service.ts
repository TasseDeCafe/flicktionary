import { RevenuecatServiceInterface } from './revenuecat-service-interface'
import { AccessCacheServiceInterface } from '../long-running/subscription-cache-service/access-cache-service'
import { RevenuecatApi } from '../../transport/third-party/revenuecat/revenuecat-api'
import { logMessage } from '../../transport/third-party/sentry/error-monitoring'
import { RevenuecatSubscriptionsRepositoryInterface } from '../../transport/database/revenuecat-subscriptions/revenuecat-subscriptions-repository'

export const RevenuecatService = (
  accessCacheService: AccessCacheServiceInterface,
  revenueCatSubscriptionsRepository: RevenuecatSubscriptionsRepositoryInterface,
  revenuecatApi: RevenuecatApi
): RevenuecatServiceInterface => ({
  syncRevenuecatSubscriptionWithOurDbAndCache: async (relevantUserId: string) => {
    const customer = await revenuecatApi.getCustomer(relevantUserId)
    if (!customer) {
      await accessCacheService.updateForUser(relevantUserId)
      return
    }

    const subscriptions = await revenuecatApi.getSubscriptions(relevantUserId)
    if (!subscriptions?.items) {
      logMessage(`No subscriptions found for user ${relevantUserId}`)
      await accessCacheService.updateForUser(relevantUserId)
      return
    }

    for (const subscription of subscriptions.items) {
      await revenueCatSubscriptionsRepository.upsertSubscription({
        user_id: relevantUserId,
        revenuecat_subscription_id: subscription.id,
        revenuecat_original_customer_id: subscription.original_customer_id,
        revenuecat_product_id: subscription.product_id,
        starts_at: new Date(subscription.starts_at).toISOString(),
        current_period_starts_at: new Date(subscription.current_period_starts_at).toISOString(),
        current_period_ends_at: subscription.current_period_ends_at
          ? new Date(subscription.current_period_ends_at).toISOString()
          : null,
        gives_access: subscription.gives_access,
        pending_payment: subscription.pending_payment,
        auto_renewal_status: subscription.auto_renewal_status,
        status: subscription.status,
        total_revenue_in_usd: subscription.total_revenue_in_usd.proceeds,
        presented_offering_id: subscription.presented_offering_id,
        environment: subscription.environment,
        store: subscription.store,
        store_subscription_identifier: subscription.store_subscription_identifier,
        ownership_type: subscription.ownership,
        billing_country_code: subscription.country ?? null,
        management_url: subscription.management_url,
        updated_at: new Date().toISOString(),
      })
    }

    await accessCacheService.updateForUser(relevantUserId)

    // todo revenuecat: update google doc subscriptions (ensure uses relevantUserId)
    // todo revenuecat: update current plan and current_plan and current_plan_interval on customerio (ensure uses relevantUserId)
    return
  },
})
