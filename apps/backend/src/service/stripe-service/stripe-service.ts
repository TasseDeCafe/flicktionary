import { logError } from '../../transport/error-monitoring/error-monitoring'
import { StripeApi, StripeCustomerId } from '../../transport/third-party/stripe/stripe-api'
import { getConfig } from '../../config/environment-config'
import { getDiscountsForReferral } from '@flicktionary/core/constants/referral-constants'
import { NUMBER_OF_DAYS_IN_FREE_TRIAL, PlanInterval } from '@flicktionary/core/constants/pricing-constants'
import { StripeServiceInterface } from './stripe-service-interface'
import { DbUser, UsersRepositoryInterface } from '../../transport/database/users/users-repository'

const getPriceId = (planType: PlanInterval): string | null => {
  if (planType === 'month') {
    return getConfig().stripeMonthlyPriceInEurId
  } else if (planType === 'year') {
    return getConfig().stripeYearlyPriceInEurId
  } else {
    return null
  }
}

export const StripeService = (
  stripeApi: StripeApi,
  usersRepository: UsersRepositoryInterface
): StripeServiceInterface => {
  const createCheckoutSession = async (
    userId: string,
    email: string,
    successPathAndHash: string,
    cancelPathAndHash: string,
    planInterval: PlanInterval
  ): Promise<string | null> => {
    const user: DbUser | null = await usersRepository.findUserByUserId(userId)
    if (!user) {
      logError({
        message: 'createCheckoutSession - user not found for userId',
        params: {
          userId,
        },
      })
      return null
    }
    const referral: string | null = user.referral
    let customerId: string
    if (user?.stripe_customer_id) {
      customerId = user.stripe_customer_id
    } else {
      const freshlyCreatedCustomerId = await stripeApi.createCustomerWithMetadata(userId, email, referral)

      const hasUpdatedUserStripeCustomerId = await usersRepository.updateUserStripeCustomerId(
        userId,
        freshlyCreatedCustomerId
      )
      if (!hasUpdatedUserStripeCustomerId) {
        logError({
          message: 'createCheckoutSession - Stripe customer could not be updated for userId',
          params: {
            userId,
            customerId: freshlyCreatedCustomerId,
          },
        })
        return null
      }
      customerId = freshlyCreatedCustomerId
    }

    let trialDays: number | undefined = undefined

    // todo stripe v2: rethink after our stripe v2 solution, we could simplify this and always give a free trial to users who
    // introduce a credit card, even if they managed to use our app without one before, wykop users would fall into this
    if (referral || getConfig().featureFlags.isCreditCardRequiredForAll()) {
      trialDays = NUMBER_OF_DAYS_IN_FREE_TRIAL
    }

    let couponId: string | undefined = undefined

    if (referral && getDiscountsForReferral(referral).areActive) {
      const discountsForGivenReferral = getDiscountsForReferral(referral)
      if (planInterval === 'month') {
        couponId = discountsForGivenReferral.monthly.stripeCouponId
      } else if (planInterval === 'year') {
        couponId = discountsForGivenReferral.yearly.stripeCouponId
      }
    }

    const priceId: string | null = getPriceId(planInterval)
    if (!priceId) {
      logError({
        message: 'price id could not be chosen',
        params: {
          planInterval,
          referral,
          userId,
          priceId,
        },
      })
      return null
    }

    return await stripeApi.createCheckoutSessionUrl(
      customerId,
      priceId,
      userId,
      successPathAndHash,
      cancelPathAndHash,
      trialDays,
      referral,
      couponId
    )
  }

  const createStripeCustomer = async (
    userId: string,
    userEmail: string,
    referral: string | null
  ): Promise<StripeCustomerId | null> => {
    const customerId = await stripeApi.createCustomerWithMetadata(userId, userEmail, referral)

    const hasUpdatedUserStripeCustomerId = await usersRepository.updateUserStripeCustomerId(userId, customerId)
    if (!hasUpdatedUserStripeCustomerId) {
      return null
    }

    return customerId
  }

  return {
    createCheckoutSession,
    createStripeCustomer,
  }
}
