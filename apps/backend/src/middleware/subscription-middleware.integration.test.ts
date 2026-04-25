import { afterAll, beforeEach, describe, expect, test } from 'vitest'
import request from 'supertest'
import { buildApp } from '../app'
import {
  __createOrGetUserWithOurApi,
  __createUserInSupabaseAndGetHisIdAndToken,
  __removeAllAuthUsersFromSupabase,
  buildAuthorizationHeaders,
} from '../test/test-utils'
import { __deleteAllHandledStripeEvents } from '../transport/database/webhook-events/handled-stripe-events-repository'
import { MockStripeApi } from '../transport/third-party/stripe/stripe-api'

describe('subscription-middleware', async () => {
  beforeEach(async () => {
    await __removeAllAuthUsersFromSupabase()
    await __deleteAllHandledStripeEvents()
  })

  afterAll(async () => {
    await __removeAllAuthUsersFromSupabase()
    await __deleteAllHandledStripeEvents()
  })

  test('users with free access can use the app without a credit card', async () => {
    const email = 'user.with.free.access@email.com'
    const { token } = await __createUserInSupabaseAndGetHisIdAndToken(email)

    const testApp = buildApp({
      usersWithFreeAccess: [email],
      stripeApi: MockStripeApi,
    })

    await __createOrGetUserWithOurApi({ testApp, token, referral: null })

    // todo template: fix this test by adding a route that requires a subscription
    // const response = await request(testApp)
    //   .post('/api/v1/translation/translate-text')
    //   .send({
    //     text: 'translate',
    //     sourceDialect: DialectCode.AMERICAN_ENGLISH,
    //     targetLanguage: LangCode.SPANISH,
    //   })
    //   .set(buildAuthorizationHeaders(token))

    // expect(response.status).toBe(200)
  })

  test("unsubscribed users can't use the app", async () => {
    const email = 'unsubscribed.user@email.com'
    const { token } = await __createUserInSupabaseAndGetHisIdAndToken(email)

    const testApp = buildApp({
      usersWithFreeAccess: [],
      stripeApi: MockStripeApi,
    })

    await __createOrGetUserWithOurApi({ testApp, token, referral: null })

    //todo template: fix this test by adding a route that requires a subscription
    const response = await request(testApp)
      .post('/api/v1/translate-text')
      .send({
        text: 'translate',
      })
      .set(buildAuthorizationHeaders(token))

    expect(response.status).toBe(403)
  })
})
