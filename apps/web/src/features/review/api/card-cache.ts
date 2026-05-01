import { orpcQuery } from '@/lib/transport/orpc-client'
import type { QueryClient } from '@tanstack/react-query'
import type { Card, CardStatus } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'

type CardDetailQueryData = {
  data: Card
}

type SessionCardsQueryData = {
  data: Card[]
}

export type CardCacheSnapshot = {
  listKey: readonly unknown[]
  detailKey: readonly unknown[]
  previousList: unknown
  previousDetail: unknown
}

export const reviewCardCacheStaleTimeMs = 5 * 60 * 1000

export const getSessionCardsKey = (sessionId: string) =>
  orpcQuery.cards.listBySession.queryKey({ input: { sessionId } })

export const getCardDetailKey = (cardId: string) => orpcQuery.cards.get.queryKey({ input: { cardId } })

export const snapshotCardCaches = (
  queryClient: QueryClient,
  params: { sessionId: string; cardId: string }
): CardCacheSnapshot => {
  const listKey = getSessionCardsKey(params.sessionId)
  const detailKey = getCardDetailKey(params.cardId)
  return {
    listKey,
    detailKey,
    previousList: queryClient.getQueryData(listKey),
    previousDetail: queryClient.getQueryData(detailKey),
  }
}

export const restoreCardCaches = (queryClient: QueryClient, snapshot: CardCacheSnapshot | undefined) => {
  if (!snapshot) return
  if (snapshot.previousList !== undefined) {
    queryClient.setQueryData(snapshot.listKey, snapshot.previousList)
  }
  if (snapshot.previousDetail !== undefined) {
    queryClient.setQueryData(snapshot.detailKey, snapshot.previousDetail)
  }
}

export const cancelCardCaches = (
  queryClient: QueryClient,
  params: { sessionId: string; cardId: string }
): Promise<unknown[]> => {
  return Promise.all([
    queryClient.cancelQueries({ queryKey: getSessionCardsKey(params.sessionId) }),
    queryClient.cancelQueries({ queryKey: getCardDetailKey(params.cardId) }),
  ])
}

const updateCardInSessionListCache = (
  queryClient: QueryClient,
  sessionId: string,
  cardId: string,
  updater: (card: Card) => Card
) => {
  queryClient.setQueryData<SessionCardsQueryData>(getSessionCardsKey(sessionId), (cachedList) => {
    if (!cachedList?.data) return cachedList
    return {
      ...cachedList,
      data: cachedList.data.map((card) => (card.id === cardId ? updater(card) : card)),
    }
  })
}

const updateCardDetailCache = (queryClient: QueryClient, cardId: string, updater: (card: Card) => Card) => {
  queryClient.setQueryData<CardDetailQueryData>(getCardDetailKey(cardId), (cachedCard) => {
    if (!cachedCard?.data) return cachedCard
    return { ...cachedCard, data: updater(cachedCard.data) }
  })
}

export const setCardEverywhere = (queryClient: QueryClient, card: Card) => {
  queryClient.setQueryData<CardDetailQueryData>(getCardDetailKey(card.id), { data: card })
  updateCardInSessionListCache(queryClient, card.studySessionId, card.id, () => card)
}

export const setCardStatusEverywhere = (
  queryClient: QueryClient,
  params: { sessionId: string; cardId: string; status: CardStatus }
) => {
  const updateStatus = (card: Card): Card => ({ ...card, status: params.status })
  updateCardInSessionListCache(queryClient, params.sessionId, params.cardId, updateStatus)
  updateCardDetailCache(queryClient, params.cardId, updateStatus)
}

export const invalidateCardEverywhere = (queryClient: QueryClient, params: { sessionId: string; cardId: string }) => {
  void queryClient.invalidateQueries({ queryKey: getSessionCardsKey(params.sessionId) })
  void queryClient.invalidateQueries({ queryKey: getCardDetailKey(params.cardId) })
}
