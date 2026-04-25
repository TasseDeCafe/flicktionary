import { Alert, Text, View } from 'react-native'
import { SafeAreaView } from '@/components/ui/styled'
import { Stack } from 'expo-router'
import { BackButton } from '@/components/ui/back-button'
import { useLingui } from '@lingui/react/macro'
import { BigCard } from '@/components/ui/big-card'
import { SettingsItem } from '@/components/ui/settings-item'
import { logWithSentry } from '@/lib/analytics/log-with-sentry'
import { useTriggerSentryMessageMutation } from '@/features/admin/api/sentry-debug-hooks'

export const AdminSettingsView = () => {
  const { t } = useLingui()
  const triggerSentryMessageMutation = useTriggerSentryMessageMutation()

  const handleTestSentryLog = () => {
    logWithSentry(
      'Test Sentry log from Admin Settings (Native)',
      new Error('Test Sentry error from Admin Settings (Native)'),
      {
        test: 'test',
        another_test: 'another_test',
      },
      'warning'
    )
    Alert.alert('Success', 'Sentry test log sent!')
  }

  const handleTestSentryError = () => {
    Alert.alert('Info', 'Unhandled error will be thrown and captured by Sentry!')
    setTimeout(() => {
      throw new Error('Test unhandled error from Admin Settings (Native)')
    }, 500)
  }

  const handleTestBackendSentryMessage = async () => {
    try {
      await triggerSentryMessageMutation.mutateAsync({
        message: 'Test backend Sentry message from Admin Settings (Native)',
        isInfoLevel: false,
      })
      Alert.alert('Success', 'Backend Sentry test message sent!')
    } catch (error) {
      logWithSentry('Failed to trigger backend Sentry message', error)
      Alert.alert('Error', 'Failed to send backend Sentry test message')
    }
  }

  return (
    <SafeAreaView className='flex-1 bg-white'>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Admin Settings',
          headerLeft: () => <BackButton />,
        }}
      />
      <View className='flex-1 px-4'>
        <Text className='mt-4 text-lg font-medium'>{t`Admin Settings`}</Text>

        <View className='mt-6'>
          <Text className='mb-2 text-sm text-gray-500'>
            {t`Use these options to test Sentry error reporting in your environment.`}
          </Text>
          <BigCard>
            <SettingsItem title={t`Test Frontend Sentry Log`} value='' onPress={handleTestSentryLog} />
            <SettingsItem title={t`Test Frontend Unhandled Error`} value='' onPress={handleTestSentryError} />
            <SettingsItem title={t`Test Backend Sentry Message`} value='' onPress={handleTestBackendSentryMessage} />
          </BigCard>
        </View>
      </View>
    </SafeAreaView>
  )
}
