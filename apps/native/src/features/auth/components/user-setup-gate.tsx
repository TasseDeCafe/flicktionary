import { ReactNode, useEffect } from 'react'
import { Alert } from 'react-native'
import { router } from 'expo-router'
import { useAuthStore } from '@/stores/auth-store'
import { useCreateOrUpdateUser, useIsUserSetupComplete } from '@/features/user/api/user-hooks'
import { posthog } from '@/lib/analytics/posthog'
import { useInstallReferrerParams } from '@/hooks/use-install-referrer-params'
import { identifyUserWithSentry } from '@/lib/analytics/sentry-initializer'
import { LoadingScreen } from '@/components/ui/loading-screen'
import { logWithSentry } from '@/lib/analytics/log-with-sentry'
import { useLingui } from '@lingui/react/macro'

type UserSetupGateProps = {
  children: ReactNode
}

export const UserSetupGate = ({ children }: UserSetupGateProps) => {
  const { t } = useLingui()

  const signOut = useAuthStore((state) => state.signOut)
  const session = useAuthStore((state) => state.session)
  const trackingParams = useInstallReferrerParams()
  const isUserSetupComplete = useIsUserSetupComplete()

  const {
    mutate: getOrCreateUserData,
    isPending: isUserPending,
    isError: isUserSetupError,
  } = useCreateOrUpdateUser({
    meta: {
      showSuccessToast: false,
    },
  })

  const accessToken = session?.access_token
  const userId = session?.user.id

  useEffect(() => {
    if (accessToken && !isUserSetupComplete && trackingParams) {
      getOrCreateUserData({
        referral: trackingParams.referral,
        utmSource: trackingParams.utmSource,
        utmMedium: trackingParams.utmMedium,
        utmCampaign: trackingParams.utmCampaign,
        utmTerm: trackingParams.utmTerm,
        utmContent: trackingParams.utmContent,
      })
    }
  }, [accessToken, getOrCreateUserData, isUserSetupComplete, trackingParams])

  useEffect(() => {
    if (userId && trackingParams && isUserSetupComplete) {
      // Wait for utmParams
      // https://posthog.com/docs/product-analytics/identify
      posthog?.identify(userId, {
        $set_once: {
          referral: trackingParams.referral,
          utm_source: trackingParams.utmSource,
          utm_medium: trackingParams.utmMedium,
          utm_campaign: trackingParams.utmCampaign,
          utm_term: trackingParams.utmTerm,
          utm_content: trackingParams.utmContent,
        },
      })
    }
  }, [userId, trackingParams, isUserSetupComplete])

  useEffect(() => {
    if (userId) {
      identifyUserWithSentry(userId)
    }
  }, [userId])

  if (isUserPending) {
    return <LoadingScreen message={t`Setting up account...`} />
  }

  if (isUserSetupError) {
    Alert.alert('Error', t`Could not set up your account. Please try restarting the app.`, [
      { text: 'OK', onPress: () => signOut().then(() => router.replace('/login')) },
    ])
    logWithSentry('Error setting up account')
    return <LoadingScreen message={t`Error setting up account...`} />
  }

  return children
}
