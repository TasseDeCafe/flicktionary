import { orpcQuery } from '@/lib/transport/orpc-client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'

type GetSessionCache = {
  data: {
    session: unknown
    currentText: unknown
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
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.practice.startSession.mutationOptions({
      onSuccess: (response, variables) => {
        // Seed the getSession cache so the session view doesn't pay a redundant
        // round-trip after navigation — we just created the session, we know
        // currentText is null, and the auto-trigger effect can fire immediately.
        const sessionId = response.data.sessionId
        queryClient.setQueryData<GetSessionCache>(orpcQuery.practice.getSession.queryKey({ input: { sessionId } }), {
          data: {
            session: {
              id: sessionId,
              userId: '',
              targetLanguage: variables.targetLanguage,
              status: 'active',
              startedAt: new Date().toISOString(),
              endedAt: null,
            },
            currentText: null,
          },
        })
      },
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
              data: { ...old.data, currentText: nextCurrentText },
            }
          }
        )
      },
      meta: { errorMessage: t`Failed to generate next text` },
    })
  )
}

export const useRatePracticeChunk = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.practice.rateChunk.mutationOptions({
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
