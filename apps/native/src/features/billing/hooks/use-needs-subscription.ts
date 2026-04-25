import { useAuthStore } from '@/stores/auth-store'
import { useGetSubscriptionDetails } from '@/features/billing/api/billing-hooks'

export const useNeedsSubscription = () => {
  const session = useAuthStore((state) => state.session)

  const isSubscriptionQueryEnabled = !!session

  const {
    data: subscriptionDetailsData,
    isPending: isSubscriptionDetailsPending,
    isFetching: isSubscriptionDetailsFetching,
    isError: isSubscriptionDetailsError,
  } = useGetSubscriptionDetails({
    enabled: isSubscriptionQueryEnabled,
  })

  const isFetching = isSubscriptionDetailsPending || isSubscriptionDetailsFetching

  const needsSubscription =
    !subscriptionDetailsData?.isPremiumUser && !subscriptionDetailsData?.isSpecialUserWithFullAccess

  return {
    needsSubscription,
    isFetching,
    isError: isSubscriptionDetailsError,
    subscriptionData: subscriptionDetailsData,
  }
}
