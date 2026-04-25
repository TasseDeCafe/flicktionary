import { Text, View } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { Button } from '@/components/ui/button'
import { useLingui } from '@lingui/react/macro'

export const AccountRemovedView = () => {
  const { t } = useLingui()
  const router = useRouter()

  return (
    <View className='flex-1 p-4 pt-16'>
      <Stack.Screen options={{ headerShown: false }} />

      <View className='flex-1 justify-between pb-12'>
        <View className='mt-16 items-center'>
          <Text className='mb-3 text-center text-4xl font-bold text-gray-800'>{t`Account Removed`}</Text>

          <Text className='mt-6 text-center text-lg leading-relaxed text-gray-600'>
            {t`We're sorry to see you go. Your account has been successfully removed.`}
          </Text>
        </View>

        <View className='w-full space-y-8'>
          <Text className='text-center text-base text-gray-500'>
            {t`If you'd like to create a new account, you can sign up again.`}
          </Text>

          <Button onPress={() => router.replace('/login')} className='mt-4 py-4'>
            {t`Back to Login`}
          </Button>
        </View>
      </View>
    </View>
  )
}
