import type { Card } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'

export const cardHasBasicData = (card: Card): boolean =>
  Boolean(card.chunk.translation?.trim() || card.chunk.definition?.trim() || card.chunk.targetExample?.trim())
