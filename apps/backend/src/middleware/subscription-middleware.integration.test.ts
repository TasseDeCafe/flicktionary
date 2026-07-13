import { describe, expect, test } from 'vitest'
import request from 'supertest'
import { buildApp } from '../app'
import { getConfig } from '../config/environment-config'
import {
  __createOrGetUserWithOurApi,
  __createUserInSupabaseAndGetHisIdAndToken,
  buildAuthorizationHeaders,
} from '../test/test-utils'
import { MockStripeApi } from '../transport/third-party/stripe/stripe-api'

// Subscription gating is bypassed when the app is in free-for-all mode, so
// the "unsubscribed user blocked" assertion has nothing to assert against.
const isAppFreeForEveryone = getConfig().featureFlags.shouldAppBeFreeForEveryone()

describe('subscription-middleware', async () => {
  test('users with free access can use the app without a credit card', async () => {
    const { token, email } = await __createUserInSupabaseAndGetHisIdAndToken()

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

  test.skipIf(isAppFreeForEveryone)("unsubscribed users can't use the app", async () => {
    const { token } = await __createUserInSupabaseAndGetHisIdAndToken()

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
