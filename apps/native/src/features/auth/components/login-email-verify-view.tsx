import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ROUTE_PATHS } from '@/constants/route-paths'
import { supabaseClient } from '@/lib/transport/supabase-client'
import { POSTHOG_EVENTS } from '@/lib/analytics/posthog-events'
import { useLingui } from '@lingui/react/macro'

export const LoginEmailVerifyView = () => {
  const { t } = useLingui()

  const { token_hash } = useLocalSearchParams()
  const [isError, setIsError] = useState(false)
  const [isVerifying, setIsVerifying] = useState(true)
  const router = useRouter()

  const verifyMagicLinkOtp = useCallback(async (tokenHash: string): Promise<boolean> => {
    try {
      const { error } = await supabaseClient.auth.verifyOtp({
        type: 'magiclink',
        token_hash: tokenHash,
      })

      if (error) {
        POSTHOG_EVENTS.magicLinkFailureOrExpiration()
        return false
      }
      return true
    } catch {
      POSTHOG_EVENTS.magicLinkFailureOrExpiration()
      return false
    }
  }, [])

  useEffect(() => {
    const verifyToken = async () => {
      if (token_hash) {
        setIsVerifying(true)
        const wasSuccessful = await verifyMagicLinkOtp(token_hash as string)
        if (!wasSuccessful) {
          setIsError(true)
        }
        setIsVerifying(false)
      }
    }

    verifyToken().then()
  }, [token_hash, verifyMagicLinkOtp])

  const handleReturnToLogin = () => {
    router.replace(ROUTE_PATHS.LOGIN)
  }

  return (
    <View className='flex-1 items-center justify-center'>
      <Card className='w-full max-w-md p-6'>
        <View className='items-center'>
          <View className='mb-8 text-center'>
            <Text className='text-center text-4xl leading-tight font-bold'>
              {isError ? t`Email link is invalid or has expired` : t`Verify Your Email`}
            </Text>
          </View>

          {isVerifying ? (
            <View className='items-center py-4'>
              <ActivityIndicator size='large' color='#4f46e5' />
              <Text className='mt-4 text-center text-lg text-gray-600'>{t`Verifying...`}</Text>
            </View>
          ) : isError ? (
            <View className='w-full items-center'>
              <Button onPress={handleReturnToLogin} className='mt-4 h-16 w-full'>
                <View className='w-full flex-row items-center justify-center'>
                  <Text className='text-center text-2xl font-medium text-white'>{t`Return to Login`}</Text>
                </View>
              </Button>
            </View>
          ) : (
            <View className='items-center'>
              <Text className='text-center text-lg text-gray-600'>{t`Verification successful! Redirecting...`}</Text>
            </View>
          )}
        </View>
      </Card>
    </View>
  )
}
