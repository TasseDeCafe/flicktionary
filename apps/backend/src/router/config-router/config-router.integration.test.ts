import { describe, expect, test } from 'vitest'
import request from 'supertest'
import { buildTestApp } from '../../test/test-utils'

// The config endpoint mounts before the token-authentication middleware on
// purpose: the web app reads the guest-mode flag before anyone is signed in.
describe('config-router', () => {
  test('serves the guest-mode flag without authentication', async () => {
    const appWithGuestModeOn = buildTestApp({ isGuestModeEnabled: true })
    const responseOn = await request(appWithGuestModeOn).get('/api/v1/config')

    expect(responseOn.status).toBe(200)
    expect(responseOn.body.data.isGuestModeEnabled).toBe(true)

    const appWithGuestModeOff = buildTestApp({ isGuestModeEnabled: false })
    const responseOff = await request(appWithGuestModeOff).get('/api/v1/config')

    expect(responseOff.status).toBe(200)
    expect(responseOff.body.data.isGuestModeEnabled).toBe(false)
  })
})
