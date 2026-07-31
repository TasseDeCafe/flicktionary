import { ReactNode, useEffect } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { supabaseClient } from '@/lib/transport/supabase-client'
import { setReturningUserMarker } from '@/features/auth/utils/returning-user-marker'

export const SessionInitializer = ({ children }: { children: ReactNode }) => {
  const initialize = useAuthStore((state) => state.initialize)
  const setSession = useAuthStore((state) => state.setSession)
  const loading = useAuthStore((state) => state.isLoading)

  useEffect(() => {
    void initialize()

    const { data: authSubscription } = supabaseClient.auth.onAuthStateChange((_event, newSession) => {
      // Any real (non-anonymous) session marks this browser as a returning
      // user, which disables the silent guest auto sign-in from then on.
      if (newSession && !newSession.user.is_anonymous) {
        setReturningUserMarker()
      }
      setSession(newSession)
    })

    return () => {
      authSubscription.subscription.unsubscribe()
    }
  }, [initialize, setSession])

  if (loading) {
    return null
  }

  return <>{children}</>
}
