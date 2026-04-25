import { ReactNode, useEffect, useState } from 'react'
import { Alert, Image, Linking, Modal, Platform, StatusBar, Text, View } from 'react-native'
import { useGetConfig } from '@/features/admin/api/config-hooks'
import { getAppVersion, requiresUpdate } from '@/utils/version-utils'
import { Button } from '@/components/ui/button'
import { LoadingScreen } from '@/components/ui/loading-screen'
import { EXTERNAL_LINKS } from '@template-app/core/constants/external-links'
import { logWithSentry } from '@/lib/analytics/log-with-sentry'
import { POSTHOG_EVENTS } from '@/lib/analytics/posthog-events'
import { useLingui } from '@lingui/react/macro'

type ForceUpdateGateProps = {
  children: ReactNode
}

const getAppStoreUrl = () => {
  if (Platform.OS === 'ios') {
    return EXTERNAL_LINKS.IOS_APP_STORE_URL
  } else {
    return EXTERNAL_LINKS.ANDROID_GOOGLE_PLAY_URL
  }
}

export const ForceUpdateGate = ({ children }: ForceUpdateGateProps) => {
  const { t } = useLingui()

  const { data: configData, isFetching, error } = useGetConfig()
  const [shouldShowUpdateModal, setShouldShowUpdateModal] = useState(false)
  const currentVersion = getAppVersion()

  const requiredVersion = configData
    ? Platform.OS === 'ios'
      ? configData.lowestSupportedVersionIos
      : configData.lowestSupportedVersionAndroid
    : 'Unknown'

  useEffect(() => {
    if (isFetching || !configData) {
      return
    }

    const requiredVersion =
      Platform.OS === 'ios' ? configData.lowestSupportedVersionIos : configData.lowestSupportedVersionAndroid

    const needsUpdate = requiresUpdate(currentVersion, requiredVersion)
    setShouldShowUpdateModal(needsUpdate)
  }, [configData, currentVersion, isFetching])

  useEffect(() => {
    if (shouldShowUpdateModal) {
      POSTHOG_EVENTS.forceUserToDownloadUpdateFromStore()
    }
  }, [shouldShowUpdateModal])

  const handleUpdatePress = async () => {
    try {
      const url = getAppStoreUrl()
      const canOpen = await Linking.canOpenURL(url)

      if (canOpen) {
        await Linking.openURL(url)
      } else {
        POSTHOG_EVENTS.updateFromAppStoreFailed()
        Alert.alert(t`Unable to open app store`, t`Please manually update the app through your device's app store.`, [
          { text: t`OK` },
        ])
      }
    } catch (error) {
      logWithSentry('Error opening app store', error)
      Alert.alert(t`Error`, t`Unable to open app store. Please manually update the app.`, [{ text: t`OK` }])
    }
  }

  // Show loading while checking version requirements
  if (isFetching && !configData) {
    return <LoadingScreen message={t`Checking app version...`} />
  }

  // If there's an error checking version requirements, allow the app to continue.
  // This prevents the app from being unusable due to network issues.
  if (error && !configData) {
    logWithSentry('Failed to check version requirements', error)
    return children
  }

  return (
    <View style={{ flex: 1 }}>
      {!shouldShowUpdateModal && children}
      <Modal visible={shouldShowUpdateModal} animationType='fade' transparent={false} presentationStyle='fullScreen'>
        <StatusBar backgroundColor='#000' barStyle='light-content' />
        <View className='bg-background flex-1 px-6 pt-16 pb-8'>
          {/* App Icon/Logo */}
          <View className='mt-32 items-center'>
            <View className='bg-primary mb-4 h-24 w-24 items-center justify-center rounded-3xl'>
              <Image source={require('@/assets/images/splash-icon.png')} style={{ width: '100%', height: '100%' }} />
            </View>
          </View>

          {/* Content */}
          <View className='flex-1 justify-center'>
            <Text className='text-foreground text-center text-2xl font-bold'>{t`Update Required`}</Text>
            <View className='bg-card mb-8 rounded-2xl p-6'>
              <Text className='text-card-foreground mb-4 text-center text-lg leading-6'>
                {t`A newer version of the app is required to continue. Please update to the latest version to access all features and improvements.`}
              </Text>

              <View className='bg-muted rounded-xl p-4'>
                <Text className='text-muted-foreground text-center text-sm'>
                  {t`Current version: ${currentVersion}
Required version: ${requiredVersion}`}
                </Text>
              </View>
            </View>
          </View>

          <Button onPress={handleUpdatePress} size='lg' className='mb-12 w-full'>
            <Text className='text-primary-foreground text-lg font-semibold'>{t`Update Now`}</Text>
          </Button>
        </View>
      </Modal>
    </View>
  )
}
