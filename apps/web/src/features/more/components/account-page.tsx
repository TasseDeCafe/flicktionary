import { useNavigate } from '@tanstack/react-router'
import { useLingui } from '@lingui/react/macro'
import { toast } from 'sonner'
import { ChevronRight } from 'lucide-react'
import { ModalScreen } from '@/features/navigation/components/modal-screen'
import { OverlayId } from '@flicktionary/ui/components/overlay-ids'
import { useOverlayStore } from '@/features/overlay/stores/overlay-store'
import { useGetSubscriptionDetails } from '@/features/billing/api/billing-hooks'
import { useCreateCustomerPortalSession } from '@/features/billing/api/portal-session-hooks'
import { logError } from '@/lib/analytics/log-error'
import { getIsAnonymous, getUserAvatarUrl, getUserEmail, getUserName, useAuthStore } from '@/stores/auth-store'

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
  const isAnonymous = useAuthStore(getIsAnonymous)
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
        logError({ message: 'Unexpected billing state in AccountPage', params: { subscriptionData } })
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
              <span className='text-xl font-semibold'>{getInitials(isAnonymous ? t`Guest` : userName, userEmail)}</span>
            )}
          </div>
          <div className='min-w-0'>
            <h2 className='truncate text-xl font-bold'>{isAnonymous ? t`Guest` : (userName ?? t`User`)}</h2>
            <p className='text-muted-foreground truncate text-sm'>{isAnonymous ? t`No account yet` : userEmail}</p>
          </div>
        </div>

        {/* A guest has no email, so billing can't work; the useful action is
            converting to a permanent account first. */}
        {isAnonymous ? (
          <button
            onClick={() => navigate({ to: '/save-progress' })}
            className='bg-card hover:bg-accent active:bg-accent/80 flex w-full items-center justify-between rounded-xl border px-4 py-4 text-left transition-colors'
          >
            <span className='font-medium'>{t`Create account to save your progress`}</span>
            <ChevronRight className='text-muted-foreground h-5 w-5' />
          </button>
        ) : (
          <button
            onClick={handleBillingClick}
            disabled={isSubscriptionLoading || isCustomerPortalPending}
            className='bg-card hover:bg-accent flex w-full items-center justify-between rounded-xl border px-4 py-4 text-left disabled:opacity-50'
          >
            <span className='font-medium'>{getBillingLabel()}</span>
            <ChevronRight className='text-muted-foreground h-5 w-5' />
          </button>
        )}
      </div>
    </ModalScreen>
  )
}
