import { Text, View } from 'react-native'
import { SafeAreaView } from '@/components/ui/styled'
import { Stack, router } from 'expo-router'
import { BackButton } from '@/components/ui/back-button'
import { useNeedsSubscription } from '@/features/billing/hooks/use-needs-subscription'
import { LoadingScreen } from '@/components/ui/loading-screen'
import { Button } from '@/components/ui/button'
import { useEffect } from 'react'
import { useLingui } from '@lingui/react/macro'

export const PremiumDemoView = () => {
  const { t } = useLingui()
  const { needsSubscription, isFetching } = useNeedsSubscription()

  useEffect(() => {
    if (!isFetching && needsSubscription) {
      router.back()
    }
  }, [needsSubscription, isFetching])

  return (
    <SafeAreaView className='flex-1 bg-white'>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Premium Demo',
          headerLeft: () => <BackButton />,
        }}
      />
      {isFetching ? (
        <LoadingScreen message={t`Loading...`} />
      ) : needsSubscription ? (
        <LoadingScreen message={t`Redirecting...`} />
      ) : (
        <View className='flex-1 items-center justify-center px-4'>
          <Text className='mb-4 text-2xl font-bold'>{t`Premium Features`}</Text>
          <Text className='mb-8 text-center text-lg text-gray-600'>
            {t`This screen is only accessible to subscribed users. You can showcase premium features here.`}
          </Text>
          <Button variant='outline' onPress={() => router.back()}>
            {t`Go Back`}
          </Button>
        </View>
      )}
    </SafeAreaView>
  )
}
