import { logCustomErrorMessageAndError, logWithSentry } from '../../../transport/third-party/sentry/error-monitoring'
import {
  DbRevenueCatSubscription,
  RevenuecatSubscriptionsRepositoryInterface,
} from '../../../transport/database/revenuecat-subscriptions/revenuecat-subscriptions-repository'
import {
  DbStripeSubscription,
  StripeSubscriptionsRepositoryInterface,
} from '../../../transport/database/stripe-subscriptions/stripe-subscriptions-repository'
import { isStripeSubscriptionActive } from './stripe-subscription.utils'
import { UsersRepositoryInterface } from '../../../transport/database/users/users-repository'
import { getConfig } from '../../../config/environment-config'
import { NUMBER_OF_DAYS_IN_FREE_TRIAL } from '@template-app/core/constants/pricing-constants'

export interface AccessCacheServiceInterface {
  hasUserId: (userId: string) => boolean
  initialize: () => void
  stop: () => void
  updateForUser: (userId: string) => Promise<void>
}

export const AccessCacheService = (
  stripeSubscriptionsRepository: StripeSubscriptionsRepositoryInterface,
  revenueCatSubscriptionsRepository: RevenuecatSubscriptionsRepositoryInterface,
  usersRepository: UsersRepositoryInterface
): AccessCacheServiceInterface => {
  const cache = new Set<string>()
  const REFRESH_INTERVAL = 15 * 60 * 1000 // 15 minutes default
  let intervalId: NodeJS.Timeout | null = null

  const loadAllSubscriptions = async (): Promise<void> => {
    const [stripeSubscriptions, activeRevenuecatSubscriptions]: [DbStripeSubscription[], DbRevenueCatSubscription[]] =
      await Promise.all([
        stripeSubscriptionsRepository.getAllSubscriptions(),
        revenueCatSubscriptionsRepository.getAllActiveSubscriptions(),
      ])

    const activeStripeSubscriptions = stripeSubscriptions.filter(isStripeSubscriptionActive)
    const activeUserIds = new Set<string>()

    for (const subscription of activeStripeSubscriptions) {
      activeUserIds.add(subscription.user_id)
    }

    for (const subscription of activeRevenuecatSubscriptions) {
      activeUserIds.add(subscription.user_id)
    }

    if (!getConfig().featureFlags.isCreditCardRequiredForAll()) {
      const recentUsers: string[] =
        await usersRepository.retrieveAllUsersCreatedLessThanNDaysAgo(NUMBER_OF_DAYS_IN_FREE_TRIAL)
      for (const userId of recentUsers) {
        activeUserIds.add(userId)
      }
    }

    for (const userId of cache) {
      if (!activeUserIds.has(userId)) {
        cache.delete(userId)
      }
    }
    for (const userId of activeUserIds) {
      cache.add(userId)
    }
  }

  return {
    hasUserId: (userId: string): boolean => {
      return cache.has(userId)
    },

    initialize: async (): Promise<void> => {
      loadAllSubscriptions().then(() => {
        console.log('Subscription cache initialized')
      })
      intervalId = setInterval(() => loadAllSubscriptions(), REFRESH_INTERVAL)
    },

    stop: (): void => {
      if (intervalId) {
        clearInterval(intervalId)
        intervalId = null
      }
    },

    updateForUser: async (userId: string): Promise<void> => {
      try {
        const [stripeSubscriptions, revenueCatActiveSubscriptions, isInTrialPeriodWithoutCreditCard] =
          await Promise.all([
            stripeSubscriptionsRepository.getSubscriptionsByUserId(userId),
            revenueCatSubscriptionsRepository.getActiveSubscriptionsByUserId(userId),
            !getConfig().featureFlags.isCreditCardRequiredForAll()
              ? usersRepository
                  .retrieveAllUsersCreatedLessThanNDaysAgo(NUMBER_OF_DAYS_IN_FREE_TRIAL)
                  .then((users) => users.includes(userId))
              : Promise.resolve(false),
          ])

        if (stripeSubscriptions.some(isStripeSubscriptionActive) && revenueCatActiveSubscriptions.length > 0) {
          logWithSentry({
            message: 'User has both stripe and revenuecat active subscriptions',
            params: {
              userId,
            },
          })
        }

        if (
          stripeSubscriptions.some(isStripeSubscriptionActive) ||
          revenueCatActiveSubscriptions.length > 0 ||
          isInTrialPeriodWithoutCreditCard
        ) {
          cache.add(userId)
        } else {
          cache.delete(userId)
        }
      } catch (error) {
        logCustomErrorMessageAndError(`updateForUser error - userId - ${userId}`, error)
      }
    },
  }
}
