import { ActivityIndicator, Alert, Linking, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { toast } from 'sonner-native'
import { BigCard } from '@/components/ui/big-card'
import { useAuthStore } from '@/stores/auth-store'
import { Avatar } from '@/components/ui/avatar'
import { FEATURES } from '@template-app/core/features'
import RevenueCatUI from 'react-native-purchases-ui'
import { logWithSentry } from '@/lib/analytics/log-with-sentry'
import { SettingsItem } from '@/components/ui/settings-item'
import { useGetSubscriptionDetails } from '@/features/billing/api/billing-hooks'
import { getConfig } from '@/config/environment-config'
import { User } from '@supabase/supabase-js'
import { useLingui } from '@lingui/react/macro'
import { checkIsTestUser } from '@/utils/test-users-utils'
import { ROUTE_PATHS } from '@/constants/route-paths'

export const ProfileView = () => {
  const { t } = useLingui()

  const router = useRouter()
  const session = useAuthStore((state) => state.session)
  const signOut = useAuthStore((state) => state.signOut)

  const { data: subscriptionDetailsData, isLoading: isSubscriptionLoading } = useGetSubscriptionDetails()

  const subscriptionInfo = subscriptionDetailsData

  const user: User | undefined = session?.user
  const email = user?.email || ''
  const name: string = user?.user_metadata?.name || ''
  const avatarUrl = user?.user_metadata?.avatar_url || ''
  const isTestUser = checkIsTestUser(email)

  const handleSignOut = () => {
    signOut().then(() => {})
  }

  const handleAdminSettingsPress = () => {
    router.push(ROUTE_PATHS.ADMIN_SETTINGS)
  }

  const getInitials = () => {
    if (name) {
      return name
        .split(' ')
        .map((part) => part[0])
        .join('')
        .toUpperCase()
        .substring(0, 2)
    }
    return email.substring(0, 2).toUpperCase()
  }

  const handlePressCustomerCenter = async () => {
    if (!FEATURES.REVENUECAT) return
    try {
      await RevenueCatUI.presentCustomerCenter()
    } catch (error) {
      logWithSentry('Error presenting customer center', error)
      Alert.alert('Error', t`Could not open customer center.`)
    }
  }

  const handlePressUpgrade = async () => {
    if (!FEATURES.REVENUECAT) return
    try {
      await RevenueCatUI.presentPaywall({ displayCloseButton: true })
    } catch (error) {
      logWithSentry('Error presenting paywall from account', error)
      Alert.alert('Error', t`Could not open upgrade screen.`)
    }
  }

  const handlePressManageWebSubscription = async () => {
    const webAccountUrl = `${getConfig().webUrl}/dashboard#account`
    try {
      const supported = await Linking.canOpenURL(webAccountUrl)
      if (supported) {
        await Linking.openURL(webAccountUrl)
      } else {
        Alert.alert('Info', t`Please manage your subscription on our website: ${webAccountUrl}`)
      }
    } catch (error) {
      logWithSentry('Error opening web account url', error)
      Alert.alert('Error', t`Could not open the link. Please visit our website to manage your subscription.`)
    }
  }

  const renderBillingItem = () => {
    if (isSubscriptionLoading) {
      return (
        <View className='flex-row items-center justify-center px-2 py-4'>
          <ActivityIndicator />
        </View>
      )
    }

    if (subscriptionInfo?.isPremiumUser && !subscriptionInfo.billingPlatform) {
      return (
        <SettingsItem
          title={t`Customer Center`}
          value=''
          onPress={() => {
            toast.info(t`You are a special user with free access. You have no active subscription.`)
          }}
          disabled
        />
      )
    }

    if (!subscriptionInfo?.isPremiumUser) {
      return <SettingsItem title={t`Upgrade to Premium`} value='' onPress={handlePressUpgrade} />
    }

    switch (subscriptionInfo.billingPlatform) {
      case 'test_store':
      case 'app_store':
      case 'play_store':
        return <SettingsItem title={t`Customer Center`} value='' onPress={handlePressCustomerCenter} />
      case 'stripe':
        return <SettingsItem title={t`Manage Subscription`} value='Web' onPress={handlePressManageWebSubscription} />
      default:
        logWithSentry('Unexpected billing state in AccountScreen', { subscriptionInfo })
        return null
    }
  }

  return (
    <View className='mt-8 px-4'>
      {/* User profile section */}
      <View className='mb-8 flex-row items-center px-2'>
        <Avatar initials={getInitials()} url={avatarUrl} size={60} />
        <View className='ml-4'>
          <Text className='text-xl font-bold'>{name || 'User'}</Text>
          <Text className='text-gray-500'>{email}</Text>
        </View>
      </View>
      {/* Account settings */}
      <BigCard className='mb-4'>
        {renderBillingItem()}

        {isTestUser && <SettingsItem title={t`Admin Settings`} value='' onPress={handleAdminSettingsPress} />}

        <SettingsItem
          title={t`Danger Zone`}
          value=''
          onPress={() => router.push('/profile/danger-zone')}
          variant='destructive'
        />
      </BigCard>

      {/* Sign out */}
      <BigCard>
        <SettingsItem title={t`Sign out`} value='' onPress={handleSignOut} />
      </BigCard>
    </View>
  )
}
