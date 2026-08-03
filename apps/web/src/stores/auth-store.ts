import { create } from 'zustand'
import { Session } from '@supabase/supabase-js'
import { supabaseClient } from '@/lib/transport/supabase-client'
import { queryClient } from '@/config/react-query-config'
import { useThemeStore } from '@/stores/theme-store'
import posthog from 'posthog-js'
import { isPostHogEnabled } from '@/lib/analytics/posthog-init'
import { POSTHOG_EVENTS } from '@/lib/analytics/posthog-events'
import { hasReturningUserMarker, setReturningUserMarker } from '@/features/auth/utils/returning-user-marker'

type AuthStore = {
  session: Session | null
  isLoading: boolean
  isSigningOut: boolean
  initialize: () => Promise<void>
  setSession: (session: Session | null) => void
  setLoading: (loading: boolean) => void
  signOut: (onComplete?: () => void) => Promise<void>
}

export const useAuthStore = create<AuthStore>((set) => ({
  session: null,
  isLoading: true,
  isSigningOut: false,

  initialize: async () => {
    try {
      const { data, error } = await supabaseClient.auth.getSession()
      if (error) {
        console.error('Error fetching Supabase session', error)
      } else {
        set({ session: data.session })
      }
    } catch (err) {
      console.error('Unexpected error fetching Supabase session', err)
    } finally {
      set({ isLoading: false })
    }
  },

  setSession: (session) => {
    set({ session })
  },

  setLoading: (isLoading) => set({ isLoading }),

  signOut: async (onComplete) => {
    set({ isLoading: true, isSigningOut: true })
    const wasReturningUser = hasReturningUserMarker()

    try {
      // supabase signs you out of all devices by default
      // so we use scope: 'local' to only sign out of the current device
      await supabaseClient.auth.signOut({ scope: 'local' })
    } catch {
      // Continue with local cleanup even if Supabase fails
    }

    set({ session: null, isLoading: false, isSigningOut: false })
    queryClient.clear()
    // Captured before reset() so the event still carries the identified user
    // (the capture queue stamps the distinct id synchronously).
    POSTHOG_EVENTS.signOut()
    if (isPostHogEnabled()) {
      posthog.reset()
    }
    window.localStorage.clear()
    // localStorage.clear() wiped the resolved-theme cache; re-write it so the
    // next load doesn't flash. The DB value re-applies on next sign-in.
    useThemeStore.getState().recache()
    // Same for the returning-user marker: a signed-out real user must keep
    // landing on /login, not get silently switched to a fresh guest account.
    if (wasReturningUser) {
      setReturningUserMarker()
    }
    onComplete?.()
  },
}))

export const getIsSignedIn = (state: AuthStore) => !!state.session?.access_token
// Only the verified top-level email counts as identity: user_metadata is
// client-writable (updateUser({ data })), so reading it would let a guest
// spoof an address into email-gated surfaces like the test-user checks.
export const getUserEmail = (state: AuthStore) => state.session?.user?.email ?? ''
export const getUserName = (state: AuthStore) => state.session?.user?.user_metadata?.name ?? ''
export const getUserId = (state: AuthStore) => state.session?.user?.id ?? ''
export const getIsAnonymous = (state: AuthStore) => state.session?.user?.is_anonymous ?? false
export const getAccessToken = (state: AuthStore) => state.session?.access_token ?? ''
export const getUserAvatarUrl = (state: AuthStore) => state.session?.user?.user_metadata?.avatar_url ?? ''
