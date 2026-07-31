import { useEffect, useRef } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/transport/orpc-client'
import { getUserId, useAuthStore } from '@/stores/auth-store'
import { useIsUserSetupComplete } from '@/features/user/api/user-hooks'
import { useExtensionDetected } from '@/lib/extension/use-extension-detected'
import { shouldRecordExtensionInstall } from '../utils/extension-install-sync'

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
  const userId = useAuthStore(getUserId)
  const isUserSetupComplete = useIsUserSetupComplete()
  const detection = useExtensionDetected()

  // Deliberately not useGetUserPrefs(): that hook takes no options and
  // logged-out users must not fire an unauthed getPrefs. Waiting for user
  // setup (UserSetupGate's putUser) matters too: this component mounts
  // outside the auth gates, and a getPrefs fired before the users row exists
  // caches a "not onboarded" default under the shared query key — which
  // would bounce a freshly provisioned guest into the onboarding wizard.
  const { data: prefs } = useQuery(
    orpcQuery.userPrefs.getPrefs.queryOptions({
      enabled: userId !== '' && isUserSetupComplete,
      select: (response) => response.data,
    })
  )

  // Deliberately not useAddAccountFlag(): this is a background sync — a
  // failure toast out of nowhere would be noise. The idempotent write retries
  // silently here instead.
  const { mutate: recordInstall } = useMutation(
    orpcQuery.userPrefs.addAccountFlag.mutationOptions({
      // The write is idempotent. Retrying here covers the common first-sign-in
      // race where the public user row is still being created, plus transient
      // network failures, without surfacing a background error toast.
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(500 * 2 ** attemptIndex, 2000),
      meta: {
        invalidates: [orpcQuery.userPrefs.getPrefs.key()],
        showErrorToast: false,
      },
    })
  )

  // Scope the once guard to an account. The provider stays mounted across
  // sign-out/sign-in, so a process-lifetime boolean would prevent a second
  // account in this browser from recording its own fact.
  const attemptedUserId = useRef<string | null>(null)
  useEffect(() => {
    if (userId === '') {
      attemptedUserId.current = null
      return
    }
    if (
      !shouldRecordExtensionInstall({
        detection,
        userId,
        accountFlags: prefs?.accountFlags,
        attemptedUserId: attemptedUserId.current,
      })
    ) {
      return
    }
    attemptedUserId.current = userId
    recordInstall(
      { flag: 'extension_installed' },
      {
        onError: () => {
          // Built-in retries are exhausted. A later prefs change or auth
          // transition may safely attempt the idempotent write again.
          attemptedUserId.current = null
        },
      }
    )
  }, [detection, prefs, recordInstall, userId])

  return null
}
