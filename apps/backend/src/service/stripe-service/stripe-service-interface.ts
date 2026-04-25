import { StripeCustomerId } from '../../transport/third-party/stripe/stripe-api'
import { PlanInterval } from '@template-app/core/constants/pricing-constants'

export interface StripeServiceInterface {
  createCheckoutSession: (
    userId: string,
    userEmail: string,
    successPathAndHash: string,
    cancelPathAndHash: string,
    plan: PlanInterval
  ) => Promise<string | null>

  createStripeCustomer: (userId: string, userEmail: string, referral: string | null) => Promise<StripeCustomerId | null>
}
