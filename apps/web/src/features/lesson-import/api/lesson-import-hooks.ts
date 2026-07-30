import { useMutation, useQuery } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'
import { orpcQuery } from '@/lib/transport/orpc-client'
import { difficultyInvalidates, practiceSummaryKeys } from '@/features/practice/api/practice-hooks'

export const useCreateLessonBatch = () => {
  return useMutation(
    orpcQuery.lessonImport.createBatch.mutationOptions({
      meta: {
        // The wizard's own onError branches on the moderation gate's
        // CONTENT_BLOCKED code and shows a generic toast for everything else.
        showErrorToast: false,
      },
    })
  )
}

// Poll while extraction is running (2s, the useGetProcessingStatus cadence),
// stop the moment the batch reaches a terminal state.
export const useGetLessonBatch = (batchId: string) => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.lessonImport.getBatch.queryOptions({
      input: { batchId },
      enabled: batchId.length > 0,
      select: (response) => response.data,
      refetchInterval: (query) => {
        const status = query.state.data?.data.batch.status
        return status === 'extracting' ? 2000 : false
      },
      meta: { errorMessage: t`Failed to load the import` },
    })
  )
}

export const useConfirmLessonBatch = (batchId: string) => {
  return useMutation(
    orpcQuery.lessonImport.confirmBatch.mutationOptions({
      meta: {
        // The confirm creates a session + highlights and may add facets /
        // lapse schedules on existing terms.
        invalidates: [
          orpcQuery.lessonImport.getBatch.key({ input: { batchId } }),
          orpcQuery.studySessions.list.key(),
          orpcQuery.chunks.listChunks.key(),
          ...practiceSummaryKeys(),
          ...difficultyInvalidates(),
        ],
        // `showErrorToast: false`: the confirm view's own onError turns
        // `cefr_not_set` into an inline CEFR picker (no toast) and shows a
        // generic toast for everything else.
        showErrorToast: false,
      },
    })
  )
}

export const useListTeacherProfiles = () => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.lessonImport.listProfiles.queryOptions({
      input: {},
      select: (response) => response.data.profiles,
      meta: { errorMessage: t`Failed to load teacher profiles` },
    })
  )
}
