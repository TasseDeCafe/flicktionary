import { View, Text } from 'react-native'
import { useTabBarHeight } from '@/hooks/use-tab-bar-height'
import { ScrollView } from '@/components/ui/styled'
import { router } from 'expo-router'
import { useNeedsSubscription } from '@/features/billing/hooks/use-needs-subscription'
import { useLingui } from '@lingui/react/macro'
import { usePaywall } from '@/features/billing/hooks/use-paywall'
import { Button } from '@/components/ui/button'
import { ROUTE_PATHS } from '@/constants/route-paths'

export const DashboardView = () => {
  const { t } = useLingui()
  const tabBarHeight = useTabBarHeight()
  const { needsSubscription, isFetching } = useNeedsSubscription()
  const { presentPaywallIfNeeded } = usePaywall()

  const isSubscribed = !needsSubscription && !isFetching

  const handlePremiumPress = async () => {
    if (isSubscribed) {
      router.push(ROUTE_PATHS.PREMIUM_DEMO)
    } else {
      await presentPaywallIfNeeded()
    }
  }

  return (
    <View className='flex-1'>
      <ScrollView className='flex-1 px-4 py-2' style={{ paddingBottom: tabBarHeight + 20 }}>
        <Text className='mb-4 text-xl font-bold'>{t`Dashboard`}</Text>

        <View className='rounded-lg p-4'>
          <Text className='mb-2 text-lg font-semibold'>{isSubscribed ? t`Premium Features` : t`Unlock Premium`}</Text>
          <Text className='mb-4 text-gray-600'>
            {isSubscribed
              ? t`Access exclusive premium features available to subscribers.`
              : t`Subscribe to unlock premium features and get the most out of the app.`}
          </Text>
          <Button variant='default' onPress={handlePremiumPress}>
            {isSubscribed ? t`View Premium Demo` : t`Subscribe Now`}
          </Button>
        </View>
      </ScrollView>
    </View>
  )
}
