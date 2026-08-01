import { describe, expect, it } from 'vitest'
import { __parseAuthStateForTest } from './auth-storage'

// The stored shape predates guest support: legacy records have a string email
// and no `isGuest` key. Rejecting them would silently sign every paired user
// out on extension update, so the parser normalizes instead of requiring.
describe('parseAuthState', () => {
  const base = {
    accessToken: 'access',
    refreshToken: 'refresh',
    expiresAt: 1234,
    userId: 'user-1',
  }

  it('accepts a legacy paired record (string email, no isGuest) as a full account', () => {
    expect(__parseAuthStateForTest({ ...base, email: 'user@example.com' })).toEqual({
      ...base,
      email: 'user@example.com',
      isGuest: false,
    })
  })

  it('accepts a guest record (null email, isGuest true)', () => {
    expect(__parseAuthStateForTest({ ...base, email: null, isGuest: true })).toEqual({
      ...base,
      email: null,
      isGuest: true,
    })
  })

  it('rejects malformed records', () => {
    expect(__parseAuthStateForTest(null)).toBeNull()
    expect(__parseAuthStateForTest('nope')).toBeNull()
    expect(__parseAuthStateForTest({ ...base })).toBeNull()
    expect(__parseAuthStateForTest({ ...base, email: 42 })).toBeNull()
    expect(__parseAuthStateForTest({ ...base, email: 'user@example.com', expiresAt: 'soon' })).toBeNull()
  })
})
