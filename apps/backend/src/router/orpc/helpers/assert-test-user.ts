import { ORPCError } from '@orpc/server'
import { getConfig } from '../../../config/environment-config'

// Test-user-only tooling. Unlike the frontend's hashed-email route gate, this
// is the authoritative check: it verifies the authenticated caller's email
// against the backend's plaintext EMAILS_OF_TEST_USERS.
export const isTestUserEmail = (email: unknown): boolean => {
  const normalized = String(email ?? '')
    .trim()
    .toLowerCase()
  return (
    normalized.length > 0 && getConfig().emailsOfTestUsers.some((testEmail) => testEmail.toLowerCase() === normalized)
  )
}

export const assertTestUser = (email: unknown): void => {
  if (!isTestUserEmail(email)) {
    throw new ORPCError('FORBIDDEN', { message: 'Dev tools are restricted to test users' })
  }
}
