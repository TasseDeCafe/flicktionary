import { ReactNode, useEffect } from 'react'
import { useCreateOrUpdateUser, useIsUserSetupComplete } from '@/features/user/api/user-hooks'
import { getAccessToken, getUserEmail, getUserId, useAuthStore } from '@/stores/auth-store'
import { useTrackingStore } from '@/stores/tracking-store'
import { useShallow } from 'zustand/react/shallow'
import posthog from 'posthog-js'
import { checkIsTestUser } from '@/utils/test-users-utils'
import { isPostHogEnabled } from '@/lib/analytics/posthog-init'
import { getConfig } from '@/config/environment-config'

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

  // In production, test users are fully opted out of capture: filtering them
  // out of insights would still ingest their events and replays. Development
  // captures them normally — the DEV project's data IS test-user traffic.
  // The opt-out persists in this browser, so a later non-test login has to
  // explicitly opt back in.
  const isExcludedTestUser = isTestUser && getConfig().shouldExcludeTestUsersFromAnalytics
  useEffect(() => {
    if (!isPostHogEnabled() || !email) return
    if (isExcludedTestUser) {
      posthog.opt_out_capturing()
    } else if (posthog.has_opted_out_capturing()) {
      posthog.opt_in_capturing()
    }
  }, [email, isExcludedTestUser])

  useEffect(() => {
    if (isPostHogEnabled() && userId && trackingParams && !isExcludedTestUser && isUserSetupComplete) {
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
  }, [userId, trackingParams, isExcludedTestUser, isUserSetupComplete])

  if (isPending) {
    return null
  }

  return <>{children}</>
}
