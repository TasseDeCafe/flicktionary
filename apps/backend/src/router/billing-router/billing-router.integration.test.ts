import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  __createDefaultInitialStateAfterIntroducingCreditCardAndOnboarding,
  __createUserInSupabaseAndGetHisIdAndToken,
  __removeAllAuthUsersFromSupabase,
  buildAuthorizationHeaders,
  buildTestApp,
} from '../../test/test-utils'
import request from 'supertest'
import { __deleteAllHandledStripeEvents } from '../../transport/database/webhook-events/handled-stripe-events-repository'
import { GetSubscriptionInfoResponse } from '@template-app/api-client/orpc-contracts/billing-contract'

describe('billing-router', () => {
  beforeEach(async () => {
    await __removeAllAuthUsersFromSupabase()
    await __deleteAllHandledStripeEvents()
  })

  afterAll(async () => {
    await __removeAllAuthUsersFromSupabase()
    await __deleteAllHandledStripeEvents()
  })

  describe('Get Subscription Details', async () => {
    it('should return 401 for invalid token', async () => {
      const testApp = buildTestApp()

      const response = await request(testApp)
        .get('/api/v1/billing/subscription-details')
        .send()
        .set('Authorization', `Bearer invalid-token`)

      expect(response.status).toBe(401)
    })

    it('should return 404 if user is not found', async () => {
      const testApp = buildTestApp()
      const { token } = await __createUserInSupabaseAndGetHisIdAndToken()
      const response = await request(testApp)
        .get(`/api/v1/billing/subscription-details`)
        .set(buildAuthorizationHeaders(token))
      expect(response.status).toBe(404)
    })

    it('should return free trial subscription details successfully', async () => {
      const { token, testApp } = await __createDefaultInitialStateAfterIntroducingCreditCardAndOnboarding({})

      const response = await request(testApp)
        .get(`/api/v1/billing/subscription-details`)
        .set(buildAuthorizationHeaders(token))

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('data')

      const { stripeDetails, isSpecialUserWithFullAccess, billingPlatform, isPremiumUser } = response.body
        .data as GetSubscriptionInfoResponse
      expect(stripeDetails?.status).toBe('trialing')
      expect(stripeDetails?.currentActivePlan).toBe('free_trial')
      expect(stripeDetails?.lastActivePlan).toBe('free_trial')
      expect(billingPlatform).toBe('stripe')
      expect(isPremiumUser).toBe(true)

      expect(isSpecialUserWithFullAccess).toBe(false)
      expect(stripeDetails?.userPricingDetails).toBeDefined()
    })

    it('user with free access should get isSpecialUserWithFullAccess set to true', async () => {
      const { token, testApp } = await __createDefaultInitialStateAfterIntroducingCreditCardAndOnboarding({
        email: 'user.with.free.access@email.com',
      })

      const response = await request(testApp)
        .get(`/api/v1/billing/subscription-details`)
        .set(buildAuthorizationHeaders(token))

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('data')

      const { data } = response.body
      expect(data.isSpecialUserWithFullAccess).toBe(true)
    })

    it('should return 401 for unauthorized access', async () => {
      const testApp = buildTestApp()
      const response = await request(testApp).get('/api/v1/payment/subscription-details').send()

      expect(response.status).toBe(401)
    })
  })

  // todo stripe v2
  // todo revenuecat
  // implement tests for the following scenarios:
  // - user has no subscription either on stripe or revenuecat
  // - user has no stripe subscriptions and has one active revenue cat subscription
  // - user has 1 non active stripe subscription and 1 non active revenue cat subscription
})
