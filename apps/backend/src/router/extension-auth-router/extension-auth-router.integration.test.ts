import { describe, expect, test } from 'vitest'
import request from 'supertest'
import {
  __createOrGetUserWithOurApi,
  __createUserInSupabaseAndGetHisIdAndToken,
  __getAnonymousSupabaseToken,
  buildAuthorizationHeaders,
  buildTestApp,
} from '../../test/test-utils'

// Drives the oRPC contract over real HTTP through buildApp. Golden path + the
// guest shape (email: null — an anonymous session has no email on file) + a
// 401; mintSession's nonce mechanics stay covered by the pairing flow itself.
describe('extension-auth-router', () => {
  const testApp = buildTestApp({ isGuestModeEnabled: true })

  test('returns 401 when unauthenticated', async () => {
    const response = await request(testApp)
      .get('/api/v1/extension-auth/bootstrap-prefs')
      .set({ Authorization: 'Bearer wrong-token' })

    expect(response.status).toBe(401)
  })

  test('golden path: returns the account email and prefs for a regular user', async () => {
    const { token, email } = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token, referral: null })

    const response = await request(testApp)
      .get('/api/v1/extension-auth/bootstrap-prefs')
      .set(buildAuthorizationHeaders(token))

    expect(response.status).toBe(200)
    expect(response.body.data.email).toBe(email)
    expect(typeof response.body.data.isOnboarded).toBe('boolean')
  })

  test('returns email null for an anonymous guest', async () => {
    const { token } = await __getAnonymousSupabaseToken()
    const provisionResponse = await request(testApp)
      .put('/api/v1/users/me')
      .set(buildAuthorizationHeaders(token))
      .send({ referral: null, nativeLanguage: 'en' })
    expect(provisionResponse.status).toBe(200)

    const response = await request(testApp)
      .get('/api/v1/extension-auth/bootstrap-prefs')
      .set(buildAuthorizationHeaders(token))

    expect(response.status).toBe(200)
    expect(response.body.data.email).toBeNull()
    // Guest provisioning marks onboarding done so the extension's
    // needs-onboarding gate never traps a guest.
    expect(response.body.data.isOnboarded).toBe(true)
    expect(response.body.data.nativeLanguage).toBe('en')
  })
})
