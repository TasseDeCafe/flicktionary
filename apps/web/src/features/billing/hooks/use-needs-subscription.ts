import { useGetSubscriptionDetails } from '@/features/billing/api/billing-hooks'

export const useNeedsSubscription = () => {
  const {
    data: subscriptionDetailsData,
    isPending: isSubscriptionDetailsPending,
    isFetching: isSubscriptionDetailsFetching,
    isError: isSubscriptionDetailsError,
  } = useGetSubscriptionDetails()

  const isFetching = isSubscriptionDetailsPending || isSubscriptionDetailsFetching

  const needsSubscription =
    !subscriptionDetailsData?.isPremiumUser && !subscriptionDetailsData?.isSpecialUserWithFullAccess

  return {
    needsSubscription,
    isPending: isSubscriptionDetailsPending,
    isFetching,
    isError: isSubscriptionDetailsError,
    subscriptionData: subscriptionDetailsData,
  }
}
