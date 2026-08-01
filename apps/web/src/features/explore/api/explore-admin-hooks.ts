import { useMutation, useQuery } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'
import { orpcQuery } from '@/lib/transport/orpc-client'

export type SharedContentEntryStatus = 'live' | 'unshared' | 'removed'

// Admin-only read behind the Explore status chips. `enabled` gates on the
// web-side test-user check so a non-admin never fires a doomed 403 request;
// the server's assertTestUser stays the authority.
export const useAdminSharedContentList = (status: SharedContentEntryStatus, enabled: boolean) => {
  return useQuery(
    orpcQuery.sharedContent.adminList.queryOptions({
      input: { status },
      enabled,
      select: (response) => response.data,
    })
  )
}

// Both admin mutations also invalidate the public list (removing an entry
// pulls it from the Explore feed, the featured flag drives the dashboard
// featured section) and the detail read (the actions live on the detail
// screen, which must reflect the new status without a reload).
export const useAdminRemoveSharedEntry = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.sharedContent.adminRemove.mutationOptions({
      meta: {
        invalidates: [
          orpcQuery.sharedContent.adminList.key(),
          orpcQuery.sharedContent.list.key(),
          orpcQuery.sharedContent.get.key(),
        ],
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
        invalidates: [
          orpcQuery.sharedContent.adminList.key(),
          orpcQuery.sharedContent.list.key(),
          orpcQuery.sharedContent.get.key(),
        ],
        errorMessage: t`Could not update the featured flag`,
      },
    })
  )
}
