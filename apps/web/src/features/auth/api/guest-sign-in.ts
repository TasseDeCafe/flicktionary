import { orpcClient, orpcQuery } from '@/lib/transport/orpc-client'
import { supabaseClient } from '@/lib/transport/supabase-client'
import { queryClient } from '@/config/react-query-config'
import { useAuthStore } from '@/stores/auth-store'
import { useTrackingStore } from '@/stores/tracking-store'
import { detectBrowserLanguage } from '@/utils/browser-language-utils'

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
    const { data: signInData, error } = await supabaseClient.auth.signInAnonymously()
    if (error || !signInData.session) {
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
