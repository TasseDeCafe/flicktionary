import { sql } from '../postgres-client'
import { Tables, TablesInsert } from '../database.public.types'

export type DbRevenuecatSubscriptionInput = Required<
  Omit<TablesInsert<'revenuecat_subscriptions'>, 'id' | 'created_at'>
>
export type DbRevenueCatSubscription = Tables<'revenuecat_subscriptions'>

export interface RevenuecatSubscriptionsRepositoryInterface {
  upsertSubscription: (subscription: DbRevenuecatSubscriptionInput) => Promise<void>
  getActiveSubscriptionsByUserId: (userId: string) => Promise<DbRevenueCatSubscription[]>
  getAllActiveSubscriptions: () => Promise<DbRevenueCatSubscription[]>
}

export const __getRevenuecatSubscriptionsByUserId = async (userId: string): Promise<DbRevenueCatSubscription[]> => {
  return await sql<DbRevenueCatSubscription[]>`
    SELECT *
    FROM public.revenuecat_subscriptions
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `
}

export const RevenuecatSubscriptionsRepository = (): RevenuecatSubscriptionsRepositoryInterface => {
  const upsertSubscription = async (subscription: DbRevenuecatSubscriptionInput): Promise<void> => {
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
  }

  const getActiveSubscriptionsByUserId = async (userId: string): Promise<DbRevenueCatSubscription[]> => {
    return await sql`
      SELECT *
      FROM public.revenuecat_subscriptions
      WHERE user_id = ${userId}
      AND gives_access = true
      ORDER BY created_at DESC
    `
  }

  const getAllActiveSubscriptions = async (): Promise<DbRevenueCatSubscription[]> => {
    return await sql`
      SELECT *
      FROM public.revenuecat_subscriptions
      WHERE gives_access = true
      ORDER BY created_at DESC
    `
  }

  return {
    upsertSubscription,
    getActiveSubscriptionsByUserId,
    getAllActiveSubscriptions,
  }
}
