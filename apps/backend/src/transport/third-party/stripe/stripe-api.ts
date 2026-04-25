import { createCustomerWithMetadata } from './create-customer-with-metadata/create-customer-with-metadata'
import { mockCreateCustomerWithMetadata } from './create-customer-with-metadata/mock-create-customer-with-metadata'
import { createCheckoutSessionUrl } from './create-checkout-session/create-checkout-session-url'
import { mockCreateCheckoutSessionUrl } from './create-checkout-session/mock-create-checkout-session-url'
import { createBillingPortalUrl } from './create-billing-portal-url/create-billing-portal-url'
import { mockCreateBillingPortalUrl } from './create-billing-portal-url/mock-create-billing-portal-url'
import { retrieveSubscription } from './retrieve-subscription/retrieve-subscription'
import { mockRetrieveSubscription } from './retrieve-subscription/mock-retrieve-subscription'
import { cancelSubscription } from './cancel-subscription/cancel-subscription'
import { mockCancelSubscription } from './cancel-subscription/mock-cancel-subscription'
import { listAllSubscriptions } from './list-subscriptions/list-all-subscriptions'
import { mockListAllSubscriptions } from './list-subscriptions/mock-list-all-subscriptions'
import { DbInterval } from '../../database/stripe-subscriptions/stripe-subscriptions-repository'

export type StripeApi = {
  createCustomerWithMetadata: (
    userId: string,
    userEmail: string,
    referral: string | null
  ) => Promise<StripeCustomerId | null>
  createCheckoutSessionUrl: (
    customerId: string,
    priceId: string,
    userId: string,
    successPathAndHash: string,
    cancelPathAndHash: string,
    trialDays: number | undefined,
    referral: string | null,
    couponId: string | undefined
  ) => Promise<string | null>
  cancelSubscription: (subscriptionId: string) => Promise<boolean>
  retrieveSubscription: (subscriptionId: string) => Promise<RetrieveSubscriptionResponse | null>
  createBillingPortalUrl: (customerId: string, returnUrl: string) => Promise<string | null>
  listAllSubscriptions: (customerId: string) => Promise<ListStripeSubscriptionsResponse | null>
}

export type StripeCustomerId = string

export type CreateSubscriptionResponse = {
  id: string
  status: string
  currentPeriodEnd: number
  cancelAtPeriodEnd: boolean
  trialEnd: number | null
  productId: string
  createdAt: number
  currency: string
  amount: number | null
  interval: DbInterval
  interval_count: number
}

export type RetrieveSubscriptionResponse = {
  id: string
  status: string
  current_period_end: number
  cancel_at_period_end: boolean
  trial_end: number | null
  items: {
    data: Array<{
      price: {
        product: string
      }
      plan: {
        interval: DbInterval
        interval_count: number
        amount: number | null
        currency: string
      }
    }>
  }
  metadata: {
    user_id: string
  }
}

export type ListSubscriptionsResponseOld = {
  id: string
  status: string
  trial_end: number | null
}[]

// a subset of fields defined here: https://docs.stripe.com/api/subscriptions/list
export type ListStripeSubscriptionsResponse = {
  id: string
  created: number
  status: string
  trial_end: number | null
}[]

export const RealStripeApi: StripeApi = {
  createCustomerWithMetadata,
  createCheckoutSessionUrl,
  cancelSubscription,
  retrieveSubscription,
  createBillingPortalUrl,
  listAllSubscriptions,
}

export const MockStripeApi: StripeApi = {
  createCustomerWithMetadata: mockCreateCustomerWithMetadata,
  createCheckoutSessionUrl: mockCreateCheckoutSessionUrl,
  cancelSubscription: mockCancelSubscription,
  retrieveSubscription: mockRetrieveSubscription,
  createBillingPortalUrl: mockCreateBillingPortalUrl,
  listAllSubscriptions: mockListAllSubscriptions,
}
