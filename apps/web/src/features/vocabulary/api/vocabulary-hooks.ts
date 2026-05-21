import { orpcQuery } from '@/lib/transport/orpc-client'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'
import type { ChunksSort } from '@flicktionary/api-client/orpc-contracts/chunks-contract'
import type { LearningMode } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'

export const useListLanguages = () => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.chunks.listLanguages.queryOptions({
      input: {},
      select: (response) => response.languages,
      meta: { errorMessage: t`Failed to load languages` },
    })
  )
}

export const useListChunksInfinite = (params: {
  targetLanguage: string | null
  sort: ChunksSort
  q?: string
  limit?: number
  learningMode?: LearningMode | null
}) => {
  const { t } = useLingui()
  const targetLanguage = params.targetLanguage
  const q = params.q?.trim() ?? ''
  const learningMode = params.learningMode ?? null
  return useInfiniteQuery(
    orpcQuery.chunks.listChunks.infiniteOptions({
      enabled: Boolean(targetLanguage),
      input: (pageParam: string | null) => ({
        targetLanguage: targetLanguage ?? '',
        sort: params.sort,
        cursor: pageParam ?? null,
        limit: params.limit ?? 50,
        ...(q.length > 0 ? { q } : {}),
        ...(learningMode ? { learningMode } : {}),
      }),
      initialPageParam: null as string | null,
      getNextPageParam: (last) => last.nextCursor,
      meta: { errorMessage: t`Failed to load vocabulary` },
    })
  )
}

// Switch a chunk's learning_mode between passive/active. Optimistically patches
// every in-flight infinite-query page so chips flip instantly, then invalidates
// the chunks list + practice due summary on settle (counts depend on mode).
export const useSetLearningMode = () => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.chunks.setLearningMode.mutationOptions({
      onMutate: async ({ chunkId, learningMode }) => {
        await queryClient.cancelQueries({ queryKey: orpcQuery.chunks.listChunks.key() })
        const snapshot = queryClient.getQueriesData({ queryKey: orpcQuery.chunks.listChunks.key() })
        queryClient.setQueriesData<{
          pages: Array<{ rows: Array<{ id: string; learningMode: LearningMode }>; nextCursor: string | null }>
        }>({ queryKey: orpcQuery.chunks.listChunks.key() }, (old) => {
          if (!old) return old
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              rows: page.rows.map((row) => (row.id === chunkId ? { ...row, learningMode } : row)),
            })),
          }
        })
        return { snapshot }
      },
      onError: (_err, _vars, context) => {
        if (!context) return
        for (const [key, value] of context.snapshot) {
          queryClient.setQueryData(key, value)
        }
      },
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: orpcQuery.chunks.listChunks.key() })
        void queryClient.invalidateQueries({ queryKey: orpcQuery.practice.dueSummary.key() })
        void queryClient.invalidateQueries({ queryKey: orpcQuery.practice.getSession.key() })
        void queryClient.invalidateQueries({ queryKey: orpcQuery.cards.get.key() })
        void queryClient.invalidateQueries({ queryKey: orpcQuery.cards.listBySession.key() })
      },
      meta: {
        errorMessage: t`Failed to update learning mode`,
        showErrorModal: true,
      },
    })
  )
}

export const useExportVocabularyCsv = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.chunks.exportCsv.mutationOptions({
      meta: { errorMessage: t`Failed to export vocabulary` },
    })
  )
}

// Soft-delete is a quick mutation but the optimistic UX matters: the row
// disappears the moment the user confirms. We do that by patching every
// in-flight infinite-query page to drop the row, then invalidate the whole
// chunks.listChunks family on settle so the server's view is the truth.
// Practice's dueSummary is also invalidated because deleting hides the chunk
// from the SRS queue.
export const useDeleteChunk = () => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.chunks.deleteChunk.mutationOptions({
      onMutate: async ({ id }) => {
        await queryClient.cancelQueries({ queryKey: orpcQuery.chunks.listChunks.key() })
        const snapshot = queryClient.getQueriesData({ queryKey: orpcQuery.chunks.listChunks.key() })
        queryClient.setQueriesData<{ pages: Array<{ rows: Array<{ id: string }>; nextCursor: string | null }> }>(
          { queryKey: orpcQuery.chunks.listChunks.key() },
          (old) => {
            if (!old) return old
            return {
              ...old,
              pages: old.pages.map((page) => ({
                ...page,
                rows: page.rows.filter((row) => row.id !== id),
              })),
            }
          }
        )
        return { snapshot }
      },
      onError: (_err, _vars, context) => {
        if (!context) return
        for (const [key, value] of context.snapshot) {
          queryClient.setQueryData(key, value)
        }
      },
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: orpcQuery.chunks.listChunks.key() })
        void queryClient.invalidateQueries({ queryKey: orpcQuery.practice.dueSummary.key() })
      },
      meta: {
        errorMessage: t`Failed to delete term`,
        showErrorModal: true,
      },
    })
  )
}
