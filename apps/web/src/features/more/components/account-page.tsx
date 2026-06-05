import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { toast } from 'sonner'
import { ChevronRight } from 'lucide-react'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import { OverlayId } from '@flicktionary/ui/components/overlay-ids'
import { useOverlayStore } from '@/features/overlay/stores/overlay-store'
import { useGetSubscriptionDetails } from '@/features/billing/api/billing-hooks'
import { useCreateCustomerPortalSession } from '@/features/billing/api/portal-session-hooks'
import { logWithSentry } from '@/lib/analytics/log-with-sentry'
import { getUserAvatarUrl, getUserEmail, getUserName, useAuthStore } from '@/stores/auth-store'

const getInitials = (name: string | null, email: string | null): string => {
  if (name) {
    return name
      .split(' ')
      .map((part) => part[0])
      .join('')
      .toUpperCase()
      .substring(0, 2)
  }
  return (email ?? '').substring(0, 2).toUpperCase()
}

export const AccountPage = () => {
  const { t } = useLingui()
  const navigate = useNavigate()

  const userEmail = useAuthStore(getUserEmail)
  const userName = useAuthStore(getUserName)
  const avatarUrl = useAuthStore(getUserAvatarUrl)
  const openOverlay = useOverlayStore((state) => state.openOverlay)

  const { data: subscriptionData, isLoading: isSubscriptionLoading } = useGetSubscriptionDetails()
  const { mutate: mutateCustomerPortalSession, isPending: isCustomerPortalPending } = useCreateCustomerPortalSession()

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
        logWithSentry({ message: 'Unexpected billing state in AccountPage', params: { subscriptionData } })
        toast.error(t`Could not open billing settings.`)
    }
  }

  const getBillingLabel = () => {
    if (isSubscriptionLoading) return t`Loading…`
    if (!subscriptionData?.isPremiumUser) return t`Upgrade to Premium`
    return t`Manage Subscription`
  }

  return (
    <ModalScreen onClose={() => navigate({ to: '/more' })} closeIcon='chevron' title={t`Account`}>
      <div className='mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 overflow-y-auto px-4 py-6'>
        <div className='flex items-center gap-4'>
          <div className='bg-muted flex h-16 w-16 items-center justify-center overflow-hidden rounded-full'>
            {avatarUrl ? (
              <img src={avatarUrl} alt={t`Avatar`} className='h-full w-full object-cover' />
            ) : (
              <span className='text-xl font-semibold'>{getInitials(userName, userEmail)}</span>
            )}
          </div>
          <div className='min-w-0'>
            <h2 className='truncate text-xl font-bold'>{userName ?? t`User`}</h2>
            <p className='text-muted-foreground truncate text-sm'>{userEmail}</p>
          </div>
        </div>

        <button
          onClick={handleBillingClick}
          disabled={isSubscriptionLoading || isCustomerPortalPending}
          className='bg-card hover:bg-accent flex w-full items-center justify-between rounded-xl border px-4 py-4 text-left disabled:opacity-50'
        >
          <span className='font-medium'>{getBillingLabel()}</span>
          <ChevronRight className='text-muted-foreground h-5 w-5' />
        </button>
      </div>
    </ModalScreen>
  )
}
