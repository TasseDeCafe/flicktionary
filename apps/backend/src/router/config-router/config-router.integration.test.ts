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

  test('serves the captcha sitekey, null when captcha is off', async () => {
    const appWithCaptcha = buildTestApp({ captchaSiteKey: '1x00000000000000000000BB' })
    const responseWithCaptcha = await request(appWithCaptcha).get('/api/v1/config')

    expect(responseWithCaptcha.status).toBe(200)
    expect(responseWithCaptcha.body.data.captchaSiteKey).toBe('1x00000000000000000000BB')

    const appWithoutCaptcha = buildTestApp()
    const responseWithoutCaptcha = await request(appWithoutCaptcha).get('/api/v1/config')

    expect(responseWithoutCaptcha.status).toBe(200)
    expect(responseWithoutCaptcha.body.data.captchaSiteKey).toBeNull()
  })
})
