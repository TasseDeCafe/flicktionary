import { describe, expect, test } from 'vitest'
import request from 'supertest'
import { type PostHog } from 'posthog-node'
import {
  __createOrGetUserWithOurApi,
  __createUserInSupabaseAndGetHisIdAndToken,
  __getAnonymousSupabaseToken,
  buildAuthorizationHeaders,
  buildTestApp,
} from '../../test/test-utils'

const buildRecordingPosthogClient = () => {
  const captured: { distinctId: string; event: string }[] = []
  const client = {
    capture: (payload: { distinctId: string; event: string }) => captured.push(payload),
  } as unknown as PostHog
  return { captured, client }
}

describe('users-router', async () => {
  const testApp = buildTestApp()

  test('when user is unauthenticated', async () => {
    const createResponse = await request(testApp).put('/api/v1/users/me').set({ Authorization: `Bearer wrong-token` })

    expect(createResponse.status).toBe(401)
  })

  test('create and find user', async () => {
    const { token } = await __createUserInSupabaseAndGetHisIdAndToken()
    const createResponse = await __createOrGetUserWithOurApi({ testApp, token, referral: null })
    expect(createResponse.status).toBe(200)

    const { status, body } = await __createOrGetUserWithOurApi({ testApp, token, referral: null })

    expect(status).toBe(200)
    expect(body.data).toEqual({
      referral: null,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmTerm: null,
      utmContent: null,
    })
  })

  test('create and find user with referral', async () => {
    const { token } = await __createUserInSupabaseAndGetHisIdAndToken()
    const createResponse = await __createOrGetUserWithOurApi({ testApp, token, referral: 'tiengos' })
    expect(createResponse.status).toBe(200)

    const { status, body } = await __createOrGetUserWithOurApi({ testApp, token, referral: null })

    expect(status).toBe(200)
    expect(body.data).toEqual({
      referral: 'tiengos',
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmTerm: null,
      utmContent: null,
    })
  })

  describe('guest (anonymous) provisioning', () => {
    // Anonymous tokens only pass the auth middleware with the kill switch on;
    // pin it so these tests don't depend on the test environment's env var.
    const guestApp = buildTestApp({ isGuestModeEnabled: true })

    test('seeds the sent native language and completes onboarding', async () => {
      const { token } = await __getAnonymousSupabaseToken()

      const createResponse = await request(guestApp)
        .put('/api/v1/users/me')
        .set(buildAuthorizationHeaders(token))
        .send({ referral: null, nativeLanguage: 'fr' })
      expect(createResponse.status).toBe(200)

      const prefsResponse = await request(guestApp).get('/api/v1/user-prefs').set(buildAuthorizationHeaders(token))
      expect(prefsResponse.status).toBe(200)
      expect(prefsResponse.body.data.nativeLanguage).toBe('fr')
      expect(prefsResponse.body.data.isOnboarded).toBe(true)
    })

    test('falls back to English when no native language is sent', async () => {
      const { token } = await __getAnonymousSupabaseToken()

      const createResponse = await request(guestApp)
        .put('/api/v1/users/me')
        .set(buildAuthorizationHeaders(token))
        .send({ referral: null })
      expect(createResponse.status).toBe(200)

      const prefsResponse = await request(guestApp).get('/api/v1/user-prefs').set(buildAuthorizationHeaders(token))
      expect(prefsResponse.status).toBe(200)
      expect(prefsResponse.body.data.nativeLanguage).toBe('en')
      expect(prefsResponse.body.data.isOnboarded).toBe(true)
    })

    test('rejects an unsupported native language', async () => {
      const { token } = await __getAnonymousSupabaseToken()

      const createResponse = await request(guestApp)
        .put('/api/v1/users/me')
        .set(buildAuthorizationHeaders(token))
        .send({ referral: null, nativeLanguage: 'xx' })
      expect(createResponse.status).toBe(400)
    })

    test('captures guest_provisioned exactly once, and never for regular users', async () => {
      const { captured, client } = buildRecordingPosthogClient()
      const capturingApp = buildTestApp({ isGuestModeEnabled: true, posthogClient: client })

      const { token, id: guestId } = await __getAnonymousSupabaseToken()
      const firstResponse = await request(capturingApp)
        .put('/api/v1/users/me')
        .set(buildAuthorizationHeaders(token))
        .send({ referral: null })
      expect(firstResponse.status).toBe(200)

      // The repeat call finds the existing row and must not double-count.
      const repeatResponse = await request(capturingApp)
        .put('/api/v1/users/me')
        .set(buildAuthorizationHeaders(token))
        .send({ referral: null })
      expect(repeatResponse.status).toBe(200)

      const { token: regularToken } = await __createUserInSupabaseAndGetHisIdAndToken()
      const regularResponse = await request(capturingApp)
        .put('/api/v1/users/me')
        .set(buildAuthorizationHeaders(regularToken))
        .send({ referral: null })
      expect(regularResponse.status).toBe(200)

      const guestEvents = captured.filter((event) => event.event === 'guest_provisioned')
      expect(guestEvents).toHaveLength(1)
      expect(guestEvents[0].distinctId).toBe(guestId)
    })

    test('does not skip onboarding for regular users sending a native language', async () => {
      const { token } = await __createUserInSupabaseAndGetHisIdAndToken()

      const createResponse = await request(guestApp)
        .put('/api/v1/users/me')
        .set(buildAuthorizationHeaders(token))
        .send({ referral: null, nativeLanguage: 'fr' })
      expect(createResponse.status).toBe(200)

      const prefsResponse = await request(guestApp).get('/api/v1/user-prefs').set(buildAuthorizationHeaders(token))
      expect(prefsResponse.status).toBe(200)
      expect(prefsResponse.body.data.nativeLanguage).toBeNull()
      expect(prefsResponse.body.data.isOnboarded).toBe(false)
    })
  })

  describe('UTM parameters', () => {
    test('should save UTM parameters on first user creation', async () => {
      const { token } = await __createUserInSupabaseAndGetHisIdAndToken()
      const utmParams = {
        utmSource: 'facebook',
        utmMedium: 'cpc',
        utmCampaign: 'summer_sale',
        utmTerm: 'language_learning',
        utmContent: 'top_banner',
      }

      // First create user with UTM params
      const response = await __createOrGetUserWithOurApi({
        testApp,
        token,
        referral: null,
        ...utmParams,
      })

      expect(response.status).toBe(200)
      expect(response.body.data.utmSource).toBe(utmParams.utmSource)
      expect(response.body.data.utmMedium).toBe(utmParams.utmMedium)
      expect(response.body.data.utmCampaign).toBe(utmParams.utmCampaign)
      expect(response.body.data.utmTerm).toBe(utmParams.utmTerm)
      expect(response.body.data.utmContent).toBe(utmParams.utmContent)
    })

    test('should preserve UTM parameters on subsequent calls', async () => {
      const { token } = await __createUserInSupabaseAndGetHisIdAndToken()
      const initialUtmParams = {
        utmSource: 'facebook',
        utmMedium: 'cpc',
        utmCampaign: 'summer_sale',
        utmTerm: 'language_learning',
        utmContent: 'top_banner',
      }

      // First create user with initial UTM params
      await __createOrGetUserWithOurApi({
        testApp,
        token,
        referral: null,
        ...initialUtmParams,
      })

      // Try to update with different UTM params
      const newUtmParams = {
        utmSource: 'google',
        utmMedium: 'organic',
        utmCampaign: 'winter_sale',
        utmTerm: 'english_learning',
        utmContent: 'bottom_banner',
      }

      const response = await __createOrGetUserWithOurApi({
        testApp,
        token,
        referral: null,
        ...newUtmParams,
      })

      // Verify that the original UTM params are preserved
      expect(response.status).toBe(200)
      expect(response.body.data.utmSource).toBe(initialUtmParams.utmSource)
      expect(response.body.data.utmMedium).toBe(initialUtmParams.utmMedium)
      expect(response.body.data.utmCampaign).toBe(initialUtmParams.utmCampaign)
      expect(response.body.data.utmTerm).toBe(initialUtmParams.utmTerm)
      expect(response.body.data.utmContent).toBe(initialUtmParams.utmContent)
    })

    test('should handle null UTM parameters correctly', async () => {
      const { token } = await __createUserInSupabaseAndGetHisIdAndToken()
      const initialUtmParams = {
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
        utmTerm: null,
        utmContent: null,
      }

      // First create user with null UTM params
      const createResponse = await __createOrGetUserWithOurApi({
        testApp,
        token,
        referral: null,
        ...initialUtmParams,
      })

      expect(createResponse.status).toBe(200)
      expect(createResponse.body.data.utmSource).toBeNull()
      expect(createResponse.body.data.utmMedium).toBeNull()
      expect(createResponse.body.data.utmCampaign).toBeNull()
      expect(createResponse.body.data.utmTerm).toBeNull()
      expect(createResponse.body.data.utmContent).toBeNull()

      // Try to update with non-null UTM params
      const newUtmParams = {
        utmSource: 'google',
        utmMedium: 'organic',
        utmCampaign: 'winter_sale',
        utmTerm: 'english_learning',
        utmContent: 'bottom_banner',
      }

      const updateResponse = await __createOrGetUserWithOurApi({
        testApp,
        token,
        referral: null,
        ...newUtmParams,
      })

      // Verify that the null UTM params are preserved
      expect(updateResponse.status).toBe(200)
      expect(updateResponse.body.data.utmSource).toBeNull()
      expect(updateResponse.body.data.utmMedium).toBeNull()
      expect(updateResponse.body.data.utmCampaign).toBeNull()
      expect(updateResponse.body.data.utmTerm).toBeNull()
      expect(updateResponse.body.data.utmContent).toBeNull()
    })
  })
})
