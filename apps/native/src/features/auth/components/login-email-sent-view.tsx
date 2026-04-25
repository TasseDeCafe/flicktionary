import { Text, View, Linking } from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { BackButton } from '@/components/ui/back-button'
import { Mail } from 'lucide-react-native'
import { useLingui } from '@lingui/react/macro'

export default function LoginEmailSentView() {
  const { t } = useLingui()

  const { email } = useLocalSearchParams<{ email: string }>()

  const openMailApp = () => {
    Linking.openURL('message:')
  }

  return (
    <View className='flex-1 items-center justify-center'>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTransparent: true,
          title: '',
          headerLeft: () => <BackButton />,
        }}
      />
      <Card className='w-full max-w-md p-6'>
        <View className='items-center'>
          <View className='rounded-full p-3'>
            <Mail size={24} />
          </View>
          <View className='m-8'>
            <Text className='text-center text-4xl leading-tight font-bold'>{t`Email Verification Sent`}</Text>
          </View>
          <View className='gap-4 text-center'>
            <Text className='text-center text-xl text-gray-600'>{t`We've sent a verification email to:`}</Text>
            <Text className='text-center text-xl font-bold text-gray-600'>{email}</Text>
            <Text className='text-center text-xl text-gray-600'>
              {t`Please check your inbox and click on the link to continue`}
            </Text>
            <Button onPress={openMailApp} className='mt-4 h-16'>
              <Text className='text-2xl font-medium text-white'>{t`Open Mail App`}</Text>
            </Button>
          </View>
        </View>
      </Card>
    </View>
  )
}
