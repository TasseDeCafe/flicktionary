import { isSupportedLanguageCode, type SupportedLanguageCode } from '@flicktionary/core/constants/supported-languages'
import { getFlicktionaryApiClient } from './flicktionary-api-client'
import { getFlicktionarySupabase, persistSupabaseSession } from './flicktionary-supabase-client'
import { clearFlicktionaryAuth, FlicktionaryAuthState, getFlicktionaryAuth } from './auth-storage'

// Cloudflare's documented always-pass test sitekeys all share this prefix
// (dev backends serve one so the captcha token path stays exercised — see
// developmentConfig.captchaSiteKey). The always-pass test secret accepts any
// token, so a dummy token completes the sign-in. A REAL sitekey means captcha
// is armed, and Turnstile cannot render in a service worker / extension
// origin — the extension degrades to signed-out until captcha is off again.
const CLOUDFLARE_TEST_SITEKEY_PREFIX = '1x0000'

// Best-effort guess at the guest's native language from the browser locale
// (mirrors the web app's detectBrowserLanguage). Undefined when unsupported —
// the backend's guest provisioning then defaults to English.
const detectNativeLanguage = (): SupportedLanguageCode | undefined => {
  const raw = navigator.language?.split('-')[0]?.toLowerCase()
  return raw && isSupportedLanguageCode(raw) ? raw : undefined
}

const mintGuestSession = async (): Promise<FlicktionaryAuthState | null> => {
  const client = getFlicktionaryApiClient()

  const { data: config } = await client.config.getConfig()
  if (!config.isGuestModeEnabled) return null
  let captchaToken: string | undefined
  if (config.captchaSiteKey !== null) {
    if (!config.captchaSiteKey.startsWith(CLOUDFLARE_TEST_SITEKEY_PREFIX)) return null
    captchaToken = 'extension-guest-test-captcha-token'
  }

  const { data, error } = await getFlicktionarySupabase().auth.signInAnonymously(
    captchaToken ? { options: { captchaToken } } : undefined
  )
  if (error || !data?.session || !data.user) return null

  // Persist BEFORE provisioning: the API client's auth header reads storage,
  // so the putUser call below authenticates as the fresh guest.
  const state = await persistSupabaseSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at ?? undefined,
    user: { id: data.user.id, email: data.user.email },
    isGuest: true,
  })

  try {
    const nativeLanguage = detectNativeLanguage()
    await client.user.putUser({ referral: null, ...(nativeLanguage ? { nativeLanguage } : {}) })
    return state
  } catch {
    // Roll back the half-provisioned guest (a surviving record would make
    // later calls skip provisioning and fail every gloss). Sign-out is
    // best-effort — local auth is cleared regardless.
    try {
      await getFlicktionarySupabase().auth.signOut()
    } catch {
      // Server-side revocation failed; the cleanup worker reaps the orphan.
    }
    await clearFlicktionaryAuth()
    return null
  }
}

let mintInFlight: Promise<FlicktionaryAuthState | null> | null = null

/**
 * The stored auth, minting an anonymous guest session when there is none.
 * Single-flight: concurrent first-gloss calls share one mint (a second
 * signInAnonymously would orphan an account). Returns null when guest mode is
 * disabled, captcha is armed with a real sitekey, or the mint fails — callers
 * then behave exactly as signed-out.
 */
export const ensureFlicktionaryAuth = async (): Promise<FlicktionaryAuthState | null> => {
  const existing = await getFlicktionaryAuth()
  if (existing) return existing

  if (!mintInFlight) {
    mintInFlight = mintGuestSession().finally(() => {
      mintInFlight = null
    })
  }
  return mintInFlight
}
