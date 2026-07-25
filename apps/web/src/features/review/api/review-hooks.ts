import { orpcQuery } from '@/lib/transport/orpc-client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'
import type { Card } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { difficultyInvalidates, practiceSummaryKeys } from '@/features/practice/api/practice-hooks'
import { patchTermInComposedSession } from '@/features/practice/components/composed-session-snapshot'
import { patchTermInExerciseSession } from '@/features/practice/components/exercise-session-snapshot'
import {
  cancelCardCaches,
  cancelCardCachesOptionalSession,
  getCardDetailKey,
  getSessionCardsKey,
  restoreCardCaches,
  restoreCardCachesOptionalSession,
  reviewCardCacheStaleTimeMs,
  setCardEverywhere,
  setCardStatusEverywhere,
  setCardUnreadEverywhere,
  snapshotCardCaches,
  snapshotCardCachesOptionalSession,
  type CardCacheSnapshot,
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

// Remove (unkeep) a card from its session vocabulary list. Optimistically flips
// the card's status to `removed` so the row drops out of the list immediately
// (the list filters to kept | needs_data). Non-destructive on the server: it
// decrements the lookup count only if the card was kept and never soft-deletes
// the term.
export const useRemoveCardFromSession = (sessionId: string) => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.cards.removeFromSession.mutationOptions({
      onMutate: async (variables: { cardId: string }) => {
        await cancelCardCaches(queryClient, { sessionId, cardId: variables.cardId })
        const snapshot = snapshotCardCaches(queryClient, { sessionId, cardId: variables.cardId })
        setCardStatusEverywhere(queryClient, { sessionId, cardId: variables.cardId, status: 'removed' })
        return snapshot
      },
      onError: (_error, _variables, context) => {
        restoreCardCaches(queryClient, context as CardCacheSnapshot | undefined)
      },
      onSuccess: (response) => {
        setCardEverywhere(queryClient, response.data)
        // Removing a kept card changes downstream counts; invalidate vocabulary
        // list + practice due summary so chips and counts refresh.
        queryClient.invalidateQueries({ queryKey: orpcQuery.chunks.listChunks.key() })
        for (const key of [...practiceSummaryKeys(), ...difficultyInvalidates()]) {
          queryClient.invalidateQueries({ queryKey: key })
        }
      },
      meta: { errorMessage: t`Failed to remove term` },
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
  return useMutation(
    orpcQuery.cardChat.sendMessage.mutationOptions({
      meta: {
        // The chat handler may have called update_card_fields server-side,
        // so the card data on disk may have shifted — refetch the card caches
        // (the session list only when there is a session scope).
        invalidates: [
          orpcQuery.cardChat.listForCard.key({ input: { cardId } }),
          getCardDetailKey(cardId),
          ...(sessionId ? [getSessionCardsKey(sessionId)] : []),
        ],
        errorMessage: t`Failed to send chat message`,
      },
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

// Full single-chunk fetch (the flashcard actions menu's data source — the
// lean ReviewTerm queue payload lacks learningMode/etc.). `firstCardId` /
// `firstCardSessionId` are the representative-card pointer for the "Edit
// term" focus-view deep link.
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
  return useMutation(
    orpcQuery.chunks.updateContent.mutationOptions({
      // An interrupted practice session stashed for resume (composed or
      // strengthen/warm-up) embeds copies of the term — patch them so the
      // edit is visible the moment the session resumes.
      onSuccess: ({ data }) => {
        patchTermInComposedSession(data)
        patchTermInExerciseSession(data)
      },
      meta: {
        invalidates: [
          ...(sessionId ? [getSessionCardsKey(sessionId)] : []),
          orpcQuery.cards.get.key(),
          orpcQuery.chunks.get.key(),
          orpcQuery.chunks.listChunks.key(),
        ],
        errorMessage: t`Failed to update term`,
      },
    })
  )
}

// Rename the (headword, sense) pair on the canonical chunk. Surfaces a 409
// CONFLICT when the user already has a chunk with the target pair — the
// caller decides how to display that. Difficulty invalidates because the
// coverage blend and the mark-known sweep exclusion key saved vocabulary by
// folded headword — a rename changes which lemmas the term covers.
export const useRenameChunk = (sessionId?: string) => {
  const { t } = useLingui()
  return useMutation(
    orpcQuery.chunks.rename.mutationOptions({
      // Same stashed-session patch as useUpdateChunkContent — a rename changes
      // the headword every stashed card/exercise of the term displays.
      onSuccess: ({ data }) => {
        patchTermInComposedSession(data)
        patchTermInExerciseSession(data)
      },
      meta: {
        invalidates: [
          ...(sessionId ? [getSessionCardsKey(sessionId)] : []),
          orpcQuery.cards.get.key(),
          orpcQuery.chunks.get.key(),
          orpcQuery.chunks.listChunks.key(),
          ...difficultyInvalidates(),
        ],
        errorMessage: t`Failed to rename term`,
      },
    })
  )
}
