import { Text, TextInput, View } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { BackButton } from '@/components/ui/back-button'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from 'sonner-native'
import { useState } from 'react'
import { logWithSentry } from '@/lib/analytics/log-with-sentry'
import { ROUTE_PATHS } from '@/constants/route-paths'
import { useLingui } from '@lingui/react/macro'

export default function LoginEmailView() {
  const { t } = useLingui()

  const router = useRouter()
  const [emailInput, setEmailInput] = useState('')
  const [hasEmailError, setHasEmailError] = useState(false)
  const [loading, setLoading] = useState(false)
  const signInWithMagicLink = useAuthStore((state) => state.signInWithMagicLink)

  const validateEmail = (email: string) => {
    const re = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
    return re.test(email)
  }

  const handleLogin = async () => {
    if (!validateEmail(emailInput)) {
      setHasEmailError(true)
      return
    }

    setLoading(true)
    setHasEmailError(false)

    try {
      const { error } = await signInWithMagicLink(emailInput)
      if (error) {
        toast.error(error.message)
      } else {
        router.push({
          pathname: ROUTE_PATHS.LOGIN_EMAIL_SENT,
          params: {
            email: emailInput,
          },
        })
      }
    } catch (error) {
      toast.error(t`An unexpected error occurred`)
      logWithSentry('Error sending magic link', error)
    } finally {
      setLoading(false)
    }
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
        <View className='mb-8 text-center'>
          <Text className='text-center text-4xl leading-tight font-bold'>{t`Continue with Email`}</Text>
        </View>

        <View className='gap-4'>
          <View className='w-full'>
            <TextInput
              placeholder={t`Email address`}
              placeholderTextColor='gray'
              value={emailInput}
              onChangeText={(text) => {
                setEmailInput(text)
                setHasEmailError(false)
              }}
              keyboardType='email-address'
              autoCapitalize='none'
              autoComplete='email'
              autoCorrect={false}
              textAlignVertical='center'
              className='h-16 w-full rounded-xl border border-gray-300 px-3 text-xl'
            />
            {hasEmailError ? (
              <Text className='mt-1 text-base text-red-500'>{t`Please enter a valid email address`}</Text>
            ) : null}
          </View>

          <Button onPress={handleLogin} disabled={loading} className='h-16'>
            <Text className='text-2xl font-medium text-white'>{loading ? t`Sending an email` : t`Continue`}</Text>
          </Button>
        </View>
      </Card>
    </View>
  )
}
