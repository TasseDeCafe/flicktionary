import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import {
  __createDefaultInitialStateAfterIntroducingCreditCardAndOnboarding,
  __createUserInSupabaseAndGetHisIdAndToken,
  __removeAllAuthUsersFromSupabase,
  buildAuthorizationHeaders,
  buildTestApp,
} from '../../test/test-utils'
import request from 'supertest'
import { __deleteAllHandledStripeEvents } from '../../transport/database/webhook-events/handled-stripe-events-repository'
import { MockStripeApi, StripeApi } from '../../transport/third-party/stripe/stripe-api'
import { getConfig } from '../../config/environment-config'

describe('portal-session-router', async () => {
  beforeEach(async () => {
    await __removeAllAuthUsersFromSupabase()
    await __deleteAllHandledStripeEvents()
  })

  afterAll(async () => {
    await __removeAllAuthUsersFromSupabase()
    await __deleteAllHandledStripeEvents()
  })

  test('should return 404 when user is not found', async () => {
    const testApp = buildTestApp()
    const { token } = await __createUserInSupabaseAndGetHisIdAndToken()

    const response = await request(testApp)
      .post('/api/v1/payment/create-customer-portal-session')
      .send({ returnPath: '/exercises' })
      .set(buildAuthorizationHeaders(token))

    expect(response.status).toBe(404)
    expect(response.body.data.errors[0].message).toBe('User or Stripe customer not found')
  })

  test('should create a customer portal session successfully on subsequent calls', async () => {
    const { testApp, token } = await __createDefaultInitialStateAfterIntroducingCreditCardAndOnboarding({})
    const response = await request(testApp)
      .post('/api/v1/payment/create-customer-portal-session')
      .send({ returnPath: '/exercises' })
      .set(buildAuthorizationHeaders(token))
    expect(response.status).toBe(200)
  })

  test('should return 500 when Stripe API fails to create a session', async () => {
    const partialStripeMock: Partial<StripeApi> = {
      createBillingPortalUrl: async () => null,
    }

    const stripeApi = {
      ...MockStripeApi,
      ...partialStripeMock,
    }

    const { testApp, token } = await __createDefaultInitialStateAfterIntroducingCreditCardAndOnboarding({
      appDependencies: { stripeApi },
    })

    const response = await request(testApp)
      .post('/api/v1/payment/create-customer-portal-session')
      .send({ returnPath: '/settings' })
      .set(buildAuthorizationHeaders(token))

    expect(response.status).toBe(500)
    expect(response.body.data.errors[0].message).toBe('Failed to create billing portal session url')
  })

  test('should use the correct return URL', async () => {
    let capturedReturnUrl: string | undefined
    const returnPath = '/custom-return'

    const partialStripeMock: Partial<StripeApi> = {
      createBillingPortalUrl: async (_customerId: string, returnUrl: string) => {
        capturedReturnUrl = returnUrl
        return 'https://billing.stripe.com/session/test_123'
      },
    }

    const stripeApi = {
      ...MockStripeApi,
      ...partialStripeMock,
    }

    const { testApp, token } = await __createDefaultInitialStateAfterIntroducingCreditCardAndOnboarding({
      appDependencies: { stripeApi },
    })

    const response = await request(testApp)
      .post('/api/v1/payment/create-customer-portal-session')
      .send({ returnPath })
      .set(buildAuthorizationHeaders(token))

    expect(response.status).toBe(200)
    expect(capturedReturnUrl).toBe(`${getConfig().webUrl}${returnPath}`)
    expect(response.body).toEqual({
      data: {
        url: 'https://billing.stripe.com/session/test_123',
      },
    })
  })
})
