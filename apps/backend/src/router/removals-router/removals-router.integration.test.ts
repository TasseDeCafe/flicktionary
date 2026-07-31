import { describe, expect, test } from 'vitest'
import request from 'supertest'
import {
  __createDefaultInitialStateAfterIntroducingCreditCardAndOnboarding,
  __createOrGetUserWithOurApi,
  __createUserInSupabaseAndGetHisIdAndToken,
  __generateUniqueEmail,
  __generateUniqueId,
  __getAnonymousSupabaseToken,
  buildAuthorizationHeaders,
  buildTestApp,
} from '../../test/test-utils'
import { buildAuthUsersRepository } from '../../transport/database/auth-users/auth-users-repository'
import { __DbRemoval, __selectAllRemovals } from '../../transport/database/removals/removals-repository'
import { MockStripeApi } from '../../transport/third-party/stripe/stripe-api'
import { __simulateStripeEvent } from '../../test/stripe/stripe-test-utils'
import { __createStripeSubscriptionDeletedEvent } from '../../test/stripe/test-stripe-events'

describe('removals-router', () => {
  const testApp = buildTestApp()
  const authUsersRepository = buildAuthUsersRepository()

  // The removals table is shared across tests, so scope reads to this test's
  // (unique) email instead of asserting on the whole table.
  const selectRemovalsForEmail = async (email: string): Promise<__DbRemoval[]> =>
    (await __selectAllRemovals()).filter((removal) => removal.email === email)

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
      const { token, id: userId, email } = await __createUserInSupabaseAndGetHisIdAndToken()
      await __createOrGetUserWithOurApi({ testApp, token, referral: null })
      const removalResponse = await request(testApp)
        .post('/api/v1/removals')
        .send({ type: 'account' })
        .set(buildAuthorizationHeaders(token))
      const removals = await selectRemovalsForEmail(email)
      expect(removalResponse.status).toBe(200)
      expect(await authUsersRepository.findUserById(userId)).toBeNull()
      expect(removals).toHaveLength(1)
      expect(removals[0].was_successful).toBe(true)
    })

    test('happy path', async () => {
      const email = __generateUniqueEmail()
      const {
        testApp,
        token,
        id: userId,
      } = await __createDefaultInitialStateAfterIntroducingCreditCardAndOnboarding({ email })
      const removalResponse = await request(testApp)
        .post('/api/v1/removals')
        .send({ type: 'account' })
        .set(buildAuthorizationHeaders(token))
      const removals = await selectRemovalsForEmail(email)
      expect(removalResponse.status).toBe(200)
      expect(await authUsersRepository.findUserById(userId)).toBeNull()
      expect(removals).toHaveLength(1)
      expect(removals[0].was_successful).toBe(true)
    })

    test('anonymous (guest) user with no email can remove their account', async () => {
      // Anonymous tokens only pass the auth middleware with the kill switch on;
      // pin it so this test doesn't depend on the test environment's env var.
      const testApp = buildTestApp({ isGuestModeEnabled: true })
      const { token, id: userId } = await __getAnonymousSupabaseToken()
      await __createOrGetUserWithOurApi({ testApp, token, referral: null })

      const removalResponse = await request(testApp)
        .post('/api/v1/removals')
        .send({ type: 'account' })
        .set(buildAuthorizationHeaders(token))

      const removals = (await __selectAllRemovals()).filter((removal) => removal.user_id === userId)
      expect(removalResponse.status).toBe(200)
      expect(await authUsersRepository.findUserById(userId)).toBeNull()
      expect(removals).toHaveLength(1)
      expect(removals[0].email).toBeNull()
      expect(removals[0].was_successful).toBe(true)
    })

    test('should cancel active subscription when account is removed', async () => {
      let cancelSubscriptionWasCalled = false
      const stripeApi = {
        ...MockStripeApi,
        cancelSubscription: async () => {
          cancelSubscriptionWasCalled = true
        },
      }
      const { testApp, token } = await __createDefaultInitialStateAfterIntroducingCreditCardAndOnboarding({
        appDependencies: {
          stripeApi,
        },
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
        },
      }
      const stripeCustomerId = __generateUniqueId('cus')
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
        cancelSubscription: async () => {
          throw new Error('Stripe cancel subscription failed')
        },
      }
      const email = __generateUniqueEmail()
      const {
        testApp,
        token,
        id: userId,
      } = await __createDefaultInitialStateAfterIntroducingCreditCardAndOnboarding({
        appDependencies: {
          stripeApi,
        },
        email,
      })

      const response = await request(testApp)
        .post('/api/v1/removals')
        .send({ type: 'account' })
        .set(buildAuthorizationHeaders(token))

      const removals = await selectRemovalsForEmail(email)

      expect(response.status).toBe(500)
      expect(response.body.data.errors[0].code).toBe('2040')
      expect(await authUsersRepository.findUserById(userId)).not.toBeNull() // User should still exist
      expect(removals[0].was_successful).toBe(false)
    })
  })
})
