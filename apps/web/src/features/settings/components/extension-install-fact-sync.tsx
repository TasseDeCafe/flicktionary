import { useEffect, useRef } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/transport/orpc-client'
import { getIsSignedIn, useAuthStore } from '@/stores/auth-store'
import { useExtensionDetected } from '@/lib/extension/use-extension-detected'

/**
 * Records the account-level "has ever installed the extension" fact the first
 * time a signed-in page sees the marker in this browser. Renders nothing.
 *
 * Mounted globally next to UserUiPrefsSync (not in the authenticated route
 * shell) so a signed-in user landing on the public /extension-welcome page
 * records the fact immediately. Signed out: the prefs query is disabled and
 * nothing is ever written.
 */
export const ExtensionInstallFactSync = () => {
  const isSignedIn = useAuthStore(getIsSignedIn)
  const detection = useExtensionDetected()

  // Deliberately not useGetUserPrefs(): that hook takes no options and
  // logged-out users must not fire an unauthed getPrefs.
  const { data: prefs } = useQuery(
    orpcQuery.userPrefs.getPrefs.queryOptions({
      enabled: isSignedIn,
      select: (response) => response.data,
    })
  )

  // Deliberately not useAddAccountFlag(): this is a background sync — a
  // failure toast out of nowhere would be noise. Silent; retried on the next
  // mount (the server is idempotent).
  const { mutate: recordInstall } = useMutation(
    orpcQuery.userPrefs.addAccountFlag.mutationOptions({
      meta: {
        invalidates: [orpcQuery.userPrefs.getPrefs.key()],
        showErrorToast: false,
      },
    })
  )

  const fired = useRef(false)
  useEffect(() => {
    if (detection !== 'detected' || prefs === undefined || fired.current) return
    if (prefs.accountFlags.includes('extension_installed')) return
    fired.current = true
    recordInstall(
      { flag: 'extension_installed' },
      {
        onError: () => {
          fired.current = false
        },
      }
    )
  }, [detection, prefs, recordInstall])

  return null
}
