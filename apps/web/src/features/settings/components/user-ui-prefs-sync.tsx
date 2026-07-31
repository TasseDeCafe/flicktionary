import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/transport/orpc-client'
import { getIsSignedIn, useAuthStore } from '@/stores/auth-store'
import { useIsUserSetupComplete } from '@/features/user/api/user-hooks'
import { useThemeStore } from '@/stores/theme-store'
import { activateLocale, resolveUiLocale } from '@/lib/i18n/i18n'

/**
 * Applies the server-synced UI prefs (theme + interface language) whenever
 * they load or change. Renders nothing.
 *
 * Logged out: the query is disabled — the theme stays at the cached/system
 * value and the locale stays browser-detected.
 */
export const UserUiPrefsSync = () => {
  const isSignedIn = useAuthStore(getIsSignedIn)
  const isUserSetupComplete = useIsUserSetupComplete()
  const setThemePref = useThemeStore((state) => state.setPref)

  // Deliberately not useGetUserPrefs(): that hook takes no options and
  // logged-out users must not fire an unauthed getPrefs. Waiting for user
  // setup (UserSetupGate's putUser) matters too: this component mounts
  // outside the auth gates, and a getPrefs fired before the users row exists
  // caches a "not onboarded" default under the shared query key — which
  // would bounce a freshly provisioned guest into the onboarding wizard.
  const { data: prefs } = useQuery(
    orpcQuery.userPrefs.getPrefs.queryOptions({
      enabled: isSignedIn && isUserSetupComplete,
      select: (response) => response.data,
    })
  )

  useEffect(() => {
    if (prefs === undefined) return
    setThemePref(prefs.uiTheme ?? 'system')
  }, [prefs, setThemePref])

  useEffect(() => {
    if (prefs === undefined) return
    activateLocale(resolveUiLocale(prefs.uiLanguage))
  }, [prefs])

  return null
}
