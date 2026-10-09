import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'
import type { VocabChatMessage } from '@flicktionary/api-client/orpc-contracts/vocab-chat-contract'
import { orpcQuery } from '@/lib/transport/orpc-client'
import { difficultyInvalidates, practiceSummaryKeys } from '@/features/practice/api/practice-hooks'

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

// Asks which candidates the learner already has: a search's (see
// useTranslateForCapture) or a chat proposal's.
export type CaptureMatchesRequest = {
  targetLanguage: string
  context: { kind: 'search'; text: string; inputLanguage: string | null } | { kind: 'chat'; userMessage: string }
  candidates: Array<{ headword: string; note: string; example: string; userLookupId?: string }>
}

// Which candidates the learner already has, by meaning, with each one's
// practice status. Unlike the cached LLM answers this follows the
// vocabulary: it's asked again whenever the rows mount (coming back from a
// card, another surface's add or delete) and after every change made from a
// row. One match per candidate, in order. `keepPrevious` holds the last
// answer while a changed request loads, for a list whose candidates stay put
// (a chat proposal whose item just resolved to its term).
export const useCaptureMatches = (request: CaptureMatchesRequest | null, { keepPrevious = false } = {}) =>
  useQuery(
    orpcQuery.vocabChat.captureMatches.queryOptions({
      input: request ?? {
        targetLanguage: '',
        context: { kind: 'chat', userMessage: '' },
        candidates: [],
      },
      enabled: !!request && request.candidates.length > 0,
      select: (response) => response.data.matches,
      placeholderData: keepPrevious ? keepPreviousData : undefined,
      retry: false,
      // Rows fall back to Add, which dedups on save.
      meta: { showErrorToast: false },
    })
  )

// What a capture search changes in practice (demand, boosts, added cards)
// shows on its rows and in the practice counts.
const captureChangeInvalidates = () => [
  orpcQuery.vocabChat.captureMatches.key(),
  orpcQuery.chunks.listChunks.key(),
  ...practiceSummaryKeys(),
]

// Demand for a saved, never-started term (the top result, an opened card, or
// Move up). Fired without the learner's tap for the top result, so failures
// stay silent; the row keeps showing the server's status.
export const useRecordCaptureDemand = () =>
  useMutation(
    orpcQuery.vocabChat.recordCaptureDemand.mutationOptions({
      meta: { invalidates: captureChangeInvalidates(), showErrorToast: false },
    })
  )

export const useUndoCaptureDemand = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.vocabChat.undoCaptureDemand.mutationOptions({
      meta: { invalidates: captureChangeInvalidates(), errorMessage: t`Failed to undo` },
    })
  )
}

// "Review tomorrow" and its undo. A refused boost (already due by tomorrow)
// just re-reads the row's status.
export const useBoostFacet = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.practice.boostFacet.mutationOptions({
      meta: { invalidates: captureChangeInvalidates(), errorMessage: t`Failed to move the review` },
    })
  )
}

export const useUnboostFacet = () => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.practice.unboostFacet.mutationOptions({
      meta: { invalidates: captureChangeInvalidates(), errorMessage: t`Failed to undo` },
    })
  )
}

// Polls while an added proposal item is still being enriched, so its row
// turns into the card (or a retry) on its own.
export const useVocabChatThread = (sessionId: string) => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.vocabChat.getThread.queryOptions({
      input: { sessionId },
      select: (response) => response.data,
      refetchInterval: (query) =>
        query.state.data?.data.messages.some((m) => m.proposal?.items.some((item) => item.addState === 'pending'))
          ? 2500
          : false,
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
// into the thread cache so the row flips to its pending state without waiting
// for a refetch. Rows add independently: add states are merged rather than
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
          items: updated.proposal.items.map((item, i) => {
            const previous = cached.proposal?.items[i]
            return item.addState === null && previous?.addState ? previous : item
          }),
        },
      }
    : updated

// Retries a proposal item whose enrichment failed (the session's own retry).
export const useRetryProposalItem = (sessionId: string) => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.studySessions.retryEnrichment.mutationOptions({
      meta: {
        invalidates: [
          orpcQuery.vocabChat.getThread.key({ input: { sessionId } }),
          orpcQuery.studySessions.getProcessingStatus.key({ input: { sessionId } }),
        ],
        errorMessage: t`Failed to retry`,
      },
    })
  )
}
