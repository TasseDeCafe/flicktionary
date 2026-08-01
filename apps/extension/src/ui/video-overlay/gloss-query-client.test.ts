import { describe, expect, it, vi } from 'vitest'
import type { FlicktionaryAuthState } from '../../services/flicktionary/auth-storage'
import { shouldClearGlossCache } from './gloss-query-client'

vi.mock('../../services/flicktionary/auth-storage', () => ({
  getFlicktionaryAuth: vi.fn().mockResolvedValue(null),
  onFlicktionaryAuthChange: vi.fn(),
}))

const auth = (userId: string, isGuest: boolean): FlicktionaryAuthState => ({
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: 1234,
  userId,
  email: isGuest ? null : `${userId}@example.com`,
  isGuest,
})

// The cache clears only when the authenticated IDENTITY changes. Same-identity
// writes (token refreshes) and sign-in-from-nothing (the guest mint lands
// mid-first-gloss) must not cancel in-flight gloss queries — safe because
// errors are never cached (use-gloss), so a signed-out cache holds no
// successes to invalidate.
describe('shouldClearGlossCache', () => {
  it('does not clear on sign-in from nothing (guest mint or direct pairing)', () => {
    expect(shouldClearGlossCache(null, auth('guest-1', true))).toBe(false)
    expect(shouldClearGlossCache(null, auth('user-1', false))).toBe(false)
  })

  it('does not clear on a same-user token refresh', () => {
    expect(shouldClearGlossCache(auth('user-1', false), auth('user-1', false))).toBe(false)
    expect(shouldClearGlossCache(auth('guest-1', true), auth('guest-1', true))).toBe(false)
  })

  it('clears when a guest converts to a full account', () => {
    expect(shouldClearGlossCache(auth('guest-1', true), auth('user-1', false))).toBe(true)
  })

  it('clears on sign-out and on re-pair as another user', () => {
    expect(shouldClearGlossCache(auth('user-1', false), null)).toBe(true)
    expect(shouldClearGlossCache(auth('user-1', false), auth('user-2', false))).toBe(true)
  })
})
