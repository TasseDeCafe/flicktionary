import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'
import type { VocabChatMessage } from '@flicktionary/api-client/orpc-contracts/vocab-chat-contract'
import { orpcQuery } from '@/lib/transport/orpc-client'
import { difficultyInvalidates, practiceSummaryKeys } from '@/features/practice/api/practice-hooks'

type CaptureCard = { cardId: string; sessionId: string }

// A "Translate & add" search: the query, its target language, and the
// optional context the learner met the term in.
export type CaptureSearch = { text: string; targetLanguage: string; context: string | null }

const translateInput = ({ text, targetLanguage, context }: CaptureSearch) => ({
  text,
  targetLanguage,
  ...(context ? { context } : {}),
})

// Fast lane of "Translate & add", keyed by the search in the URL: results are
// an LLM answer to a fixed question, so they never go stale on their own, and
// coming back from editing a card (browser back) or from the chat restores
// them from the cache instead of re-asking. Errors render inline in the view.
export const useTranslateForCapture = (search: CaptureSearch | null) =>
  useQuery(
    orpcQuery.vocabChat.translate.queryOptions({
      input: translateInput(search ?? { text: '', targetLanguage: '', context: null }),
      enabled: !!search?.text && !!search.targetLanguage,
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
  return (params: { search: CaptureSearch; headword: string; card: CaptureCard }) =>
    queryClient.setQueryData<{
      data: { inputLanguage: string | null; candidates: Array<{ headword: string; existingCard: CaptureCard | null }> }
    }>(
      orpcQuery.vocabChat.translate.queryKey({ input: translateInput(params.search) }),
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

// Starting a thread creates a session, so the Sessions list refreshes; its
// first turn may already add cards (the model's add_proposed_cards).
export const useStartVocabChat = () =>
  useMutation(
    orpcQuery.vocabChat.start.mutationOptions({
      meta: {
        invalidates: [orpcQuery.studySessions.list.key(), orpcQuery.chunks.listChunks.key()],
        showErrorToast: false,
      },
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

// A proposal row's Add. The response carries the updated message, written
// into the thread cache so the row flips to "Added" without waiting for a
// refetch. Rows add independently: `added` flags are merged rather than
// replaced, so a response that overtakes a later one can't un-add a row.
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
              data: {
                ...old.data,
                messages: old.data.messages.map((m) => (m.id === updated.id ? mergeAddedFlags(m, updated) : m)),
              },
            }
        )
      },
    })
  )
}

const mergeAddedFlags = (cached: VocabChatMessage, updated: VocabChatMessage): VocabChatMessage =>
  updated.proposal && cached.proposal
    ? {
        ...updated,
        proposal: {
          items: updated.proposal.items.map((item, i) => ({
            ...item,
            added: item.added || (cached.proposal?.items[i]?.added ?? false),
          })),
        },
      }
    : updated
