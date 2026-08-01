import { getFullAccountFlicktionaryAuth } from './auth-storage'
import { getFlicktionaryConfig } from './flicktionary-config'

// Mirrors the web app's checkIsTestUser (apps/web/src/utils/test-users-utils.ts):
// sha256(email.toLowerCase().trim()) compared against the hashed allow-list
// shipped in the bundle. Async because it uses Web Crypto instead of pulling in
// js-sha256 — fine here since every caller is an extension page (popup), which
// is always a secure context.
const hashEmail = async (email: string): Promise<string> => {
  const bytes = new TextEncoder().encode(email.toLowerCase().trim())
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export const checkIsTestUser = async (email: string): Promise<boolean> => {
  const { hashedEmailsOfTestUsers } = getFlicktionaryConfig()
  if (hashedEmailsOfTestUsers.length === 0) {
    return false
  }
  // crypto.subtle is undefined outside secure contexts — i.e. in content
  // scripts on plain-http pages (self-hosted Emby/Jellyfin). Degrade to "not a
  // test user" there; the background (always secure) is the authoritative gate.
  if (!globalThis.crypto?.subtle) {
    return false
  }
  return hashedEmailsOfTestUsers.includes(await hashEmail(email))
}

/** Test-user check for the currently paired account; false while unpaired or a guest. */
export const checkCurrentUserIsTestUser = async (): Promise<boolean> => {
  const auth = await getFullAccountFlicktionaryAuth()
  return auth?.email ? checkIsTestUser(auth.email) : false
}
