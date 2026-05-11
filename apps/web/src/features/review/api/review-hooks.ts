import { orpcQuery } from '@/lib/transport/orpc-client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'
import type { Card, CardStatus } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import {
  cancelCardCaches,
  getCardDetailKey,
  getSessionCardsKey,
  invalidateCardEverywhere,
  restoreCardCaches,
  restoreSessionCardsCache,
  reviewCardCacheStaleTimeMs,
  setCardEverywhere,
  setCardStatusBatchEverywhere,
  setCardStatusEverywhere,
  snapshotCardCaches,
  snapshotSessionCardsCache,
  type CardCacheSnapshot,
  type CardListSnapshot,
} from './card-cache'

export const useListCardsBySession = (sessionId: string, options?: { enabled?: boolean }) => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.cards.listBySession.queryOptions({
      input: { sessionId },
      enabled: options?.enabled ?? true,
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
      onMutate: async (variables: { cardId: string; status: CardStatus }) => {
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

export const useUpdateCardFields = () => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.cards.updateFields.mutationOptions({
      onSuccess: (response) => {
        setCardEverywhere(queryClient, response.data)
      },
      meta: { errorMessage: t`Failed to update card fields` },
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
        queryClient.invalidateQueries({ queryKey: orpcQuery.chunks.listChunks.key() })
      },
      meta: { errorMessage: t`Failed to rename term` },
    })
  )
}

export const useExportSessionCsv = () => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.cards.exportCsv.mutationOptions({
      onSuccess: (_response, variables) => {
        queryClient.invalidateQueries({
          queryKey: orpcQuery.studySessions.get.key({ input: { sessionId: variables.sessionId } }),
        })
        queryClient.invalidateQueries({
          queryKey: orpcQuery.studySessions.list.key(),
        })
        queryClient.invalidateQueries({
          queryKey: getSessionCardsKey(variables.sessionId),
        })
      },
      meta: { errorMessage: t`Failed to export CSV` },
    })
  )
}
