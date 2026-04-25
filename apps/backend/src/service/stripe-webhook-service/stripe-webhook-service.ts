import { StripeSubscriptionsRepositoryInterface } from '../../transport/database/stripe-subscriptions/stripe-subscriptions-repository'
import {
  ListStripeSubscriptionsResponse,
  RetrieveSubscriptionResponse,
  StripeApi,
} from '../../transport/third-party/stripe/stripe-api'
import { StripeWebhookServiceInterface } from './stripe-webhook-service-interface'
import { AccessCacheServiceInterface } from '../long-running/subscription-cache-service/access-cache-service'
import { DbUser, UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import { logWithSentry } from '../../transport/third-party/sentry/error-monitoring'

export const StripeWebhookService = (
  stripeApi: StripeApi,
  stripeSubscriptionsRepository: StripeSubscriptionsRepositoryInterface,
  accessCacheService: AccessCacheServiceInterface,
  usersRepository: UsersRepositoryInterface
): StripeWebhookServiceInterface => {
  const syncStripeSubscriptionWithOurDbAndCache = async (customerId: string): Promise<boolean> => {
    const [subscriptions, dbUser]: [ListStripeSubscriptionsResponse | null, DbUser | null] = await Promise.all([
      stripeApi.listAllSubscriptions(customerId),
      usersRepository.findUserByStripeCustomerId(customerId),
    ])
    if (!dbUser) {
      // this happens when user removed his account, by this time we don't have his subscriptions in the db, and we should not try to sync them
      return true
    }
    if (!subscriptions) {
      logWithSentry({
        message: "could not retrieve user's subscriptions",
        params: {
          customerId,
        },
      })
      return false
    }
    if (subscriptions.length === 0) {
      logWithSentry({
        message: 'user has no subscription, while at least one subscription is expected',
        params: {
          customerId,
        },
      })
      return false
    }
    // I could not find a confirmation that the first subscription in the list is the most recent one,
    // so I am sorting the list by created timestamp
    const mostRecentSubscription: {
      id: string
      created: number
      status: string
      trial_end: number | null
    } = subscriptions.sort((a, b) => b.created - a.created)[0]

    // todo stripe v2: check if we can do it with a single call to Stripe API, note that we initially decided to store more
    // than Theo recommends, so it's not clear if a listSubscriptions call give us all the data we need
    // as we store more data in our database, like amount, interval etc
    // We might not need the below additional call to Stripe API, but I tried to have less changes when migrating from our stripe v1 to v2
    const subscriptionWithMoreDetails: RetrieveSubscriptionResponse | null = await stripeApi.retrieveSubscription(
      mostRecentSubscription.id
    )

    if (!subscriptionWithMoreDetails) {
      return false
    }

    const { id, status, current_period_end, cancel_at_period_end, trial_end, items, metadata } =
      subscriptionWithMoreDetails
    const userId = metadata.user_id
    const productId = items.data[0].price.product
    const updatedAt = Math.floor(Date.now() / 1000)
    const plan = items.data[0].plan
    const currency = plan.currency
    const amount = plan.amount
    const interval = plan.interval
    const interval_count = plan.interval_count

    const isSuccessfullyUpserted: boolean = await stripeSubscriptionsRepository.upsertSubscription(
      userId,
      id,
      status,
      current_period_end,
      cancel_at_period_end,
      trial_end,
      productId,
      updatedAt,
      currency,
      amount,
      interval,
      interval_count
    )
    if (!isSuccessfullyUpserted) {
      logWithSentry({
        message: 'Error upserting subscription',
        params: {
          userId,
          id,
          status,
          current_period_end,
          cancel_at_period_end,
          trial_end,
          productId,
          updatedAt,
          currency,
          amount,
          interval,
          interval_count,
        },
      })
    }
    await accessCacheService.updateForUser(userId)
    return true
  }

  return {
    syncStripeSubscriptionWithOurDbAndCache,
  }
}
