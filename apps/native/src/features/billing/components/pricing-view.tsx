import { Text, View } from 'react-native'
import { SafeAreaView } from '@/components/ui/styled'
import { Stack } from 'expo-router'
import { BackButton } from '@/components/ui/back-button'

export const PricingView = () => {
  return (
    <SafeAreaView className='flex-1 bg-white'>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Pricing',
          headerLeft: () => <BackButton />,
        }}
      />
      <View className='flex-1 px-4'>
        <Text className='mt-4 text-lg font-medium'>Pricing</Text>
      </View>
    </SafeAreaView>
  )
}
