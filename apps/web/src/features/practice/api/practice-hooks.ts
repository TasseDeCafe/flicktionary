import { orpcQuery } from '@/lib/transport/orpc-client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'
import type { PracticeSessionProgress } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'

type GetSessionCache = {
  data: {
    session: unknown
    currentText: unknown
    progress: PracticeSessionProgress
  }
}

export const useDueSummary = () => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.practice.dueSummary.queryOptions({
      input: {},
      select: (response) => response.data.perLanguage,
      meta: { errorMessage: t`Failed to load practice summary` },
    })
  )
}

export const useStartPracticeSession = () => {
  const { t } = useLingui()
  // Per Problem 2: don't seed the getSession cache. With resume, the seed
  // would suppress the resumed text long enough for the auto-trigger to fire
  // generateNextText and burn another LLM call. Cost: one extra fetch on
  // first entry into the session view.
  return useMutation(
    orpcQuery.practice.startSession.mutationOptions({
      meta: {
        errorMessage: t`Failed to start practice session`,
        showErrorModal: true,
      },
    })
  )
}

export const useAbandonPracticeSession = () => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.practice.abandonSession.mutationOptions({
      onSuccess: (_response, variables) => {
        queryClient.invalidateQueries({ queryKey: orpcQuery.practice.dueSummary.key() })
        queryClient.invalidateQueries({
          queryKey: orpcQuery.practice.getSession.queryKey({ input: { sessionId: variables.sessionId } }),
        })
      },
      meta: {
        errorMessage: t`Failed to end practice session`,
        showErrorModal: true,
      },
    })
  )
}

export const useGetPracticeSession = (sessionId: string) => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.practice.getSession.queryOptions({
      input: { sessionId },
      select: (response) => response.data,
      meta: { errorMessage: t`Failed to load practice session` },
    })
  )
}

export const useGenerateNextPracticeText = (sessionId: string) => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.practice.generateNextText.mutationOptions({
      onSuccess: (response) => {
        // Write the new text (or null when done) directly into the getSession
        // cache so the UI updates without a round-trip refetch. Doing this via
        // setQueryData (instead of invalidate) avoids a window where the cache
        // is "null currentText" but the new text already exists server-side —
        // that's what caused the stale-flash on Next.
        queryClient.setQueryData<GetSessionCache>(
          orpcQuery.practice.getSession.queryKey({ input: { sessionId } }),
          (old) => {
            if (!old) return old
            const nextCurrentText = response.data.done ? null : response.data.practiceText
            return {
              ...old,
              data: { ...old.data, currentText: nextCurrentText, progress: response.data.progress },
            }
          }
        )
      },
      meta: { errorMessage: t`Failed to generate next text` },
    })
  )
}

// Fire-and-forget pre-generation. Eagerly kicks off the LLM call for the
// next slot as soon as the current text loads so handleNext can hand back a
// cached 'ready' row instantly.
export const usePrepareNextPracticeText = () => {
  return useMutation(
    orpcQuery.practice.prepareNextText.mutationOptions({
      // No meta.errorMessage: failures here are non-fatal (foreground will
      // generate fresh on Next), and we don't want to surface modal toasts
      // for a background eagerness optimisation.
      meta: { showErrorToast: false },
    })
  )
}

export const useRatePracticeChunk = (sessionId: string) => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.practice.rateChunk.mutationOptions({
      onSuccess: (response) => {
        queryClient.setQueryData<GetSessionCache>(
          orpcQuery.practice.getSession.queryKey({ input: { sessionId } }),
          (old) => {
            if (!old) return old
            return { ...old, data: { ...old.data, progress: response.data.progress } }
          }
        )
      },
      meta: { errorMessage: t`Failed to record rating` },
    })
  )
}

// Soft-delete from inside a practice text. Differs from the Vocabulary tab's
// useDeleteChunk: the user is mid-reading and we want the practice text's
// annotation to flip to the "deleted" state immediately. We invalidate
// `getSession` so the next render shows the new `deletedAt`, but skip the
// vocab-list optimistic patching since the vocab list isn't mounted here.
export const useDeleteChunkFromPractice = (sessionId: string) => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.chunks.deleteChunk.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: orpcQuery.practice.getSession.queryKey({ input: { sessionId } }),
        })
        void queryClient.invalidateQueries({ queryKey: orpcQuery.chunks.listChunks.key() })
        void queryClient.invalidateQueries({ queryKey: orpcQuery.practice.dueSummary.key() })
      },
      meta: { errorMessage: t`Failed to delete term` },
    })
  )
}

// Counterpart to useDeleteChunkFromPractice. Calls chunks.restoreChunk which
// clears deleted_at without touching count/status — the chunk resumes
// participating in SRS with its existing schedule. Same invalidations as
// delete so the practice text's annotation flips back.
export const useRestoreChunkFromPractice = (sessionId: string) => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.chunks.restoreChunk.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: orpcQuery.practice.getSession.queryKey({ input: { sessionId } }),
        })
        void queryClient.invalidateQueries({ queryKey: orpcQuery.chunks.listChunks.key() })
        void queryClient.invalidateQueries({ queryKey: orpcQuery.practice.dueSummary.key() })
      },
      meta: { errorMessage: t`Failed to restore term` },
    })
  )
}

// Selection-driven gloss for a span in the practice text. No server-side
// cache — TanStack Query handles re-selection of the same span within the
// session via its in-memory cache.
export const usePracticeFastGloss = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.practice.fastGloss.mutationOptions({
      meta: { errorMessage: t`Failed to fetch translation` },
    })
  )
}

export const useFinalizePracticeText = (sessionId: string) => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.practice.finalizeText.mutationOptions({
      onSuccess: (response) => {
        // Optimistically null out currentText so the UI doesn't keep showing
        // the just-finalized text while we wait for the next generate. The
        // finalize response carries authoritative progress; the generate
        // step then writes the new text in via setQueryData.
        queryClient.setQueryData<GetSessionCache>(
          orpcQuery.practice.getSession.queryKey({ input: { sessionId } }),
          (old) => {
            if (!old) return old
            return { ...old, data: { ...old.data, currentText: null, progress: response.data.progress } }
          }
        )
        queryClient.invalidateQueries({ queryKey: orpcQuery.practice.dueSummary.key() })
      },
      meta: { errorMessage: t`Failed to finalize text` },
    })
  )
}
