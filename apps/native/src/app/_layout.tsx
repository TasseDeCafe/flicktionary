import '../global.css'
import '@/polyfills/intl'
import { Stack, useNavigationContainerRef } from 'expo-router'
import { validateConfig } from '@/config/environment-config-validator'
import { getConfig } from '@/config/environment-config'
import * as Sentry from '@sentry/react-native'
import { initializeSentry, navigationIntegration } from '@/lib/analytics/sentry-initializer'
import { useEffect } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet'
import { BottomSheetController } from '@/features/sheets/components/bottom-sheet-controller'
import { PortalHost } from '@rn-primitives/portal'
import { queryClient } from '@/config/react-query-config'
import { LocaleInitializer } from '@/lib/i18n/locale-initializer'
import { useAuthStore } from '@/stores/auth-store'
import { SessionInitializer } from '@/features/auth/components/session-initializer'
import { EasUpdateGate } from '@/components/gates/eas-update-gate'
import { useBottomSheetStore } from '@/features/sheets/stores/bottom-sheet-store'
import { UserSetupGate } from '@/features/auth/components/user-setup-gate'
import { FEATURES } from '@template-app/core/features'
import { PostHogProvider } from 'posthog-react-native'
import { posthog } from '@/lib/analytics/posthog'

validateConfig(getConfig())
initializeSentry()

const RootLayout = () => {
  const ref = useNavigationContainerRef()
  const session = useAuthStore((state) => state.session)
  const isSignedIn = !!session
  const activeSheetName = useBottomSheetStore((state) => state.activeSheetName)
  const isBottomSheetOpen = activeSheetName !== null

  // Register the navigation container with Sentry to enable automatic navigation tracking
  // This allows Sentry to monitor navigation performance metrics and capture navigation-related errors
  // See: https://docs.sentry.io/platforms/react-native/tracing/instrumentation/expo-router/
  useEffect(() => {
    if (FEATURES.SENTRY && ref) {
      navigationIntegration.registerNavigationContainer(ref)
    }
  }, [ref])

  return (
    <PostHogProviderWrapper>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <QueryClientProvider client={queryClient}>
          <LocaleInitializer>
            <BottomSheetModalProvider>
              <KeyboardProvider>
                <SessionInitializer>
                  <EasUpdateGate>
                    <UserSetupGate>
                      <Stack screenOptions={{ headerShown: false }}>
                        <Stack.Protected guard={!isSignedIn}>
                          <Stack.Screen name='login/index' />
                          <Stack.Screen name='login/email/index' />
                          <Stack.Screen name='login/email/sent' />
                          <Stack.Screen name='account/removed' />
                        </Stack.Protected>
                        <Stack.Protected guard={isSignedIn}>
                          <Stack.Screen name='(authenticated)' />
                        </Stack.Protected>
                        <Stack.Screen name='+not-found' />
                      </Stack>
                      <BottomSheetController />
                      <Toaster position={isBottomSheetOpen ? 'top-center' : 'bottom-center'} duration={600} />
                      <PortalHost />
                    </UserSetupGate>
                  </EasUpdateGate>
                </SessionInitializer>
              </KeyboardProvider>
            </BottomSheetModalProvider>
          </LocaleInitializer>
        </QueryClientProvider>
      </GestureHandlerRootView>
    </PostHogProviderWrapper>
  )
}

const PostHogProviderWrapper = ({ children }: { children: React.ReactNode }) =>
  FEATURES.POSTHOG && posthog ? <PostHogProvider client={posthog}>{children}</PostHogProvider> : <>{children}</>

export default FEATURES.SENTRY ? Sentry.wrap(RootLayout) : RootLayout
