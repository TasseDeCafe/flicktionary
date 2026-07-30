import { StripeSubscriptionsRepositoryInterface } from '../../transport/database/stripe-subscriptions/stripe-subscriptions-repository'
import {
  ListStripeSubscriptionsResponse,
  RetrieveSubscriptionResponse,
  StripeApi,
} from '../../transport/third-party/stripe/stripe-api'
import { StripeWebhookServiceInterface } from './stripe-webhook-service-interface'
import { AccessCacheServiceInterface } from '../long-running/subscription-cache-service/access-cache-service'
import { DbUser, UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import { logError } from '../../transport/error-monitoring/error-monitoring'

export const StripeWebhookService = (
  stripeApi: StripeApi,
  stripeSubscriptionsRepository: StripeSubscriptionsRepositoryInterface,
  accessCacheService: AccessCacheServiceInterface,
  usersRepository: UsersRepositoryInterface
): StripeWebhookServiceInterface => {
  const syncStripeSubscriptionWithOurDbAndCache = async (customerId: string): Promise<boolean> => {
    let subscriptions: ListStripeSubscriptionsResponse
    let dbUser: DbUser | null
    try {
      // Catch here so the webhook router can keep its specific
      // "subscription was not synced successfully" log; without this, an
      // infra throw would only surface as the generic boundary log.
      ;[subscriptions, dbUser] = await Promise.all([
        stripeApi.listAllSubscriptions(customerId),
        usersRepository.findUserByStripeCustomerId(customerId),
      ])
    } catch (error) {
      logError({ message: 'syncStripeSubscription: failed to load inputs', params: { customerId }, error })
      return false
    }
    if (!dbUser) {
      // this happens when user removed his account, by this time we don't have his subscriptions in the db, and we should not try to sync them
      return true
    }
    if (subscriptions.length === 0) {
      logError({
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
    const subscriptionWithMoreDetails: RetrieveSubscriptionResponse = await stripeApi.retrieveSubscription(
      mostRecentSubscription.id
    )

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

    await stripeSubscriptionsRepository.upsertSubscription(
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
    await accessCacheService.updateForUser(userId)
    return true
  }

  return {
    syncStripeSubscriptionWithOurDbAndCache,
  }
}
