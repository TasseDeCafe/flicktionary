import { orpcQuery } from '@/lib/transport/orpc-client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'
import type {
  Card,
  CardStatus,
  LearningMode,
} from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import {
  cancelCardCaches,
  cancelCardCachesOptionalSession,
  getCardDetailKey,
  getSessionCardsKey,
  invalidateCardEverywhere,
  restoreCardCaches,
  restoreCardCachesOptionalSession,
  restoreSessionCardsCache,
  reviewCardCacheStaleTimeMs,
  setCardEverywhere,
  setCardStatusBatchEverywhere,
  setCardStatusEverywhere,
  setCardUnreadEverywhere,
  snapshotCardCaches,
  snapshotCardCachesOptionalSession,
  snapshotSessionCardsCache,
  type CardCacheSnapshot,
  type CardListSnapshot,
  type OptionalSessionCardSnapshot,
} from './card-cache'

export const useListCardsBySession = (
  sessionId: string,
  options?: { enabled?: boolean; refetchInterval?: number | false }
) => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.cards.listBySession.queryOptions({
      input: { sessionId },
      enabled: options?.enabled ?? true,
      ...(options?.refetchInterval !== undefined ? { refetchInterval: options.refetchInterval } : {}),
      select: (response) => response.data,
      meta: { errorMessage: t`Failed to load cards` },
    })
  )
}

export const useGetCard = (cardId: string, initialCard?: Card, initialCardUpdatedAt?: number) => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.cards.get.queryOptions({
      input: { cardId },
      staleTime: reviewCardCacheStaleTimeMs,
      ...(initialCard
        ? {
            initialData: { data: initialCard },
            initialDataUpdatedAt: initialCardUpdatedAt,
          }
        : {}),
      select: (response) => response.data,
      meta: { errorMessage: t`Failed to load card` },
    })
  )
}

export const useUpdateCardStatus = (sessionId: string) => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.cards.updateStatus.mutationOptions({
      onMutate: async (variables: { cardId: string; status: CardStatus; learningMode?: LearningMode }) => {
        await cancelCardCaches(queryClient, { sessionId, cardId: variables.cardId })
        const snapshot = snapshotCardCaches(queryClient, { sessionId, cardId: variables.cardId })
        setCardStatusEverywhere(queryClient, { sessionId, cardId: variables.cardId, status: variables.status })
        return snapshot
      },
      onError: (_error, _variables, context) => {
        restoreCardCaches(queryClient, context as CardCacheSnapshot | undefined)
      },
      onSuccess: (response) => {
        setCardEverywhere(queryClient, response.data)
        // Term's learning_mode may have shifted (e.g. promoted to active on
        // keep). Invalidate vocabulary list + practice due summary so chips
        // and counts refresh.
        queryClient.invalidateQueries({ queryKey: orpcQuery.chunks.listChunks.key() })
        queryClient.invalidateQueries({ queryKey: orpcQuery.practice.dueSummary.key() })
      },
      meta: { errorMessage: t`Failed to update card status` },
    })
  )
}

export const useUpdateCardStatusBatch = (sessionId: string) => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.cards.updateStatusBatch.mutationOptions({
      onMutate: async (variables: { sessionId: string; cardIds: string[]; status: CardStatus }) => {
        await queryClient.cancelQueries({ queryKey: getSessionCardsKey(sessionId) })
        const snapshot = snapshotSessionCardsCache(queryClient, sessionId)
        setCardStatusBatchEverywhere(queryClient, {
          sessionId,
          cardIds: variables.cardIds,
          status: variables.status,
        })
        return snapshot
      },
      onError: (_error, _variables, context) => {
        restoreSessionCardsCache(queryClient, context as CardListSnapshot | undefined)
      },
      onSuccess: (response) => {
        for (const card of response.data) {
          setCardEverywhere(queryClient, card)
        }
      },
      meta: { errorMessage: t`Failed to update card statuses` },
    })
  )
}

export const useListChatForCard = (cardId: string) => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.cardChat.listForCard.queryOptions({
      input: { cardId },
      select: (response) => response.data,
      meta: { errorMessage: t`Failed to load chat` },
    })
  )
}

