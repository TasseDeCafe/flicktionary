import { ReactNode, useEffect } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { supabaseClient } from '@/lib/transport/supabase-client'

export const SessionInitializer = ({ children }: { children: ReactNode }) => {
  const initialize = useAuthStore((state) => state.initialize)
  const setSession = useAuthStore((state) => state.setSession)
  const loading = useAuthStore((state) => state.isLoading)

  useEffect(() => {
    initialize().then()

    const { data: authSubscription } = supabaseClient.auth.onAuthStateChange((_event, newSession) => {
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
