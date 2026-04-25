import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/transport/orpc-client'
import { QUERY_KEYS } from '@/lib/transport/query-keys'
import { useLingui } from '@lingui/react/macro'

export const useGetSubscriptionDetails = (options?: { enabled?: boolean }) => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.billing.getSubscriptionDetails.queryOptions({
      meta: {
        errorMessage: t`Failed to fetch subscription details`,
        skipGlobalInvalidation: true,
      },
      queryKey: [QUERY_KEYS.SUBSCRIPTION_DETAILS],
      select: (response) => response.data,
      enabled: options?.enabled,
    })
  )
}