export const useSendChatMessage = (cardId: string, sessionId?: string) => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.cardChat.sendMessage.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: orpcQuery.cardChat.listForCard.key({ input: { cardId } }),
        })
        if (sessionId) {
          // The chat handler may have called update_card_fields server-side,
          // so the card data on disk may have shifted — refetch both card caches.
          invalidateCardEverywhere(queryClient, { sessionId, cardId })
          return
        }

        queryClient.invalidateQueries({ queryKey: getCardDetailKey(cardId) })
      },
      meta: { errorMessage: t`Failed to send chat message` },
    })
  )
}

// Mark a card's chat read. Optimistically clears hasUnreadChat in whatever
// caches exist, then rolls back on failure so a failed PATCH doesn't leave the
// dot clear locally while a reload / another device still shows unread. No
// onSuccess invalidation needed: server truth (last_read_at = NOW()) matches
// the optimistic value.
export const useMarkChatRead = (cardId: string, sessionId?: string) => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.cardChat.markRead.mutationOptions({
      onMutate: async () => {
        await cancelCardCachesOptionalSession(queryClient, { sessionId, cardId })
        const snapshot = snapshotCardCachesOptionalSession(queryClient, { sessionId, cardId })
        setCardUnreadEverywhere(queryClient, { sessionId, cardId, hasUnreadChat: false })
        return snapshot
      },
      onError: (_error, _variables, context) => {
        restoreCardCachesOptionalSession(queryClient, context as OptionalSessionCardSnapshot | undefined)
      },
      meta: { errorMessage: t`Failed to mark chat read` },
    })
  )
}

export const useExploreCard = () => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.cards.explore.mutationOptions({
      onSuccess: (response) => {
        setCardEverywhere(queryClient, response.data)
      },
      meta: { errorMessage: t`Failed to generate exploration` },
    })
  )
}

export const useTextSegmentsWindow = (input: { textTrackId: string; segmentId: string; radius: number } | null) => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.textSegments.getWindow.queryOptions({
      input: input ?? { textTrackId: '', segmentId: '', radius: 0 },
      enabled: !!input && !!input.textTrackId && !!input.segmentId,
      select: (response) => response,
      meta: { errorMessage: t`Failed to load surrounding context` },
    })
  )
}

// Full single-chunk fetch (the practice edit sheet's data source — the lean
// ReviewTerm queue payload lacks explorationExtras/learningMode/etc.).
// `surfaceForm` is the first encounter's card form resolved server-side, so
// the sheet's "study this exact form" toggle matches the focus view.
export const useGetChunk = (chunkId: string, enabled: boolean) => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.chunks.get.queryOptions({
      input: { chunkId },
      enabled,
      select: (response) => response.data,
      meta: { errorMessage: t`Failed to load term` },
    })
  )
}

// Patch translation/definition/examples/extras on the canonical chunk
// (user_lookups). After success, invalidate the cards caches so any sibling
// card showing the same chunk picks up the new content via re-fetch. We don't
// have surgical-update access to embedded chunks across all card caches, so
// invalidation is the simplest correct path.
export const useUpdateChunkContent = (sessionId?: string) => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.chunks.updateContent.mutationOptions({
      onSuccess: () => {
        if (sessionId) {
          queryClient.invalidateQueries({ queryKey: getSessionCardsKey(sessionId) })
        }
        queryClient.invalidateQueries({ queryKey: orpcQuery.cards.get.key() })
        queryClient.invalidateQueries({ queryKey: orpcQuery.chunks.get.key() })
        queryClient.invalidateQueries({ queryKey: orpcQuery.chunks.listChunks.key() })
      },
      meta: { errorMessage: t`Failed to update term` },
    })
  )
}

// Rename the (headword, sense) pair on the canonical chunk. Surfaces a 409
// CONFLICT when the user already has a chunk with the target pair — the
// caller decides how to display that.
export const useRenameChunk = (sessionId?: string) => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.chunks.rename.mutationOptions({
      onSuccess: () => {
        if (sessionId) {
          queryClient.invalidateQueries({ queryKey: getSessionCardsKey(sessionId) })
        }
        queryClient.invalidateQueries({ queryKey: orpcQuery.cards.get.key() })
        queryClient.invalidateQueries({ queryKey: orpcQuery.chunks.get.key() })
        queryClient.invalidateQueries({ queryKey: orpcQuery.chunks.listChunks.key() })
      },
      meta: { errorMessage: t`Failed to rename term` },
    })
  )
}
