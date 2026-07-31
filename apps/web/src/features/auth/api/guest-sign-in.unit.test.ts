// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { tryGuestSignIn } from './guest-sign-in'
import { getCaptchaToken } from './turnstile'
import { orpcClient } from '@/lib/transport/orpc-client'
import { supabaseClient } from '@/lib/transport/supabase-client'
import { POSTHOG_EVENTS } from '@/lib/analytics/posthog-events'

vi.mock('@/lib/transport/orpc-client', () => ({
  orpcClient: {
    config: { getConfig: vi.fn() },
    user: { putUser: vi.fn().mockResolvedValue(undefined) },
  },
  orpcQuery: { userPrefs: { getPrefs: { key: () => ['userPrefs'] } } },
}))
vi.mock('@/lib/transport/supabase-client', () => ({
  supabaseClient: { auth: { signInAnonymously: vi.fn(), signOut: vi.fn().mockResolvedValue(undefined) } },
}))
vi.mock('@/config/react-query-config', () => ({
  queryClient: { cancelQueries: vi.fn(), resetQueries: vi.fn() },
}))
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: { getState: () => ({ setSession: vi.fn() }) },
}))
vi.mock('@/stores/tracking-store', () => ({
  useTrackingStore: {
    getState: () => ({
      referral: null,
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmTerm: null,
      utmContent: null,
    }),
  },
}))
vi.mock('@/lib/analytics/posthog-events', () => ({
  POSTHOG_EVENTS: { guestCaptchaFailed: vi.fn() },
}))
vi.mock('./turnstile', () => ({
  getCaptchaToken: vi.fn(),
}))

const mockGetConfig = vi.mocked(orpcClient.config.getConfig)
const mockSignInAnonymously = vi.mocked(supabaseClient.auth.signInAnonymously)
const mockGetCaptchaToken = vi.mocked(getCaptchaToken)
const mockGuestCaptchaFailed = vi.mocked(POSTHOG_EVENTS.guestCaptchaFailed)

const configWith = (captchaSiteKey: string | null) =>
  mockGetConfig.mockResolvedValue({
    data: {
      lowestSupportedVersionIos: '0.0.1',
      lowestSupportedVersionAndroid: '0.0.1',
      isGuestModeEnabled: true,
      captchaSiteKey,
    },
  })

const session = { access_token: 'access', refresh_token: 'refresh' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('tryGuestSignIn captcha wiring', () => {
  test('null sitekey never touches Turnstile and signs in without a token', async () => {
    configWith(null)
    mockSignInAnonymously.mockResolvedValue({ data: { session, user: {} }, error: null } as never)

    const result = await tryGuestSignIn()

    expect(result).toBe(true)
    expect(mockGetCaptchaToken).not.toHaveBeenCalled()
    expect(mockSignInAnonymously).toHaveBeenCalledWith(undefined)
    expect(mockGuestCaptchaFailed).not.toHaveBeenCalled()
  })

  test('non-null sitekey passes the exact token to signInAnonymously', async () => {
    configWith('sitekey-1')
    mockGetCaptchaToken.mockResolvedValue({ token: 'turnstile-token' })
    mockSignInAnonymously.mockResolvedValue({ data: { session, user: {} }, error: null } as never)

    const result = await tryGuestSignIn()

    expect(result).toBe(true)
    expect(mockGetCaptchaToken).toHaveBeenCalledWith('sitekey-1')
    expect(mockSignInAnonymously).toHaveBeenCalledWith({ options: { captchaToken: 'turnstile-token' } })
  })

  test('token acquisition failure skips sign-in and reports the reason', async () => {
    configWith('sitekey-1')
    mockGetCaptchaToken.mockResolvedValue({ failure: 'script_blocked' })

    const result = await tryGuestSignIn()

    expect(result).toBe(false)
    expect(mockSignInAnonymously).not.toHaveBeenCalled()
    expect(mockGuestCaptchaFailed).toHaveBeenCalledWith('script_blocked')
  })

  test('a GoTrue rejection reports server_rejected with the error code', async () => {
    configWith('sitekey-1')
    mockGetCaptchaToken.mockResolvedValue({ token: 'turnstile-token' })
    mockSignInAnonymously.mockResolvedValue({
      data: { session: null, user: null },
      error: { code: 'captcha_failed' },
    } as never)

    const result = await tryGuestSignIn()

    expect(result).toBe(false)
    expect(mockGuestCaptchaFailed).toHaveBeenCalledWith('server_rejected', { code: 'captcha_failed' })
  })

  test('a sign-in error without captcha active stays uninstrumented', async () => {
    configWith(null)
    mockSignInAnonymously.mockResolvedValue({
      data: { session: null, user: null },
      error: { code: 'anonymous_provider_disabled' },
    } as never)

    const result = await tryGuestSignIn()

    expect(result).toBe(false)
    expect(mockGuestCaptchaFailed).not.toHaveBeenCalled()
  })
})
