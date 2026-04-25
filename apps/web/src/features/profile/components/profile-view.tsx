import { useNavigate } from '@tanstack/react-router'
import { getUserAvatarUrl, getUserEmail, getUserName, useAuthStore } from '@/stores/auth-store'
import { useLingui } from '@lingui/react/macro'
import { useOverlayStore } from '@/features/overlay/stores/overlay-store'
import { useGetSubscriptionDetails } from '@/features/billing/api/billing-hooks'
import { useCreateCustomerPortalSession } from '@/features/billing/api/portal-session-hooks'
import { Route as AdminSettingsRoute } from '@/app/routes/_authenticated/admin-settings'
import { Route as DangerZoneRoute } from '@/app/routes/_authenticated/profile/danger-zone'
import { toast } from 'sonner'
import { OverlayId } from '@/components/ui/overlay-ids'
import { logWithSentry } from '@/lib/analytics/log-with-sentry'
import { ChevronRight } from 'lucide-react'

export const ProfileView = () => {
  const { t } = useLingui()

  const userEmail = useAuthStore(getUserEmail)
  const userName = useAuthStore(getUserName)
  const avatarUrl = useAuthStore(getUserAvatarUrl)
  const signOut = useAuthStore((state) => state.signOut)
  const openOverlay = useOverlayStore((state) => state.openOverlay)

  const { data: subscriptionData, isLoading: isSubscriptionLoading } = useGetSubscriptionDetails()
  const { mutate: mutateCustomerPortalSession, isPending: isCustomerPortalPending } = useCreateCustomerPortalSession()

  const navigate = useNavigate()

  const getInitials = () => {
    if (userName) {
      return userName
        .split(' ')
        .map((part: string) => part[0])
        .join('')
        .toUpperCase()
        .substring(0, 2)
    }
    return (userEmail || '').substring(0, 2).toUpperCase()
  }

  const handleSignOut = async () => {
    await signOut(() => navigate({ to: '/login' }))
    toast.success(t`Sign out success`)
  }

  const handleAdminSettingsPress = () => {
    navigate({ to: AdminSettingsRoute.to })
  }

  const handleDangerZonePress = () => {
    navigate({ to: DangerZoneRoute.to })
  }

  const handleBillingClick = () => {
    if (isSubscriptionLoading) return

    if (subscriptionData?.isPremiumUser && !subscriptionData.billingPlatform) {
      toast.info(t`You are a special user with free access. You have no active subscription.`)
      return
    }

    if (!subscriptionData?.isPremiumUser) {
      openOverlay(OverlayId.PRICING)
      return
    }

    switch (subscriptionData.billingPlatform) {
      case 'stripe': {
        const currentPath = location.pathname + location.search
        mutateCustomerPortalSession({ returnPath: currentPath })
        break
      }
      case 'app_store':
      case 'play_store':
        toast.info(t`Please manage your subscription through the App Store or Google Play.`)
        break
      default:
        logWithSentry({ message: 'Unexpected billing state in ProfileView', params: { subscriptionData } })
        toast.error(t`Could not open billing settings.`)
    }
  }

  const getBillingLabel = () => {
    if (isSubscriptionLoading) return t`Loading...`
    if (!subscriptionData?.isPremiumUser) return t`Upgrade to Premium`
    return t`Manage Subscription`
  }

  return (
    <div className='flex flex-col gap-6 px-4 py-4'>
      {/* User profile section */}
      <div className='flex items-center gap-4 px-2'>
        <div className='flex h-16 w-16 items-center justify-center overflow-hidden rounded-full'>
          {avatarUrl ? (
            <img src={avatarUrl} alt='Avatar' className='h-full w-full object-cover' />
          ) : (
            <span className='text-xl font-semibold'>{getInitials()}</span>
          )}
        </div>
        <div>
          <h2 className='text-xl font-bold'>{userName || 'User'}</h2>
          <p className='text-gray-500'>{userEmail}</p>
        </div>
      </div>

      <button
        onClick={handleBillingClick}
        disabled={isSubscriptionLoading || isCustomerPortalPending}
        className='flex w-full items-center justify-between px-4 py-4 text-left hover:bg-gray-50 disabled:opacity-50'
      >
        <div className='flex items-center gap-3'>
          <span>{getBillingLabel()}</span>
        </div>
        <ChevronRight className='h-5 w-5 text-gray-400' />
      </button>

      <button
        onClick={handleDangerZonePress}
        className='flex w-full items-center justify-between px-4 py-4 text-left text-red-600 hover:bg-red-50'
      >
        <div className='flex items-center gap-3'>
          <span>{t`Danger Zone`}</span>
        </div>
        <ChevronRight className='h-5 w-5 text-red-400' />
      </button>
      <button
        onClick={handleAdminSettingsPress}
        className='flex w-full items-center justify-between px-4 py-4 hover:bg-gray-50'
      >
        <div className='flex items-center gap-3'>
          <span>{t`Admin Settings`}</span>
        </div>
        <ChevronRight className='h-5 w-5' />
      </button>
      <button
        onClick={handleSignOut}
        className='flex w-full items-center justify-between px-4 py-4 hover:bg-gray-50 disabled:opacity-50'
      >
        <div className='flex items-center gap-3'>
          <span>{t`Sign out`}</span>
        </div>
        <ChevronRight className='h-5 w-5' />
      </button>
    </div>
  )
}
