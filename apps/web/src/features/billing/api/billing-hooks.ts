import { orpcQuery } from '@/lib/transport/orpc-client'
import { useQuery } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'

export const useGetSubscriptionDetails = () => {
  const { t } = useLingui()

  return useQuery(
    orpcQuery.billing.getSubscriptionDetails.queryOptions({
      select: (response) => response.data,
      meta: {
        errorMessage: t`Failed to fetch subscription details`,
      },
    })
  )
}
