import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureFlicktionaryAuth } from './guest-session'
import { getFlicktionaryAuth, clearFlicktionaryAuth, FlicktionaryAuthState } from './auth-storage'
import { getFlicktionarySupabase, persistSupabaseSession } from './flicktionary-supabase-client'
import { getFlicktionaryApiClient } from './flicktionary-api-client'

vi.mock('./auth-storage', () => ({
  getFlicktionaryAuth: vi.fn(),
  clearFlicktionaryAuth: vi.fn(),
}))
vi.mock('./flicktionary-supabase-client', () => ({
  getFlicktionarySupabase: vi.fn(),
  persistSupabaseSession: vi.fn(),
}))
vi.mock('./flicktionary-api-client', () => ({
  getFlicktionaryApiClient: vi.fn(),
}))

const storedAuth: FlicktionaryAuthState = {
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: 1234,
  userId: 'user-1',
  email: 'user@example.com',
  isGuest: false,
}

const guestUser = { id: 'guest-1', email: null, is_anonymous: true }
const guestSession = { access_token: 'guest-access', refresh_token: 'guest-refresh', expires_at: 5678 }

const setupMocks = ({
  config = { isGuestModeEnabled: true, captchaSiteKey: null as string | null },
  signInResult = { data: { session: guestSession, user: guestUser }, error: null },
  putUserImpl = () => Promise.resolve({}),
} = {}) => {
  const signInAnonymously = vi.fn().mockResolvedValue(signInResult)
  const signOut = vi.fn().mockResolvedValue({ error: null })
  const putUser = vi.fn().mockImplementation(putUserImpl)
  vi.mocked(getFlicktionarySupabase).mockReturnValue({ auth: { signInAnonymously, signOut } } as never)
  vi.mocked(getFlicktionaryApiClient).mockReturnValue({
    config: { getConfig: vi.fn().mockResolvedValue({ data: config }) },
    user: { putUser },
  } as never)
  vi.mocked(persistSupabaseSession).mockImplementation(async (params) => ({
    accessToken: params.access_token,
    refreshToken: params.refresh_token,
    expiresAt: params.expires_at ?? 0,
    userId: params.user.id,
    email: params.user.email ?? null,
    isGuest: params.isGuest,
  }))
  return { signInAnonymously, signOut, putUser }
}

describe('ensureFlicktionaryAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getFlicktionaryAuth).mockResolvedValue(null)
  })

  it('returns the stored auth without minting when one exists', async () => {
    vi.mocked(getFlicktionaryAuth).mockResolvedValue(storedAuth)
    const { signInAnonymously } = setupMocks()

    await expect(ensureFlicktionaryAuth()).resolves.toEqual(storedAuth)
    expect(signInAnonymously).not.toHaveBeenCalled()
  })

  it('mints, persists, and provisions a guest when there is no auth', async () => {
    const { signInAnonymously, putUser } = setupMocks()

    const result = await ensureFlicktionaryAuth()

    expect(signInAnonymously).toHaveBeenCalledWith(undefined)
    expect(persistSupabaseSession).toHaveBeenCalledWith(expect.objectContaining({ isGuest: true }))
    expect(putUser).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ userId: 'guest-1', isGuest: true })
  })

  it('single-flight: concurrent calls share one mint', async () => {
    const { signInAnonymously, putUser } = setupMocks()

    const [a, b] = await Promise.all([ensureFlicktionaryAuth(), ensureFlicktionaryAuth()])

    expect(signInAnonymously).toHaveBeenCalledTimes(1)
    expect(putUser).toHaveBeenCalledTimes(1)
    expect(a).toEqual(b)
  })

  it('bails without minting when guest mode is disabled', async () => {
    const { signInAnonymously } = setupMocks({ config: { isGuestModeEnabled: false, captchaSiteKey: null } })

    await expect(ensureFlicktionaryAuth()).resolves.toBeNull()
    expect(signInAnonymously).not.toHaveBeenCalled()
  })

  it('bails when captcha is armed with a real sitekey', async () => {
    const { signInAnonymously } = setupMocks({
      config: { isGuestModeEnabled: true, captchaSiteKey: '0xREALSITEKEY' },
    })

    await expect(ensureFlicktionaryAuth()).resolves.toBeNull()
    expect(signInAnonymously).not.toHaveBeenCalled()
  })

  it('passes a dummy captcha token for the Cloudflare test-sitekey family', async () => {
    const { signInAnonymously } = setupMocks({
      config: { isGuestModeEnabled: true, captchaSiteKey: '1x00000000000000000000BB' },
    })

    await ensureFlicktionaryAuth()

    expect(signInAnonymously).toHaveBeenCalledWith({ options: { captchaToken: expect.any(String) } })
  })

  it('rolls back (sign-out + clear) when provisioning fails', async () => {
    const { signOut } = setupMocks({ putUserImpl: () => Promise.reject(new Error('provisioning down')) })

    await expect(ensureFlicktionaryAuth()).resolves.toBeNull()
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(clearFlicktionaryAuth).toHaveBeenCalledTimes(1)
  })

  it('clears local auth even when the rollback sign-out rejects', async () => {
    const { signOut } = setupMocks({ putUserImpl: () => Promise.reject(new Error('provisioning down')) })
    signOut.mockRejectedValue(new Error('offline'))

    await expect(ensureFlicktionaryAuth()).resolves.toBeNull()
    expect(clearFlicktionaryAuth).toHaveBeenCalledTimes(1)
  })
})
