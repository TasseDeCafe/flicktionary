import { useMutation, useQuery } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'
import { orpcQuery } from '@/lib/transport/orpc-client'

export const useAdminSharedContentList = () => {
  return useQuery(orpcQuery.sharedContent.adminList.queryOptions({ input: {}, select: (response) => response.data }))
}

// Both admin mutations also invalidate the public list: removing an entry
// pulls it from the Explore feed, and the featured flag drives the dashboard
// featured section.
export const useAdminRemoveSharedEntry = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.sharedContent.adminRemove.mutationOptions({
      meta: {
        invalidates: [orpcQuery.sharedContent.adminList.key(), orpcQuery.sharedContent.list.key()],
        errorMessage: t`Could not remove this entry`,
      },
    })
  )
}

export const useAdminSetSharedEntryFeatured = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.sharedContent.adminSetFeatured.mutationOptions({
      meta: {
        invalidates: [orpcQuery.sharedContent.adminList.key(), orpcQuery.sharedContent.list.key()],
        errorMessage: t`Could not update the featured flag`,
      },
    })
  )
}
