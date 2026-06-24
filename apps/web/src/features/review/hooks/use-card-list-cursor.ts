import type { Card } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'

export type CardCursor = {
  prev: Card | null
  next: Card | null
  index: number
  total: number
}

// The focus view navigates the same set the user sees in Session vocabulary:
// kept cards plus needs_data note-only stubs. Removed cards stay out of the
// cursor so removing one card never advances into another removed card.
export const buildKeptCardCursor = (cards: Card[], currentCardId: string): CardCursor => {
  const navigable = cards.filter((c) => c.status === 'kept' || c.status === 'needs_data')
  const index = navigable.findIndex((c) => c.id === currentCardId)
  if (index === -1) {
    return { prev: null, next: null, index: -1, total: navigable.length }
  }
  return {
    prev: index > 0 ? (navigable[index - 1] ?? null) : null,
    next: index < navigable.length - 1 ? (navigable[index + 1] ?? null) : null,
    index,
    total: navigable.length,
  }
}
