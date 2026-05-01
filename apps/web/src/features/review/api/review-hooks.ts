import { orpcQuery } from '@/lib/transport/orpc-client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'
import type { CardStatus } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'

export const useListCardsBySession = (sessionId: string) => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.cards.listBySession.queryOptions({
      input: { sessionId },
      select: (response) => response.data,
      meta: { errorMessage: t`Failed to load cards` },
    })
  )
}

export const useGetCard = (cardId: string) => {
  const { t } = useLingui()
  return useQuery(
    orpcQuery.cards.get.queryOptions({
      input: { cardId },
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
        const listKey = orpcQuery.cards.listBySession.key({ input: { sessionId } })
        const cardKey = orpcQuery.cards.get.key({ input: { cardId: variables.cardId } })
        await Promise.all([
          queryClient.cancelQueries({ queryKey: listKey }),
          queryClient.cancelQueries({ queryKey: cardKey }),
        ])
        const previousList = queryClient.getQueryData(listKey)
        const previousCard = queryClient.getQueryData(cardKey)
        queryClient.setQueriesData({ queryKey: listKey }, (data: unknown) => {
          if (!data || typeof data !== 'object') return data
          const cast = data as { data: Array<{ id: string; status: string }> }
          return {
            ...cast,
            data: cast.data.map((c) => (c.id === variables.cardId ? { ...c, status: variables.status } : c)),
          }
        })
        queryClient.setQueriesData({ queryKey: cardKey }, (data: unknown) => {
          if (!data || typeof data !== 'object') return data
          const cast = data as { data: { id: string; status: string } }
          if (!cast.data || cast.data.id !== variables.cardId) return data
          return { ...cast, data: { ...cast.data, status: variables.status } }
        })
        return { previousList, previousCard, listKey, cardKey }
      },
      onError: (_error, _variables, context) => {
        const ctx = context as
          | {
              previousList: unknown
              previousCard: unknown
              listKey: readonly unknown[]
              cardKey: readonly unknown[]
            }
          | undefined
        if (ctx?.previousList !== undefined) {
          queryClient.setQueryData(ctx.listKey, ctx.previousList)
        }
        if (ctx?.previousCard !== undefined) {
          queryClient.setQueryData(ctx.cardKey, ctx.previousCard)
        }
      },
      onSettled: (_data, _error, variables) => {
        queryClient.invalidateQueries({ queryKey: orpcQuery.cards.listBySession.key({ input: { sessionId } }) })
        queryClient.invalidateQueries({
          queryKey: orpcQuery.cards.get.key({ input: { cardId: variables.cardId } }),
        })
      },
      meta: { errorMessage: t`Failed to update card status` },
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

export const useSendChatMessage = (cardId: string) => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.cardChat.sendMessage.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: orpcQuery.cardChat.listForCard.key({ input: { cardId } }),
        })
        // The chat handler may have called update_card_fields server-side,
        // so the card data on disk may have shifted — refetch.
        queryClient.invalidateQueries({
          queryKey: orpcQuery.cards.get.key({ input: { cardId } }),
        })
      },
      meta: { errorMessage: t`Failed to send chat message` },
    })
  )
}

export const useExploreCard = (sessionId: string) => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.cards.explore.mutationOptions({
      onSuccess: (response, variables) => {
        // Prime the cache, then force-refetch the active get query — setQueryData
        // alone doesn't reliably propagate to consumers that wrap the query with
        // a `select` projection in this codebase; invalidate is the source of truth.
        queryClient.setQueryData(orpcQuery.cards.get.key({ input: { cardId: response.data.id } }), {
          data: response.data,
        })
        void queryClient.invalidateQueries({
          queryKey: orpcQuery.cards.get.key({ input: { cardId: variables.cardId } }),
        })
        void queryClient.invalidateQueries({
          queryKey: orpcQuery.cards.listBySession.key({ input: { sessionId } }),
        })
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
        queryClient.setQueryData(orpcQuery.cards.get.key({ input: { cardId: response.data.id } }), {
          data: response.data,
        })
        void queryClient.invalidateQueries({
          queryKey: orpcQuery.cards.get.key({ input: { cardId: response.data.id } }),
        })
      },
      meta: { errorMessage: t`Failed to update card fields` },
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
      },
      meta: { errorMessage: t`Failed to export CSV` },
    })
  )
}
