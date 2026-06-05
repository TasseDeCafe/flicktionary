import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/transport/orpc-client'
import { getIsSignedIn, useAuthStore } from '@/stores/auth-store'
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
  const setThemePref = useThemeStore((state) => state.setPref)

  // Deliberately not useGetUserPrefs(): that hook takes no options and
  // logged-out users must not fire an unauthed getPrefs.
  const { data: prefs } = useQuery(
    orpcQuery.userPrefs.getPrefs.queryOptions({
      enabled: isSignedIn,
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
