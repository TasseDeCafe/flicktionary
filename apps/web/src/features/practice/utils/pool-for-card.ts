import type { PracticePool, ReviewTerm } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'

// The pool a queued card belongs to is fully determined by its facet skill:
// the composed queue mixes pools in one session.
export const poolForCard = (card: ReviewTerm): PracticePool =>
  card.skill === 'meaning_production' ? 'production' : 'recognition'
