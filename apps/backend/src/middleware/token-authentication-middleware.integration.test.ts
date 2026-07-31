import { describe, expect, test } from 'vitest'
import request from 'supertest'
import { Request, Response } from 'express'
import { ERROR_CODE_FOR_GUEST_ACCESS_DISABLED } from '@flicktionary/api-client/key-generation/frontend-api-key-constants'
import {
  __createOrGetUserWithOurApi,
  __createUserInSupabaseAndGetHisIdAndToken,
  __generateUniqueId,
  __getAnonymousSupabaseToken,
  buildAuthorizationHeaders,
  buildTestApp,
  SIGNING_KEY_PATH,
} from '../test/test-utils'
import { signSupabaseToken } from '../utils/jwt-verification-utils'
import { tokenAuthenticationMiddleware } from './token-authentication-middleware'

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

// Invokes the middleware directly (no HTTP round-trip) to inspect res.locals:
// the email it resolves feeds every email-assuming handler (extension pairing,
// billing, removals). A guest converted via updateUser({ email }) carries the
// verified address only in the top-level claim — user_metadata stays empty.
describe('token-authentication-middleware email resolution', () => {
  const invokeMiddleware = async (token: string) => {
    const middleware = tokenAuthenticationMiddleware({ isGuestModeEnabled: true })
    const req = { headers: { authorization: `Bearer ${token}` } } as Request
    const res = { locals: {} } as unknown as Response
    let nextCalled = false
    await middleware(req, res, () => {
      nextCalled = true
    })
    return { locals: res.locals, nextCalled }
  }

  test('prefers the top-level verified email claim over user_metadata', async () => {
    const token = await signSupabaseToken(
      {
        sub: __generateUniqueId('sub'),
        email: 'verified@example.com',
        user_metadata: { email: 'metadata@example.com' },
      },
      SIGNING_KEY_PATH
    )

    const { locals, nextCalled } = await invokeMiddleware(token)

    expect(nextCalled).toBe(true)
    expect(locals.email).toBe('verified@example.com')
  })

  test('falls back to the user_metadata email when the top-level claim is absent', async () => {
    const token = await signSupabaseToken(
      { sub: __generateUniqueId('sub'), user_metadata: { email: 'metadata@example.com' } },
      SIGNING_KEY_PATH
    )

    const { locals, nextCalled } = await invokeMiddleware(token)

    expect(nextCalled).toBe(true)
    expect(locals.email).toBe('metadata@example.com')
  })

  test('resolves no email for anonymous tokens (GoTrue stamps an empty claim)', async () => {
    const token = await signSupabaseToken(
      { sub: __generateUniqueId('sub'), is_anonymous: true, email: '', user_metadata: {} },
      SIGNING_KEY_PATH
    )

    const { locals, nextCalled } = await invokeMiddleware(token)

    expect(nextCalled).toBe(true)
    expect(locals.email).toBeUndefined()
  })
})
