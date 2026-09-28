import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'
import type { VocabChatMessage } from '@flicktionary/api-client/orpc-contracts/vocab-chat-contract'
import { orpcQuery } from '@/lib/transport/orpc-client'
import { difficultyInvalidates, practiceSummaryKeys } from '@/features/practice/api/practice-hooks'

type CaptureCard = { cardId: string; sessionId: string }

const translateQueryKey = (text: string, targetLanguage: string) =>
  orpcQuery.vocabChat.translate.queryKey({ input: { text, targetLanguage } })

// Fast lane of "Translate & add", keyed by the search in the URL: results are
// an LLM answer to a fixed question, so they never go stale on their own, and
// coming back from editing a card (browser back) restores them from the cache
// instead of re-asking. Errors render inline in the view.
export const useTranslateForCapture = (text: string | null, targetLanguage: string | null) =>
  useQuery(
    orpcQuery.vocabChat.translate.queryOptions({
      input: { text: text ?? '', targetLanguage: targetLanguage ?? '' },
      enabled: !!text && !!targetLanguage,
      select: (response) => response.data,
      staleTime: Infinity,
      gcTime: 30 * 60 * 1000,
      retry: false,
      meta: { showErrorToast: false },
    })
  )

// After Add, the candidate points at its new card, so the row (and the
// restored results after a detour into the card) offer Edit instead of Add.
export const useMarkCandidateAdded = () => {
  const queryClient = useQueryClient()
  return (params: { text: string; targetLanguage: string; headword: string; card: CaptureCard }) =>
    queryClient.setQueryData<{
      data: { inputLanguage: string | null; candidates: Array<{ headword: string; existingCard: CaptureCard | null }> }
    }>(
      translateQueryKey(params.text, params.targetLanguage),
      (old) =>
        old && {
          ...old,
          data: {
            ...old.data,
            candidates: old.data.candidates.map((c) =>
              c.headword === params.headword ? { ...c, existingCard: params.card } : c
            ),
          },
        }
    )
}

export const useVocabChatThread = (sessionId: string) => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.vocabChat.getThread.queryOptions({
      input: { sessionId },
      select: (response) => response.data,
      meta: { errorMessage: t`Failed to load chat` },
    })
  )
}

// Starting a thread creates a session, so the Sessions list refreshes.
export const useStartVocabChat = () =>
  useMutation(
    orpcQuery.vocabChat.start.mutationOptions({
      meta: { invalidates: [orpcQuery.studySessions.list.key()], showErrorToast: false },
    })
  )

type ThreadCache = { data: { title: string; messages: VocabChatMessage[] } }

// A turn may add cards (the model's add_proposed_cards) and rename the thread,
// so both the thread and everything that lists vocabulary refresh.
export const useSendVocabChatMessage = (sessionId: string) =>
  useMutation(
    orpcQuery.vocabChat.sendMessage.mutationOptions({
      meta: {
        invalidates: [
          orpcQuery.vocabChat.getThread.key({ input: { sessionId } }),
          orpcQuery.studySessions.list.key(),
          orpcQuery.chunks.listChunks.key(),
        ],
        showErrorToast: false,
      },
    })
  )

// The checklist's Add. The response carries the updated message, written into
// the thread cache so the rows flip to "Added" without waiting for a refetch.
export const useAddProposedItems = (sessionId: string) => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.vocabChat.addProposedItems.mutationOptions({
      meta: {
        invalidates: [
          orpcQuery.vocabChat.getThread.key({ input: { sessionId } }),
          orpcQuery.chunks.listChunks.key(),
          orpcQuery.chunks.listLanguages.key(),
          ...practiceSummaryKeys(),
          ...difficultyInvalidates(),
        ],
        errorMessage: t`Failed to add cards`,
      },
      onSuccess: (response) => {
        const updated = response.data.message
        queryClient.setQueryData<ThreadCache>(
          orpcQuery.vocabChat.getThread.queryKey({ input: { sessionId } }),
          (old) =>
            old && {
              ...old,
              data: { ...old.data, messages: old.data.messages.map((m) => (m.id === updated.id ? updated : m)) },
            }
        )
      },
    })
  )
}
