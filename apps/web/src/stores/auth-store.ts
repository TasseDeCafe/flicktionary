import { create } from 'zustand'
import { Session } from '@supabase/supabase-js'
import { supabaseClient } from '@/lib/transport/supabase-client'
import { queryClient } from '@/config/react-query-config'
import { clearSentryUser } from '@/lib/analytics/sentry-initializer'
import posthog from 'posthog-js'

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
    clearSentryUser()

    try {
      // supabase signs you out of all devices by default
      // so we use scope: 'local' to only sign out of the current device
      await supabaseClient.auth.signOut({ scope: 'local' })
    } catch {
      // Continue with local cleanup even if Supabase fails
    }

    set({ session: null, isLoading: false, isSigningOut: false })
    queryClient.clear()
    posthog.reset()
    window.localStorage.clear()
    onComplete?.()
  },
}))

export const getIsSignedIn = (state: AuthStore) => !!state.session?.access_token
export const getUserEmail = (state: AuthStore) => state.session?.user?.user_metadata?.email ?? ''
export const getUserName = (state: AuthStore) => state.session?.user?.user_metadata?.name ?? ''
export const getUserId = (state: AuthStore) => state.session?.user?.id ?? ''
export const getAccessToken = (state: AuthStore) => state.session?.access_token ?? ''
export const getUserAvatarUrl = (state: AuthStore) => state.session?.user?.user_metadata?.avatar_url ?? ''
