import { logWithSentry } from '../../third-party/sentry/error-monitoring'
import { sql } from '../postgres-client'
import { Tables, TablesInsert } from '../database.public.types'

export type DbRevenuecatSubscriptionInput = Required<
  Omit<TablesInsert<'revenuecat_subscriptions'>, 'id' | 'created_at'>
>
export type DbRevenueCatSubscription = Tables<'revenuecat_subscriptions'>

export interface RevenuecatSubscriptionsRepositoryInterface {
  upsertSubscription: (subscription: DbRevenuecatSubscriptionInput) => Promise<boolean>
  getActiveSubscriptionsByUserId: (userId: string) => Promise<DbRevenueCatSubscription[]>
  getAllActiveSubscriptions: () => Promise<DbRevenueCatSubscription[]>
}

export const __getRevenuecatSubscriptionsByUserId = async (userId: string): Promise<DbRevenueCatSubscription[]> => {
  try {
    return await sql<DbRevenueCatSubscription[]>`
      SELECT *
      FROM public.revenuecat_subscriptions
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
    `
  } catch (error) {
    logWithSentry({ message: 'Error getting RevenueCat subscriptions', params: { userId }, error })
    return []
  }
}

export const RevenuecatSubscriptionsRepository = (): RevenuecatSubscriptionsRepositoryInterface => {
  const upsertSubscription = async (subscription: DbRevenuecatSubscriptionInput): Promise<boolean> => {
    try {
      await sql`
        INSERT INTO public.revenuecat_subscriptions 
        (user_id, revenuecat_subscription_id, revenuecat_original_customer_id,
         revenuecat_product_id, starts_at, current_period_starts_at, current_period_ends_at,
         gives_access, pending_payment, auto_renewal_status, status, total_revenue_in_usd,
         presented_offering_id, environment, store, store_subscription_identifier,
         ownership_type, billing_country_code, management_url, updated_at)
        VALUES 
        (${subscription.user_id}, ${subscription.revenuecat_subscription_id},
         ${subscription.revenuecat_original_customer_id}, ${subscription.revenuecat_product_id},
         ${subscription.starts_at}, ${subscription.current_period_starts_at}, ${subscription.current_period_ends_at},
         ${subscription.gives_access}, ${subscription.pending_payment}, ${subscription.auto_renewal_status},
         ${subscription.status}, ${subscription.total_revenue_in_usd}, ${subscription.presented_offering_id},
         ${subscription.environment}, ${subscription.store}, ${subscription.store_subscription_identifier},
         ${subscription.ownership_type}, ${subscription.billing_country_code}, ${subscription.management_url},
         ${subscription.updated_at})
        ON CONFLICT (revenuecat_subscription_id)
        DO UPDATE SET
          user_id = EXCLUDED.user_id,
          current_period_starts_at = EXCLUDED.current_period_starts_at,
          current_period_ends_at = EXCLUDED.current_period_ends_at,
          gives_access = EXCLUDED.gives_access,
          pending_payment = EXCLUDED.pending_payment,
          auto_renewal_status = EXCLUDED.auto_renewal_status,
          status = EXCLUDED.status,
          total_revenue_in_usd = EXCLUDED.total_revenue_in_usd,
          updated_at = EXCLUDED.updated_at
      `
      return true
    } catch (error) {
      logWithSentry({
        message: 'Error upserting RevenueCat subscription',
        params: {
          userId: subscription.user_id,
          subscriptionId: subscription.revenuecat_subscription_id,
          status: subscription.status,
          givesAccess: subscription.gives_access,
        },
        error,
      })
      return false
    }
  }

  const getActiveSubscriptionsByUserId = async (userId: string): Promise<DbRevenueCatSubscription[]> => {
    try {
      return await sql`
        SELECT *
        FROM public.revenuecat_subscriptions
        WHERE user_id = ${userId}
        AND gives_access = true
        ORDER BY created_at DESC
      `
    } catch (error) {
      logWithSentry({ message: 'Error getting active RevenueCat subscriptions', params: { userId }, error })
      return []
    }
  }

  const getAllActiveSubscriptions = async (): Promise<DbRevenueCatSubscription[]> => {
    try {
      return await sql`
        SELECT *
        FROM public.revenuecat_subscriptions
        WHERE gives_access = true
        ORDER BY created_at DESC
      `
    } catch (error) {
      logWithSentry({ message: 'Error getting all active RevenueCat subscriptions', params: {}, error })
      return []
    }
  }

  return {
    upsertSubscription,
    getActiveSubscriptionsByUserId,
    getAllActiveSubscriptions,
  }
}
