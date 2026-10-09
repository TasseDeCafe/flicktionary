import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'
import type { CaptureCandidate, VocabChatMessage } from '@flicktionary/api-client/orpc-contracts/vocab-chat-contract'
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

// Which candidates the learner already has, by meaning. Unlike the cached
// translate answer this follows the vocabulary: it's asked again whenever the
// results mount (coming back from a card, another surface's add or delete)
// and after every add. One match per candidate, in order, plus the card the
// search tested.
export const useCaptureMatches = (
  search: CaptureSearch | null,
  translation: { inputLanguage: string | null; candidates: CaptureCandidate[] } | undefined
) =>
  useQuery(
    orpcQuery.vocabChat.captureMatches.queryOptions({
      input: {
        targetLanguage: search?.targetLanguage ?? '',
        text: search?.text ?? '',
        inputLanguage: translation?.inputLanguage ?? null,
        candidates: (translation?.candidates ?? []).map(({ headword, note, example }) => ({ headword, note, example })),
      },
      enabled: !!search && !!translation && translation.candidates.length > 0,
      select: (response) => response.data,
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
