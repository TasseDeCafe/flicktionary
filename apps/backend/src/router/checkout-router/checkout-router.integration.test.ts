import { describe, expect, it } from 'vitest'
import {
  __createCheckoutSessionWithOurApi,
  __createOrGetUserWithOurApi,
  __createUserInSupabaseAndGetHisIdAndToken,
  __createUserRightAfterSignup,
  __generateUniqueId,
  buildTestApp,
} from '../../test/test-utils'
import { MockStripeApi, StripeApi } from '../../transport/third-party/stripe/stripe-api'
import { UsersRepository } from '../../transport/database/users/users-repository'

describe('Checkout Router', () => {
  it('should handle errors when creating a checkout session', async () => {
    const { token } = await __createUserInSupabaseAndGetHisIdAndToken()
    const stripeApi = {
      ...MockStripeApi,
      createCheckoutSessionUrl: async () => {
        throw new Error('Stripe checkout session creation failed')
      },
    }
    const testApp = buildTestApp({ stripeApi })
    await __createOrGetUserWithOurApi({ testApp, token, referral: null })

    const checkoutSessionResponse = await __createCheckoutSessionWithOurApi(testApp, token)

    expect(checkoutSessionResponse.status).toBe(500)
    // The boundary middleware genericizes uncaught throws to "Internal server
    // error"; the underlying error is in PostHog error tracking. See error-boundary-middleware.ts.
    expect(checkoutSessionResponse.body.data).toEqual({
      errors: [{ message: 'Internal server error' }],
    })
  })

  it('should reject unauthenticated requests', async () => {
    const testApp = buildTestApp()
    const checkoutSessionResponse = await __createCheckoutSessionWithOurApi(testApp, 'invalid_token')
    expect(checkoutSessionResponse.status).toBe(401)
  })

  it('should create a checkout session successfully and create a customer only once', async () => {
    // Track stripe customer creation calls
    let createCustomerCallCount = 0
    // users.stripe_customer_id is looked up globally, so it must not collide
    // with rows from other tests or previous runs.
    const mockStripeCustomerId = __generateUniqueId('cus')

    const partialStripeMock: Partial<StripeApi> = {
      createCustomerWithMetadata: async () => {
        createCustomerCallCount++
        return mockStripeCustomerId
      },
      createCheckoutSessionUrl: async () => 'https://checkout.stripe.com/pay/cs_test123',
    }

    const stripeApi = {
      ...MockStripeApi,
      ...partialStripeMock,
    }

    const { token, testApp } = await __createUserRightAfterSignup({ appDependencies: { stripeApi } })

    const usersRepository = UsersRepository()

    const userBeforeCheckout = await usersRepository.findUserByStripeCustomerId(mockStripeCustomerId)
    expect(userBeforeCheckout).toBeNull()
    expect(createCustomerCallCount).toBe(0)

    const firstCheckoutResponse = await __createCheckoutSessionWithOurApi(testApp, token)
    expect(firstCheckoutResponse.status).toBe(200)
    expect(firstCheckoutResponse.body.data).toEqual({
      url: 'https://checkout.stripe.com/pay/cs_test123',
    })

    const userAfterFirstCheckout = await usersRepository.findUserByStripeCustomerId(mockStripeCustomerId)
    expect(userAfterFirstCheckout).not.toBeNull()
    expect(createCustomerCallCount).toBe(1)

    const secondCheckoutResponse = await __createCheckoutSessionWithOurApi(testApp, token)
    expect(secondCheckoutResponse.status).toBe(200)
    expect(secondCheckoutResponse.body.data).toEqual({
      url: 'https://checkout.stripe.com/pay/cs_test123',
    })

    expect(createCustomerCallCount).toBe(1)
  })
})
