import { sql } from '../postgres-client'
import { Enums, Tables } from '../database.public.types'

export type DbInterval = Enums<'subscription_interval'>
export type DbStripeSubscription = Tables<'stripe_subscriptions'>
// the description of all the Stripe status codes can be found here:
// https://docs.stripe.com/billing/subscriptions/overview#subscription-statuses

const insertSubscription = async (
  userId: string,
  stripeSubscriptionId: string,
  status: string,
  currentPeriodEnd: number,
  cancelAtPeriodEnd: boolean,
  trialEnd: number | null,
  stripeProductId: string,
  eventTimestamp: number,
  currency: string,
  amount: number | null,
  interval: DbInterval,
  intervalCount: number
): Promise<void> => {
  const currentPeriodEndDate = new Date(currentPeriodEnd * 1000).toISOString()
  const trialEndDate = trialEnd ? new Date(trialEnd * 1000).toISOString() : null
  const eventDate = new Date(eventTimestamp * 1000).toISOString()

  await sql`
    INSERT INTO public.stripe_subscriptions
    (user_id, stripe_subscription_id, status, current_period_end, cancel_at_period_end, trial_end, stripe_product_id, created_at, updated_at, currency, amount, interval, interval_count)
    VALUES
    (${userId}, ${stripeSubscriptionId}, ${status}::stripe_subscription_status,
    ${currentPeriodEndDate}, ${cancelAtPeriodEnd}, ${trialEndDate}, ${stripeProductId}, ${eventDate}, ${eventDate},
    ${currency}, ${amount}, ${interval}::subscription_interval, ${intervalCount})
  `
}

const upsertSubscription = async (
  userId: string,
  stripeSubscriptionId: string,
  status: string,
  currentPeriodEnd: number,
  cancelAtPeriodEnd: boolean,
  trialEnd: number | null,
  stripeProductId: string,
  eventTimestamp: number,
  currency: string,
  amount: number | null,
  interval: DbInterval,
  intervalCount: number
): Promise<void> => {
  const currentPeriodEndDate = new Date(currentPeriodEnd * 1000).toISOString()
  const trialEndDate = trialEnd ? new Date(trialEnd * 1000).toISOString() : null
  const eventDate = new Date(eventTimestamp * 1000).toISOString()

  await sql`
    INSERT INTO public.stripe_subscriptions
    (user_id, stripe_subscription_id, status, current_period_end, cancel_at_period_end, trial_end, stripe_product_id, updated_at, currency, amount, interval, interval_count)
    VALUES
    (${userId}, ${stripeSubscriptionId}, ${status}::stripe_subscription_status,
    ${currentPeriodEndDate}, ${cancelAtPeriodEnd}, ${trialEndDate}, ${stripeProductId}, ${eventDate},
    ${currency}, ${amount}, ${interval}::subscription_interval, ${intervalCount})
    ON CONFLICT (stripe_subscription_id)
    DO UPDATE SET
      status = EXCLUDED.status,
      current_period_end = EXCLUDED.current_period_end,
      cancel_at_period_end = EXCLUDED.cancel_at_period_end,
      trial_end = EXCLUDED.trial_end,
      stripe_product_id = EXCLUDED.stripe_product_id,
      updated_at = EXCLUDED.updated_at,
      currency = EXCLUDED.currency,
      amount = EXCLUDED.amount,
      interval = EXCLUDED.interval,
      interval_count = EXCLUDED.interval_count
  `
}

const getSubscriptionUpdatedAt = async (stripeSubscriptionId: string): Promise<number | null> => {
  const result = await sql`
    SELECT updated_at FROM public.stripe_subscriptions
    WHERE stripe_subscription_id = ${stripeSubscriptionId}
  `

  if (result.count > 0) {
    return new Date(result[0].updated_at).getTime() / 1000
  }
  return null
}

const cancelSubscription = async (subscriptionId: string): Promise<void> => {
  await sql`
    UPDATE public.stripe_subscriptions
    SET
      status = 'canceled',
      updated_at = NOW()
    WHERE stripe_subscription_id = ${subscriptionId}
  `
}

const getAllSubscriptions = async (): Promise<DbStripeSubscription[]> => {
  return await sql`
    SELECT *
    FROM public.stripe_subscriptions
  `
}

const getSubscriptionsByUserId = async (userId: string): Promise<DbStripeSubscription[]> => {
  return await sql`
    SELECT *
    FROM public.stripe_subscriptions
    WHERE user_id = ${userId}
  `
}

const findSubscriptionByStripeSubscriptionId = async (
  stripeSubscriptionId: string
): Promise<DbStripeSubscription | null> => {
  const result = await sql<DbStripeSubscription[]>`
    SELECT *
    FROM public.stripe_subscriptions
    WHERE stripe_subscription_id = ${stripeSubscriptionId}
  `

  if (result.count === 0) {
    return null
  }

  return result[0]
}

export interface StripeSubscriptionsRepositoryInterface {
  insertSubscription: (
    userId: string,
    stripeSubscriptionId: string,
    status: string,
    currentPeriodEnd: number,
    cancelAtPeriodEnd: boolean,
    trialEnd: number | null,
    stripeProductId: string,
    eventTimestamp: number,
    currency: string,
    amount: number | null,
    interval: DbInterval,
    intervalCount: number
  ) => Promise<void>
  upsertSubscription: (
    userId: string,
    stripeSubscriptionId: string,
    status: string,
    currentPeriodEnd: number,
    cancelAtPeriodEnd: boolean,
    trialEnd: number | null,
    stripeProductId: string,
    eventTimestamp: number,
    currency: string,
    amount: number | null,
    interval: DbInterval,
    intervalCount: number
  ) => Promise<void>
  getSubscriptionUpdatedAt: (stripeSubscriptionId: string) => Promise<number | null>
  cancelSubscription: (subscriptionId: string) => Promise<void>
  getAllSubscriptions: () => Promise<DbStripeSubscription[]>
  getSubscriptionsByUserId: (userId: string) => Promise<DbStripeSubscription[]>
  findSubscriptionByStripeSubscriptionId: (stripeSubscriptionId: string) => Promise<DbStripeSubscription | null>
}

export const StripeSubscriptionsRepository = (): StripeSubscriptionsRepositoryInterface => {
  return {
    insertSubscription,
    upsertSubscription,
    getSubscriptionUpdatedAt,
    cancelSubscription,
    getAllSubscriptions,
    getSubscriptionsByUserId,
    findSubscriptionByStripeSubscriptionId,
  }
}
