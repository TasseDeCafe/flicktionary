import React, { ReactNode, useEffect } from 'react'
import { Alert, Platform } from 'react-native'
import Purchases from 'react-native-purchases'
import { router } from 'expo-router'
import { FEATURES } from '@template-app/core/features'
import { LoadingScreen } from '@/components/ui/loading-screen'
import { getConfig } from '@/config/environment-config'
import { useAuthStore } from '@/stores/auth-store'
import { logWithSentry } from '@/lib/analytics/log-with-sentry'
import { useLingui } from '@lingui/react/macro'

export const RevenuecatInitializer = ({ children }: { children: ReactNode }) => {
  const { t } = useLingui()

  const session = useAuthStore((state) => state.session)
  const signOut = useAuthStore((state) => state.signOut)
  const isRevenueCatInitialized = useAuthStore((state) => state.isRevenueCatInitialized)
  const setIsRevenueCatInitialized = useAuthStore((state) => state.setIsRevenueCatInitialized)

  useEffect(() => {
    if (!FEATURES.REVENUECAT) {
      setIsRevenueCatInitialized(true)
      return
    }

    if (session?.user.id && !isRevenueCatInitialized && !getConfig().shouldSkipRevenueCatPaywall) {
      try {
        Purchases.setLogLevel(Purchases.LOG_LEVEL.ERROR).then()
        Purchases.configure({
          apiKey: Platform.OS === 'ios' ? getConfig().revenueCatAppleApiKey : getConfig().revenueCatGoogleApiKey,
          appUserID: session.user.id,
        })
        // www.revenuecat.com/docs/integrations/third-party-integrations/posthog#1-set-posthog-user-identity
        Purchases.setAttributes({ $posthogUserId: session.user.id }).then()
        setIsRevenueCatInitialized(true)
      } catch (error) {
        logWithSentry('Failed to configure RevenueCat', error)
        Alert.alert('Error', t`Failed to initialize payment system. Please restart the app.`, [
          { text: 'OK', onPress: () => signOut().then(() => router.replace('/login')) },
        ])
      }
    } else if (getConfig().shouldSkipRevenueCatPaywall) {
      setIsRevenueCatInitialized(true)
    }
  }, [session?.user?.id, isRevenueCatInitialized, setIsRevenueCatInitialized, signOut, t])

  if (!session || !isRevenueCatInitialized) {
    return <LoadingScreen message={t`Initializing payments...`} />
  }

  return <>{children}</>
}
