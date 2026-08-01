import { useMutation, useQuery } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'
import { orpcQuery } from '@/lib/transport/orpc-client'

// The public shared-content catalog. The feed is small (server caps it), so
// language filtering happens client-side over one unfiltered read — the chips
// never pay a refetch.
export const useSharedContentList = () => {
  return useQuery(orpcQuery.sharedContent.list.queryOptions({ input: {}, select: (response) => response.data }))
}

export const useAddSharedEntryToLibrary = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.sharedContent.addToLibrary.mutationOptions({
      meta: {
        invalidates: [orpcQuery.studySessions.list.key()],
        // CEFR_REQUIRED and the guest cap are handled by the caller / the
        // global handler; this covers the dead-entry and generic failures.
        errorMessage: t`Could not add this content`,
      },
    })
  )
}

export const useShareState = (textTrackId: string | null, enabled: boolean) => {
  return useQuery(
    orpcQuery.sharedContent.getShareState.queryOptions({
      input: { textTrackId: textTrackId ?? '' },
      enabled: enabled && textTrackId !== null,
      select: (response) => response.data.state,
    })
  )
}

export const useSetShared = (textTrackId: string | null) => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.sharedContent.setShared.mutationOptions({
      meta: {
        invalidates: [
          orpcQuery.sharedContent.list.key(),
          ...(textTrackId
            ? [orpcQuery.sharedContent.getShareState.key({ input: { textTrackId } })]
            : [orpcQuery.sharedContent.getShareState.key()]),
        ],
        errorMessage: t`Could not update sharing for this content`,
      },
    })
  )
}
