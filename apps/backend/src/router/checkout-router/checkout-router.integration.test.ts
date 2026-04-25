import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  __createCheckoutSessionWithOurApi,
  __createOrGetUserWithOurApi,
  __createUserInSupabaseAndGetHisIdAndToken,
  __createUserRightAfterSignup,
  __removeAllAuthUsersFromSupabase,
  buildTestApp,
} from '../../test/test-utils'
import { MockStripeApi, StripeApi } from '../../transport/third-party/stripe/stripe-api'
import { __deleteAllHandledStripeEvents } from '../../transport/database/webhook-events/handled-stripe-events-repository'
import { UsersRepository } from '../../transport/database/users/users-repository'

describe('Checkout Router', () => {
  beforeEach(async () => {
    await __removeAllAuthUsersFromSupabase()
    await __deleteAllHandledStripeEvents()
  })

  afterAll(async () => {
    await __removeAllAuthUsersFromSupabase()
    await __deleteAllHandledStripeEvents()
  })

  it('should handle errors when creating a checkout session', async () => {
    const { token } = await __createUserInSupabaseAndGetHisIdAndToken()
    const stripeApi = {
      ...MockStripeApi,
      createCheckoutSessionUrl: async () => {
        return null
      },
    }
    const testApp = buildTestApp({ stripeApi })
    await __createOrGetUserWithOurApi({ testApp, token, referral: null })

    const checkoutSessionResponse = await __createCheckoutSessionWithOurApi(testApp, token)

    expect(checkoutSessionResponse.status).toBe(500)
    expect(checkoutSessionResponse.body.data).toEqual({
      errors: [{ message: 'Failed to create checkout session' }],
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
    const mockStripeCustomerId = 'test_customer_123'

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
