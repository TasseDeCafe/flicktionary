import { ORPCError } from '@orpc/server'
import { getConfig } from '../../../config/environment-config'

// Test-user-only tooling. Unlike the frontend's hashed-email route gate, this
// is the authoritative check: it verifies the authenticated caller's email
// against the backend's plaintext EMAILS_OF_TEST_USERS before doing anything.
export const assertTestUser = (email: unknown): void => {
  const normalized = String(email ?? '')
    .trim()
    .toLowerCase()
  const isTestUser =
    normalized.length > 0 && getConfig().emailsOfTestUsers.some((testEmail) => testEmail.toLowerCase() === normalized)
  if (!isTestUser) {
    throw new ORPCError('FORBIDDEN', { message: 'Dev tools are restricted to test users' })
  }
}
