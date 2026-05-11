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

export const useFinalizePracticeText = (sessionId: string) => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.practice.finalizeText.mutationOptions({
      onSuccess: () => {
        // Optimistically null out currentText so the UI doesn't keep showing
        // the just-finalized text while we wait for the next generate. The
        // generate step then writes the new text in via setQueryData.
        queryClient.setQueryData<GetSessionCache>(
          orpcQuery.practice.getSession.queryKey({ input: { sessionId } }),
          (old) => {
            if (!old) return old
            return { ...old, data: { ...old.data, currentText: null } }
          }
        )
        queryClient.invalidateQueries({ queryKey: orpcQuery.practice.dueSummary.key() })
      },
      meta: { errorMessage: t`Failed to finalize text` },
    })
  )
}
