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
        const queryKey = orpcQuery.cards.listBySession.key({ input: { sessionId } })
        await queryClient.cancelQueries({ queryKey })
        const previous = queryClient.getQueryData(queryKey)
        queryClient.setQueriesData({ queryKey }, (data: unknown) => {
          if (!data || typeof data !== 'object') return data
          const cast = data as { data: Array<{ id: string; status: string }> }
          return {
            ...cast,
            data: cast.data.map((c) => (c.id === variables.cardId ? { ...c, status: variables.status } : c)),
          }
        })
        return { previous, queryKey }
      },
      onError: (_error, _variables, context) => {
        const ctx = context as { previous: unknown; queryKey: readonly unknown[] } | undefined
        if (ctx?.previous !== undefined) {
          queryClient.setQueryData(ctx.queryKey, ctx.previous)
        }
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: orpcQuery.cards.listBySession.key({ input: { sessionId } }) })
      },
      meta: { errorMessage: t`Failed to update card status` },
    })
  )
}

export const useUpdateCardOverrides = () => {
  const { t } = useLingui()
  const queryClient = useQueryClient()
  return useMutation(
    orpcQuery.cards.updateOverrides.mutationOptions({
      onSuccess: (response) => {
        queryClient.setQueryData(orpcQuery.cards.get.key({ input: { cardId: response.data.id } }), {
          data: response.data,
        })
      },
      meta: { errorMessage: t`Failed to save edits` },
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
      },
      meta: { errorMessage: t`Failed to send chat message` },
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
