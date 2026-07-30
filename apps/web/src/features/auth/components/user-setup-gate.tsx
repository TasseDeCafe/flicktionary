import { ReactNode, useEffect } from 'react'
import { useCreateOrUpdateUser, useIsUserSetupComplete } from '@/features/user/api/user-hooks'
import { getAccessToken, getUserEmail, getUserId, useAuthStore } from '@/stores/auth-store'
import { useTrackingStore } from '@/stores/tracking-store'
import { useShallow } from 'zustand/react/shallow'
import posthog from 'posthog-js'
import { checkIsTestUser } from '@/utils/test-users-utils'
import { isPostHogEnabled } from '@/lib/analytics/posthog-init'

type UserSetupGateProps = {
  children: ReactNode
}

export const UserSetupGate = ({ children }: UserSetupGateProps) => {
  const accessToken = useAuthStore(getAccessToken)
  const isUserSetupComplete = useIsUserSetupComplete()
  const userId = useAuthStore(getUserId)
  const email = useAuthStore(getUserEmail)
  const isTestUser = checkIsTestUser(email)

  const trackingParams = useTrackingStore(
    useShallow((state) => ({
      referral: state.referral,
      utmSource: state.utmSource,
      utmMedium: state.utmMedium,
      utmCampaign: state.utmCampaign,
      utmTerm: state.utmTerm,
      utmContent: state.utmContent,
    }))
  )

  const { mutate: getOrCreateUserData, isPending } = useCreateOrUpdateUser()

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

  // Test users are fully opted out of capture: filtering them out of insights
  // would still ingest their events and replays. The opt-out persists in this
  // browser, so a later non-test login has to explicitly opt back in.
  useEffect(() => {
    if (!isPostHogEnabled() || !email) return
    if (isTestUser) {
      posthog.opt_out_capturing()
    } else if (posthog.has_opted_out_capturing()) {
      posthog.opt_in_capturing()
    }
  }, [email, isTestUser])

  useEffect(() => {
    if (isPostHogEnabled() && userId && trackingParams && !isTestUser && isUserSetupComplete) {
      posthog.identify(userId, {
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
  }, [userId, trackingParams, isTestUser, isUserSetupComplete])

  if (isPending) {
    return null
  }

  return <>{children}</>
}
