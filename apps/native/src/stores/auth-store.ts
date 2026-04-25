import { create } from 'zustand'
import { Session } from '@supabase/supabase-js'
import { supabaseClient } from '@/lib/transport/supabase-client'
import { orpcClient, setTokenGetter } from '@/lib/transport/orpc-client'
import { GoogleSignin, User as GoogleUser } from '@react-native-google-signin/google-signin'
import * as AppleAuthentication from 'expo-apple-authentication'
import { FEATURES } from '@template-app/core/features'
import { toast } from 'sonner-native'
import { logWithSentry } from '@/lib/analytics/log-with-sentry'
import { queryClient } from '@/config/react-query-config'
import { clearSentryUser } from '@/lib/analytics/sentry-initializer'
import { getConfig } from '@/config/environment-config'
import Purchases from 'react-native-purchases'
import * as Haptics from 'expo-haptics'
import { posthog } from '@/lib/analytics/posthog'

type AuthStore = {
  session: Session | null
  isLoading: boolean
  isRevenueCatInitialized: boolean
  initialize: () => Promise<void>
  setSession: (session: Session | null) => void
  setLoading: (loading: boolean) => void
  setIsRevenueCatInitialized: (isInitialized: boolean) => void
  signOut: () => Promise<void>
  clearLocalSession: () => Promise<void>
  signInWithMagicLink: (email: string) => Promise<{ error: Error | null }>
  signInWithGoogle: () => Promise<void>
  signInWithApple: () => Promise<void>
}

export const useAuthStore = create<AuthStore>((set) => ({
  session: null,
  isLoading: true,
  isRevenueCatInitialized: false,
  setSession: (session) => {
    set({ session })
    const authHeader = session?.access_token ? `Bearer ${session.access_token}` : ''
    setTokenGetter(() => authHeader)
  },
  setLoading: (isLoading) => set({ isLoading }),
  setIsRevenueCatInitialized: (isRevenueCatInitialized) => set({ isRevenueCatInitialized }),
  initialize: async () => {
    if (FEATURES.GOOGLE_AUTH) {
      GoogleSignin.configure({
        webClientId: getConfig().googleClientId,
        iosClientId: getConfig().googleIosClientId,
        offlineAccess: true,
      })
    }
    try {
      const { data, error } = await supabaseClient.auth.getSession()
      if (error) {
        logWithSentry('Error fetching Supabase session', error)
      } else {
        set({ session: data.session })
        const authHeader = data.session?.access_token ? `Bearer ${data.session.access_token}` : ''
        setTokenGetter(() => authHeader)
      }
    } catch (err) {
      logWithSentry('Unexpected error fetching Supabase session', err)
    } finally {
      set({ isLoading: false })
    }
  },

  signOut: async () => {
    set({ isLoading: true })
    clearSentryUser()

    if (FEATURES.REVENUECAT) {
      // calling Purchase.logout() without revenuecat being initialized throws an error
      const currentState = useAuthStore.getState()
      if (currentState.isRevenueCatInitialized) {
        try {
          await Purchases.logOut()
        } catch (error) {
          logWithSentry('Failed to reset RevenueCat cache', error)
          throw error
        }
      }
    }

    // Reset RevenueCat initialization state
    set({ isRevenueCatInitialized: false })
    try {
      // supabase signs you out of all devices by default
      // so we use scope: 'local' to only sign out of the current device
      const { error } = await supabaseClient.auth.signOut({ scope: 'local' })
      if (error) {
        logWithSentry('Error signing out from Supabase', error)
      }
    } catch (err) {
      logWithSentry('Unexpected error signing out from Supabase', err)
    }

    if (FEATURES.GOOGLE_AUTH) {
      try {
        const user: GoogleUser | null = GoogleSignin.getCurrentUser()
        if (user) {
          await GoogleSignin.signOut()
        }
      } catch (googleError) {
        logWithSentry('Error signing out from Google', googleError)
      }
    }

    set({ session: null })
    setTokenGetter(() => '')
    queryClient.clear()
    posthog?.reset()
    set({ isLoading: false })
  },

  clearLocalSession: async () => {
    set({ isLoading: true })
    clearSentryUser()

    if (FEATURES.GOOGLE_AUTH) {
      try {
        const user: GoogleUser | null = GoogleSignin.getCurrentUser()
        if (user) {
          await GoogleSignin.signOut()
        }
      } catch (googleError) {
        logWithSentry('Error signing out from Google during local cleanup', googleError)
      }
    }

    if (FEATURES.REVENUECAT) {
      // calling Purchase.logout() without revenuecat being initialized throws an error
      const currentState = useAuthStore.getState()
      if (currentState.isRevenueCatInitialized) {
        try {
          await Purchases.logOut()
        } catch (error) {
          logWithSentry('Failed to reset RevenueCat cache', error)
          throw error
        }
      }
    }

    set({ isRevenueCatInitialized: false })

    set({ session: null })
    setTokenGetter(() => '')
    queryClient.clear()
    posthog?.reset()
    set({ isLoading: false })
  },

  signInWithMagicLink: async (email) => {
    try {
      await orpcClient.authentication.sendEmailVerification({
        email,
        platform: 'native',
        // todo better Android tracking: we could pass this so that user setup is getting the params from the email or from the android referrer
        referral: null,
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
        utmContent: null,
        utmTerm: null,
      })

      return { error: null }
    } catch (error) {
      logWithSentry('Error sending magic link', error)
      return { error: error as Error }
    }
  },

  signInWithGoogle: async () => {
    if (!FEATURES.GOOGLE_AUTH) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).then(() => {})
    try {
      await GoogleSignin.hasPlayServices()
      const userInfo = await GoogleSignin.signIn()
      const idToken = userInfo.data?.idToken

      if (!idToken) {
        toast.error('Unable to sign in with Google. Please try again.')
        return
      }

      const { error } = await supabaseClient.auth.signInWithIdToken({
        provider: 'google',
        token: idToken,
      })

      if (error) {
        toast.error('Unable to sign in with Google. Please try again.')
        logWithSentry('Error signing in with Google with id token with Supabase', error)
        return
      }
    } catch (error) {
      logWithSentry('Error signing in with Google', error)
      toast.error('Unable to sign in with Google. Please try again.')
    }
  },

  signInWithApple: async () => {
    if (!FEATURES.APPLE_AUTH) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).then(() => {})
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      })

      if (!credential.identityToken) {
        toast.error('Unable to sign in with Apple. Please try again.')
        return
      }

      const { error } = await supabaseClient.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken,
      })

      if (error) {
        toast.error('Unable to sign in with Apple. Please try again.')
        logWithSentry('Error signing in with Apple with id token with Supabase', error)
        return
      }
    } catch (error) {
      logWithSentry('Error signing in with Apple', error)
      //todo sentry: figure out a way to filter this error: "The user canceled the authorization attempt"
      // we don't need to see this error, it's just a user canceling the sign in
      toast.error('Unable to sign in with Apple. Please try again.')
    }
  },
}))
