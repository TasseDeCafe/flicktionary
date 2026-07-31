import { createFileRoute, redirect } from '@tanstack/react-router'
import { AuthenticatedLayout } from '@/features/auth/components/authenticated-layout'
import { signInWithTelegramNonce } from '@/features/auth/api/telegram-link-auth'
import { tryGuestSignIn } from '@/features/auth/api/guest-sign-in'
import { hasReturningUserMarker } from '@/features/auth/utils/returning-user-marker'
import { useAuthStore } from '@/stores/auth-store'

const GUEST_INELIGIBLE_ROUTE_PREFIXES = ['/extension-pair', '/telegram-pair']

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

    // Zero-friction guest landing: a browser that has never held a real
    // session gets signed in anonymously and continues to its destination —
    // no login page, no onboarding. Returning users (marker set), explicit
    // sign-outs, and failed Telegram nonces (a guest would hijack the link's
    // intended account) keep today's /login redirect. The pairing routes are
    // excluded too: minting extension/Telegram credentials requires an email,
    // which a guest account can never satisfy.
    const isGuestEligibleRoute = !GUEST_INELIGIBLE_ROUTE_PREFIXES.some((prefix) => location.pathname.startsWith(prefix))
    if (!isSigningOut && !authNonce && isGuestEligibleRoute && !hasReturningUserMarker() && (await tryGuestSignIn())) {
      return
    }

    throw redirect({
      to: '/login',
      search: isSigningOut ? undefined : { redirect: location.href },
    })
  },
  component: AuthenticatedLayout,
})
