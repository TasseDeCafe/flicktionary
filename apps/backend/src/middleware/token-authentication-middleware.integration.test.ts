import { describe, expect, test } from 'vitest'
import request from 'supertest'
import { ERROR_CODE_FOR_GUEST_ACCESS_DISABLED } from '@flicktionary/api-client/key-generation/frontend-api-key-constants'
import {
  __createOrGetUserWithOurApi,
  __createUserInSupabaseAndGetHisIdAndToken,
  __getAnonymousSupabaseToken,
  buildAuthorizationHeaders,
  buildTestApp,
} from '../test/test-utils'

// Drives the guest kill switch over real HTTP through buildApp. GET /users/me
// sits right after the token-authentication middleware (before the
// subscription middleware), so a 404 proves auth passed while a 401 proves it
// was rejected there.
describe('token-authentication-middleware guest gate', () => {
  test('rejects an anonymous token with the distinct guest code when guest mode is off', async () => {
    const testApp = buildTestApp({ isGuestModeEnabled: false })
    const { token } = await __getAnonymousSupabaseToken()

    const response = await request(testApp).get('/api/v1/users/me').set(buildAuthorizationHeaders(token))

    expect(response.status).toBe(401)
    expect(response.body.data.errors[0].code).toBe(ERROR_CODE_FOR_GUEST_ACCESS_DISABLED)
  })

  test('lets an anonymous token through when guest mode is on', async () => {
    const testApp = buildTestApp({ isGuestModeEnabled: true })
    const { token } = await __getAnonymousSupabaseToken()

    const response = await request(testApp).get('/api/v1/users/me').set(buildAuthorizationHeaders(token))

    // A fresh guest has no users row yet: 404 means the middleware accepted
    // the token and the request reached the user router.
    expect(response.status).toBe(404)
  })

  test('leaves regular tokens untouched when guest mode is off', async () => {
    const testApp = buildTestApp({ isGuestModeEnabled: false })
    const { token } = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token, referral: null })

    const response = await request(testApp).get('/api/v1/users/me').set(buildAuthorizationHeaders(token))

    expect(response.status).toBe(200)
  })
})
