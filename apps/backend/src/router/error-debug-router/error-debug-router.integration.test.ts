import { describe, expect, test } from 'vitest'
import request from 'supertest'
import {
  __createOrGetUserWithOurApi,
  __createUserInSupabaseAndGetHisIdAndToken,
  buildTestApp,
} from '../../test/test-utils'
import { getConfig } from '../../config/environment-config'

// Drives the oRPC contract over real HTTP through buildApp. The PostHog client
// is a no-op in tests (empty token), so this only exercises wiring, auth, and
// the test-user gate — capture itself is covered by manual smoke testing.
describe('error-debug-router', () => {
  const testApp = buildTestApp()

  test('returns 401 when unauthenticated', async () => {
    const response = await request(testApp)
      .post('/api/v1/debugging/error-monitoring/trigger-message')
      .set({ Authorization: 'Bearer wrong-token' })
      .send({ message: 'test error' })

    expect(response.status).toBe(401)
  })

  test('returns 403 for an authenticated non-test user', async () => {
    const { token } = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token, referral: null })

    const response = await request(testApp)
      .post('/api/v1/debugging/error-monitoring/trigger-message')
      .set({ Authorization: `Bearer ${token}` })
      .send({ message: 'test error' })

    expect(response.status).toBe(403)
  })

  test('golden path: triggers a handled error log for a test user', async () => {
    const { token, email } = await __createUserInSupabaseAndGetHisIdAndToken()
    await __createOrGetUserWithOurApi({ testApp, token, referral: null })
    // The config singleton is per-worker, so this mutation cannot leak into
    // other test files running in parallel.
    getConfig().emailsOfTestUsers.push(email)

    const response = await request(testApp)
      .post('/api/v1/debugging/error-monitoring/trigger-message')
      .set({ Authorization: `Bearer ${token}` })
      .send({ message: 'test error from integration test' })

    expect(response.status).toBe(200)
    expect(response.body.data).toEqual({
      success: true,
      message: 'Test error triggered successfully',
    })
  })
})
