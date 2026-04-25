import { calculateStripePricingDetails } from './billing-service-utils'
import { referralToDiscount } from '@template-app/core/constants/referral-constants'
import { isStripeSubscriptionActive } from '../long-running/subscription-cache-service/stripe-subscription.utils'
import { DbUser, UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import {
  DbStripeSubscription,
  StripeSubscriptionsRepositoryInterface,
} from '../../transport/database/stripe-subscriptions/stripe-subscriptions-repository'
import { RevenuecatSubscriptionsRepositoryInterface } from '../../transport/database/revenuecat-subscriptions/revenuecat-subscriptions-repository'
import { logWithSentry } from '../../transport/third-party/sentry/error-monitoring'
import { NUMBER_OF_DAYS_IN_FREE_TRIAL } from '@template-app/core/constants/pricing-constants'
import {
  GetSubscriptionInfoResponse,
  PlanType,
  SupportedBillingPlatform,
  UserStripePricingDetails,
} from '@template-app/api-client/orpc-contracts/billing-contract'
import { getConfig } from '../../config/environment-config'
import { RevenuecatServiceInterface } from '../revenuecat-service/revenuecat-service-interface'

export interface BillingServiceInterface {
  getBillingData: (userId: string) => Promise<GetSubscriptionInfoResponse | null>
}

const calculateStripePlan = (subscription: DbStripeSubscription | null): PlanType | null => {
  if (!subscription) {
    return null
  }

  if (subscription.cancel_at_period_end && subscription.status === 'trialing' && subscription.interval === 'month') {
    return 'free_trial'
  } else {
    return subscription.interval ?? 'month'
  }
}

const wasUserCreatedLessThanNDaysAgo = (dbUser: DbUser, N: number): boolean => {
  if (!dbUser.created_at) return false

  const now = new Date()
  const userCreationDate = new Date(dbUser.created_at)
  const diffTime = Math.abs(now.getTime() - userCreationDate.getTime())
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

  return diffDays < N
}

export const BillingService = (
  usersRepository: UsersRepositoryInterface,
  stripeSubscriptionsRepository: StripeSubscriptionsRepositoryInterface,
  revenueCatSubscriptionsRepository: RevenuecatSubscriptionsRepositoryInterface,
  revenuecatService: RevenuecatServiceInterface
): BillingServiceInterface => {
  const getBillingData = async (userId: string): Promise<GetSubscriptionInfoResponse | null> => {
    await revenuecatService.syncRevenuecatSubscriptionWithOurDbAndCache(userId)
    const [dbUser, stripeSubscriptions, revenueCatActiveSubscriptions] = await Promise.all([
      usersRepository.findUserByUserId(userId),
      stripeSubscriptionsRepository.getSubscriptionsByUserId(userId),
      revenueCatSubscriptionsRepository.getActiveSubscriptionsByUserId(userId),
    ])

    if (!dbUser) {
      return null
    }

    const referral = dbUser.referral
    const hasStripeSubscriptions = stripeSubscriptions.length > 0
    const hasActiveRevenueCatSubscription = revenueCatActiveSubscriptions.length > 0

    const latestStripeSubscription: DbStripeSubscription | null = hasStripeSubscriptions
      ? stripeSubscriptions.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
      : null

    const hasActiveStripeSubscription = latestStripeSubscription
      ? isStripeSubscriptionActive(latestStripeSubscription)
      : false

    if (!latestStripeSubscription && !hasActiveRevenueCatSubscription) {
      let calculatedCurrentActivePlan: 'free_trial' | null
      if (getConfig().featureFlags.isCreditCardRequiredForAll()) {
        calculatedCurrentActivePlan = null
      } else {
        calculatedCurrentActivePlan = wasUserCreatedLessThanNDaysAgo(dbUser, NUMBER_OF_DAYS_IN_FREE_TRIAL)
          ? 'free_trial'
          : null
      }
      return {
        stripeDetails: {
          status: null,
          lastActivePlan: null,
          currentActivePlan: calculatedCurrentActivePlan,
          userPricingDetails: calculateStripePricingDetails(referral, referralToDiscount, null, null),
        },
        revenueCatDetails: {
          managementUrl: null,
        },
        billingPlatform: null,
        isPremiumUser: calculatedCurrentActivePlan === 'free_trial',
        isSpecialUserWithFullAccess: false,
      }
    }

    if (hasActiveStripeSubscription && hasActiveRevenueCatSubscription) {
      logWithSentry({
        message: 'User has both stripe and revenuecat active subscriptions',
        params: { userId },
      })
    }

    let billingPlatform: SupportedBillingPlatform | null = null
    let currentStripeActivePlan: PlanType | null = null
    let revenueCatManagementUrl: string | null = null

    if (hasActiveStripeSubscription && latestStripeSubscription) {
      billingPlatform = 'stripe'
      currentStripeActivePlan = calculateStripePlan(latestStripeSubscription)
    } else if (hasActiveRevenueCatSubscription) {
      const activeRevenueCatSubscription = revenueCatActiveSubscriptions[0]
      revenueCatManagementUrl = activeRevenueCatSubscription.management_url
      if (activeRevenueCatSubscription.store === 'app_store') {
        billingPlatform = 'app_store'
      } else if (activeRevenueCatSubscription.store === 'play_store') {
        billingPlatform = 'play_store'
      } else if (activeRevenueCatSubscription.store == 'test_store') {
        billingPlatform = 'test_store'
      } else {
        logWithSentry({
          message: 'Billing platform not supported for RevenueCat store',
          params: { store: activeRevenueCatSubscription.store },
        })
      }
    } else {
      billingPlatform = null
      currentStripeActivePlan = null
    }

    const latestStripeSubscriptionPlan = calculateStripePlan(latestStripeSubscription)

    const stripeAmount: number | null = latestStripeSubscription?.amount ?? null
    const amountInEuros: number | null = stripeAmount ? stripeAmount / 100 : null

    const userStripePricingDetails: UserStripePricingDetails = calculateStripePricingDetails(
      referral,
      referralToDiscount,
      amountInEuros,
      currentStripeActivePlan
    )

    return {
      stripeDetails: {
        status: latestStripeSubscription?.status ?? null,
        lastActivePlan: latestStripeSubscriptionPlan,
        currentActivePlan: currentStripeActivePlan,
        userPricingDetails: userStripePricingDetails,
      },
      revenueCatDetails: {
        managementUrl: revenueCatManagementUrl,
      },
      billingPlatform,
      isPremiumUser: !!billingPlatform,
      isSpecialUserWithFullAccess: false,
    }
  }

  return {
    getBillingData: getBillingData,
  }
}
