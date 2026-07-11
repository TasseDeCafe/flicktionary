import { createFileRoute, redirect } from '@tanstack/react-router'
import { AuthenticatedLayout } from '@/features/auth/components/authenticated-layout'
import { signInWithTelegramNonce } from '@/features/auth/api/telegram-link-auth'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ location }) => {
    const { session, isSigningOut } = useAuthStore.getState()
    if (session?.access_token) {
      return
    }

    // Telegram bot links carry a single-use sign-in nonce (?auth=<nonce>) so
    // they work in browsers with no session (Telegram's in-app browser). Read
    // it from the raw query string — route-level validateSearch schemas strip
    // unknown params from the parsed search.
    const rawSearch = new URLSearchParams(location.searchStr)
    const authNonce = rawSearch.get('auth')
    if (authNonce && (await signInWithTelegramNonce(authNonce))) {
      // Re-enter the same destination without the burnt nonce in the URL.
      rawSearch.delete('auth')
      const query = rawSearch.toString()
      throw redirect({
        href: `${location.pathname}${query ? `?${query}` : ''}`,
        replace: true,
      })
    }

    throw redirect({
      to: '/login',
      search: isSigningOut ? undefined : { redirect: location.href },
    })
  },
  component: AuthenticatedLayout,
})
