import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import request from 'supertest'
import {
  __createDefaultInitialStateAfterIntroducingCreditCardAndOnboarding,
  __createOrGetUserWithOurApi,
  __createUserInSupabaseAndGetHisIdAndToken,
  __removeAllAuthUsersFromSupabase,
  buildAuthorizationHeaders,
  buildTestApp,
} from '../../test/test-utils'
import { __getAllAuthUsers } from '../../transport/database/auth-users/auth-users-repository'
import {
  __DbRemoval,
  __deleteRemovals,
  __selectAllRemovals,
} from '../../transport/database/removals/removals-repository'
import { __deleteAllHandledStripeEvents } from '../../transport/database/webhook-events/handled-stripe-events-repository'
import { MockStripeApi } from '../../transport/third-party/stripe/stripe-api'
import { __simulateStripeEvent } from '../../test/stripe/stripe-test-utils'
import { __createStripeSubscriptionDeletedEvent } from '../../test/stripe/test-stripe-events'

describe('removals-router', () => {
  const testApp = buildTestApp()

  beforeEach(async () => {
    await __removeAllAuthUsersFromSupabase()
    await __deleteAllHandledStripeEvents()
    await __deleteRemovals()
  })

  afterAll(async () => {
    await __removeAllAuthUsersFromSupabase()
    await __deleteAllHandledStripeEvents()
    await __deleteRemovals()
  })

  test('when user is unauthenticated', async () => {
    const removalResponse = await request(testApp)
      .post('/api/v1/removals')
      .send({ type: 'account' })
      .set({ Authorization: `Bearer wrong-token` })

    expect(removalResponse.status).toBe(401)
  })

  test('when user does not exist', async () => {
    const { token } = await __createUserInSupabaseAndGetHisIdAndToken()
    const removalResponse = await request(testApp)
      .post('/api/v1/removals')
      .send({ type: 'account' })
      .set(buildAuthorizationHeaders(token))

    expect(removalResponse.status).toBe(404)
    expect(removalResponse.body.data.errors[0].message).toBe('User not found')
  })

  describe('removing an account', () => {
    test('happy path', async () => {
      const testApp = buildTestApp()
      const { token } = await __createUserInSupabaseAndGetHisIdAndToken('some@email.com')
      await __createOrGetUserWithOurApi({ testApp, token, referral: null })
      const removalResponse = await request(testApp)
        .post('/api/v1/removals')
        .send({ type: 'account' })
        .set(buildAuthorizationHeaders(token))
      const authUsers = await __getAllAuthUsers()
      const removals: __DbRemoval[] = await __selectAllRemovals()
      expect(removalResponse.status).toBe(200)
      expect(authUsers).toHaveLength(0)
      expect(removals).toHaveLength(1)
      expect(removals[0].was_successful).toBe(true)
      expect(removals[0].email).toBe('some@email.com')
    })

    test('happy path', async () => {
      const { testApp, token } = await __createDefaultInitialStateAfterIntroducingCreditCardAndOnboarding({
        email: 'some@email.com',
      })
      const removalResponse = await request(testApp)
        .post('/api/v1/removals')
        .send({ type: 'account' })
        .set(buildAuthorizationHeaders(token))
      const authUsers = await __getAllAuthUsers()
      const removals: __DbRemoval[] = await __selectAllRemovals()
      expect(removalResponse.status).toBe(200)
      expect(authUsers).toHaveLength(0)
      expect(removals).toHaveLength(1)
      expect(removals[0].was_successful).toBe(true)
      expect(removals[0].email).toBe('some@email.com')
    })

    test('should cancel active subscription when account is removed', async () => {
      let cancelSubscriptionWasCalled = false
      const stripeApi = {
        ...MockStripeApi,
        cancelSubscription: async () => {
          cancelSubscriptionWasCalled = true
          return true
        },
      }
      const { testApp, token } = await __createDefaultInitialStateAfterIntroducingCreditCardAndOnboarding({
        appDependencies: {
          stripeApi,
        },
        email: 'some@email.com',
      })

      const response = await request(testApp)
        .post('/api/v1/removals')
        .send({ type: 'account' })
        .set(buildAuthorizationHeaders(token))

      expect(response.status).toBe(200)
      expect(cancelSubscriptionWasCalled).toBe(true)
    })

    test('should not try to sync the stripe subscription if the user removed his account', async () => {
      let cancelSubscriptionWasCalled = false
      const stripeApi = {
        ...MockStripeApi,
        cancelSubscription: async () => {
          cancelSubscriptionWasCalled = true
          return true
        },
      }
      const stripeCustomerId = 'some_stripe_customer_id'
      const {
        testApp,
        token,
        stripeCallsCounters,
        id: userId,
      } = await __createDefaultInitialStateAfterIntroducingCreditCardAndOnboarding({
        stripeCustomerId,
        appDependencies: {
          stripeApi,
        },
        email: 'some@email.com',
      })

      const response = await request(testApp)
        .post('/api/v1/removals')
        .send({ type: 'account' })
        .set(buildAuthorizationHeaders(token))

      await __simulateStripeEvent(testApp, __createStripeSubscriptionDeletedEvent({ stripeCustomerId, userId }))

      expect(response.status).toBe(200)
      expect(stripeCallsCounters.retrieveSubscriptionCallCount).toBe(1)
      expect(cancelSubscriptionWasCalled).toBe(true)
    })

    test('should fail account removal if subscription cancellation fails', async () => {
      const stripeApi = {
        ...MockStripeApi,
        cancelSubscription: async () => false,
      }
      const { testApp, token } = await __createDefaultInitialStateAfterIntroducingCreditCardAndOnboarding({
        appDependencies: {
          stripeApi,
        },
        email: 'some@email.com',
      })

      const response = await request(testApp)
        .post('/api/v1/removals')
        .send({ type: 'account' })
        .set(buildAuthorizationHeaders(token))

      const authUsers = await __getAllAuthUsers()
      const removals: __DbRemoval[] = await __selectAllRemovals()

      expect(response.status).toBe(500)
      expect(response.body.data.errors[0].code).toBe('2040')
      expect(authUsers).toHaveLength(1) // User should still exist
      expect(removals[0].was_successful).toBe(false)
    })
  })
})
