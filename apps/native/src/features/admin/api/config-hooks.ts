import { orpcQuery } from '@/lib/transport/orpc-client'
import { useQuery } from '@tanstack/react-query'

export const useGetConfig = () => {
  return useQuery(
    orpcQuery.config.getConfig.queryOptions({
      meta: {
        skipGlobalInvalidation: true,
      },
      select: (response) => response.data,
    })
  )
}
