import { Alert } from 'react-native'
import Purchases from 'react-native-purchases'
import RevenueCatUI, { PAYWALL_RESULT } from 'react-native-purchases-ui'
import { FEATURES } from '@template-app/core/features'
import { logWithSentry } from '@/lib/analytics/log-with-sentry'
import { queryClient } from '@/config/react-query-config'
import { QUERY_KEYS } from '@/lib/transport/query-keys'
import { getConfig } from '@/config/environment-config'
import { useCallback, useState } from 'react'
import { POSTHOG_EVENTS } from '@/lib/analytics/posthog-events'
import { useLingui } from '@lingui/react/macro'

export const usePaywall = () => {
  const { t } = useLingui()

  const [isAttemptingPresentation, setIsAttemptingPresentation] = useState(false)

  const presentPaywallIfNeeded = useCallback(async () => {
    if (!FEATURES.REVENUECAT) return

    if (isAttemptingPresentation) {
      return
    }

    if (getConfig().shouldSkipRevenueCatPaywall) {
      return
    }

    setIsAttemptingPresentation(true)

    POSTHOG_EVENTS.showPaywallToUser()

    try {
      const offerings = await Purchases.getOfferings()
      if (offerings.current === null || offerings.current.availablePackages.length === 0) {
        logWithSentry('RevenueCat: No current offerings found')
        Alert.alert(t`Subscription Required`, t`Could not load payment options at this time (no offerings).`)
        return
      }

      const paywallResult: PAYWALL_RESULT = await RevenueCatUI.presentPaywall()
      switch (paywallResult) {
        case PAYWALL_RESULT.ERROR:
          logWithSentry('RevenueCat Paywall Error', { extra: { paywallResult } })
          Alert.alert(t`Subscription Required`, t`Could not load payment options. Please try again later.`)
          break
        case PAYWALL_RESULT.PURCHASED:
          POSTHOG_EVENTS.planPurchased()
          await queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.SUBSCRIPTION_DETAILS] })
          break
        case PAYWALL_RESULT.RESTORED:
          await queryClient.invalidateQueries({ queryKey: [QUERY_KEYS.SUBSCRIPTION_DETAILS] })
          break
        case PAYWALL_RESULT.CANCELLED:
          // User cancelled the paywall - let them stay in the app
          // They can try again
          break
        case PAYWALL_RESULT.NOT_PRESENTED:
          logWithSentry('RevenueCat Paywall Not Presented', { extra: { paywallResult } })
          Alert.alert(t`Subscription Required`, t`Could not display payment options at this time.`)
          break
      }
    } catch (error) {
      logWithSentry('Error presenting RevenueCat paywall', error)
      Alert.alert(t`Error`, t`An error occurred while attempting to manage your subscription.`)
    } finally {
      setIsAttemptingPresentation(false)
    }
  }, [isAttemptingPresentation, t])

  return {
    presentPaywallIfNeeded,
  }
}
