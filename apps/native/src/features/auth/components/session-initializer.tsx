import { ReactNode, useEffect } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { supabaseClient } from '@/lib/transport/supabase-client'
import { LoadingScreen } from '@/components/ui/loading-screen'
import { useLingui } from '@lingui/react/macro'

// See: https://docs.expo.dev/router/reference/authentication/
export const SessionInitializer = ({ children }: { children: ReactNode }) => {
  const { t } = useLingui()
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
    return <LoadingScreen message={t`Initializing...`} />
  }

  return <>{children}</>
}
