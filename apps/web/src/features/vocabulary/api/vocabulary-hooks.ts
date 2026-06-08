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

// Enable or disable one study facet (skill x target_form) on a term. This is the
// unified study-target write path that replaced the old passive/active toggle:
// enabling the citation meaning_production facet is what "promote to active"
// used to be (disable = demote), and the wire still derives `learningMode` from
// that facet's enabled state. For the production-citation case we optimistically
// flip every in-flight chunks page so vocab chips update instantly; other facets
// (recognition, forms) have no list-visible flag yet, so we just invalidate.
export const useSetFacetEnabled = () => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.chunks.setFacetEnabled.mutationOptions({
      onMutate: async ({ chunkId, skill, targetForm, enabled }) => {
        const isProductionCitation = skill === 'meaning_production' && (targetForm ?? '') === ''
        if (!isProductionCitation) return { snapshot: undefined }
        await queryClient.cancelQueries({ queryKey: orpcQuery.chunks.listChunks.key() })
        const snapshot = queryClient.getQueriesData({ queryKey: orpcQuery.chunks.listChunks.key() })
        const learningMode: LearningMode = enabled ? 'active' : 'passive'
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
        if (!context?.snapshot) return
        for (const [key, value] of context.snapshot) {
          queryClient.setQueryData(key, value)
        }
      },
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: orpcQuery.chunks.listChunks.key() })
        void queryClient.invalidateQueries({ queryKey: orpcQuery.practice.dueSummary.key() })
        void queryClient.invalidateQueries({ queryKey: orpcQuery.cards.get.key() })
        void queryClient.invalidateQueries({ queryKey: orpcQuery.cards.listBySession.key() })
        // The Study-targets control reads facet membership from getStudyTargets;
        // refetch it so the just-toggled chip reflects the server state (the
        // pronunciation enable can also self-heal to "off" server-side when the
        // term has no IPA).
        void queryClient.invalidateQueries({ queryKey: orpcQuery.chunks.getStudyTargets.key() })
      },
      meta: {
        errorMessage: t`Failed to update study targets`,
        showErrorModal: true,
      },
    })
  )
}

// Read one term's study facets for the Study-targets control. Lazily fetched
// when the term view renders (kept off the chunk DTO so the vocab list stays
// lean). Returns the facet summary array; the control derives chip membership
// (e.g. is the citation pronunciation facet enabled) from it.
export const useStudyTargets = (chunkId: string | null) => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.chunks.getStudyTargets.queryOptions({
      enabled: Boolean(chunkId),
      input: { chunkId: chunkId ?? '' },
      select: (response) => response.data.facets,
      meta: { errorMessage: t`Failed to load study targets` },
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
