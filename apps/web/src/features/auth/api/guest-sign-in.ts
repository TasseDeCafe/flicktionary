import { orpcClient, orpcQuery } from '@/lib/transport/orpc-client'
import { supabaseClient } from '@/lib/transport/supabase-client'
import { queryClient } from '@/config/react-query-config'
import { useAuthStore } from '@/stores/auth-store'
import { useTrackingStore } from '@/stores/tracking-store'
import { detectBrowserLanguage } from '@/utils/browser-language-utils'
import { getCaptchaToken } from '@/features/auth/api/turnstile'
import { POSTHOG_EVENTS } from '@/lib/analytics/posthog-events'

// Zero-friction landing: a first-time visitor hitting a protected route gets
// an anonymous Supabase account instead of the login page. The flag comes
// from the backend's pre-auth config endpoint so flipping the
// GUEST_MODE_ENABLED kill switch needs no web redeploy. Returns whether a
// guest session is now live; any failure means the caller falls back to the
// normal /login redirect.
export const tryGuestSignIn = async (): Promise<boolean> => {
  try {
    const { data } = await orpcClient.config.getConfig()
    if (!data.isGuestModeEnabled) {
      return false
    }
    // Non-null sitekey means Supabase-side captcha protection is on: fetch an
    // invisible Turnstile token or downgrade this visitor to the /login
    // redirect. The downgrade is deliberately silent — a first-time visitor
    // doesn't know guest mode exists, so a login wall reads as normal while
    // an error would read as broken.
    let captchaToken: string | undefined
    if (data.captchaSiteKey) {
      const captchaResult = await getCaptchaToken(data.captchaSiteKey)
      if ('failure' in captchaResult) {
        POSTHOG_EVENTS.guestCaptchaFailed(captchaResult.failure)
        return false
      }
      captchaToken = captchaResult.token
    }
    const { data: signInData, error } = await supabaseClient.auth.signInAnonymously(
      captchaToken ? { options: { captchaToken } } : undefined
    )
    if (error || !signInData.session) {
      if (data.captchaSiteKey && error) {
        // GoTrue refused the sign-in despite a token: 'captcha_failed' means
        // a wrong secret / spent token / botched rollout order; other codes
        // are rate limits or outages, not captcha.
        POSTHOG_EVENTS.guestCaptchaFailed('server_rejected', { code: error.code ?? 'unknown' })
      }
      return false
    }
    // The onAuthStateChange listener also picks this up, but the router
    // continues into the authenticated tree synchronously after we return —
    // the store must already hold the session by then.
    useAuthStore.getState().setSession(signInData.session)
    try {
      // Provision before the router continues: the app shell fetches user prefs
      // the moment a route renders, and the seeded is_onboarded must already be
      // committed or the guest gets bounced into the onboarding wizard.
      // (UserSetupGate's own putUser fires later and no-ops on the existing row.)
      const tracking = useTrackingStore.getState()
      await orpcClient.user.putUser({
        referral: tracking.referral,
        utmSource: tracking.utmSource,
        utmMedium: tracking.utmMedium,
        utmCampaign: tracking.utmCampaign,
        utmTerm: tracking.utmTerm,
        utmContent: tracking.utmContent,
        nativeLanguage: detectBrowserLanguage(),
      })
      // UserUiPrefsSync sits outside the auth gates and its getPrefs query
      // enables the moment the onAuthStateChange listener stores the anonymous
      // session — racing the provisioning call above and caching a
      // "not onboarded" default that would bounce the guest into the onboarding
      // wizard. Abort anything it started and reset the entry so every consumer
      // (it, and the app shell's onboarding gate) reads post-provisioning data.
      const prefsKey = orpcQuery.userPrefs.getPrefs.key()
      await queryClient.cancelQueries({ queryKey: prefsKey })
      await queryClient.resetQueries({ queryKey: prefsKey })
      return true
    } catch {
      // Provisioning failed: discard the half-created guest session, or the
      // login page (which bounces any signed-in session back to the protected
      // destination) would loop the visitor into a broken account.
      await supabaseClient.auth.signOut({ scope: 'local' }).catch(() => undefined)
      useAuthStore.getState().setSession(null)
      return false
    }
  } catch {
    return false
  }
}
