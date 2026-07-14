import { describe, expect, it } from 'vitest'
import { shouldRecordExtensionInstall } from './extension-install-sync'

const eligibleState = {
  detection: 'detected' as const,
  userId: 'user-a',
  accountFlags: [] as string[],
  attemptedUserId: null,
}

describe('shouldRecordExtensionInstall', () => {
  it('records a detected install once prefs and an account are available', () => {
    expect(shouldRecordExtensionInstall(eligibleState)).toBe(true)
  })

  it('does not write while signed out, unresolved, absent, or already recorded', () => {
    expect(shouldRecordExtensionInstall({ ...eligibleState, userId: '' })).toBe(false)
    expect(shouldRecordExtensionInstall({ ...eligibleState, accountFlags: undefined })).toBe(false)
    expect(shouldRecordExtensionInstall({ ...eligibleState, detection: 'not-detected' })).toBe(false)
    expect(shouldRecordExtensionInstall({ ...eligibleState, accountFlags: ['extension_installed'] })).toBe(false)
  })

  it('scopes the once guard to the account', () => {
    expect(shouldRecordExtensionInstall({ ...eligibleState, attemptedUserId: 'user-a' })).toBe(false)
    expect(shouldRecordExtensionInstall({ ...eligibleState, userId: 'user-b', attemptedUserId: 'user-a' })).toBe(true)
  })
})
