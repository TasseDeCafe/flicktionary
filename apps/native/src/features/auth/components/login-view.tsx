import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { GoogleIcon } from '@/components/ui/icons/google-icon'
import { useAuthStore } from '@/stores/auth-store'
import { cn } from '@template-app/core/utils/tailwind-utils'
import { FEATURES } from '@template-app/core/features'
import * as AppleAuthentication from 'expo-apple-authentication'
import { Stack, useRouter } from 'expo-router'
import { Mail } from 'lucide-react-native'
import { Platform, View } from 'react-native'
import { ROUTE_PATHS } from '@/constants/route-paths'
import * as Haptics from 'expo-haptics'
import { useLingui } from '@lingui/react/macro'

export default function LoginView() {
  const { t } = useLingui()

  const router = useRouter()
  const { signInWithGoogle, signInWithApple } = useAuthStore()

  const handleEmailLogin = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).then(() => {})
    router.push(ROUTE_PATHS.LOGIN_EMAIL)
  }

  return (
    <View className='flex-1 items-center justify-center'>
      <Stack.Screen options={{ animation: 'none' }} />
      <Card className='w-full max-w-md p-6'>
        <View className='gap-4'>
          <Button
            variant='default'
            size='lg'
            onPress={handleEmailLogin}
            className='h-16 w-full items-center justify-center'
            textClassName='text-2xl font-medium h-full'
            startIcon={<Mail size={20} color='white' />}
          >
            {t`Continue with Email`}
          </Button>

          {FEATURES.GOOGLE_AUTH && (
            <Button
              variant='default'
              size='lg'
              onPress={signInWithGoogle}
              className='h-16 w-full items-center justify-center'
              textClassName='text-2xl font-medium h-full'
              startIcon={<GoogleIcon size={20} color='white' />}
            >
              {t`Continue with Google`}
            </Button>
          )}

          {FEATURES.APPLE_AUTH && Platform.OS === 'ios' && (
            <View className={cn('overflow-hidden rounded-xl')}>
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={12}
                style={{ width: '100%', height: 56 }}
                onPress={signInWithApple}
              />
            </View>
          )}
        </View>
      </Card>
    </View>
  )
}
