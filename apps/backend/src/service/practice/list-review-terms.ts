import type { DbUserLookup } from '../../transport/database/user-lookups/user-lookups-repository'
import type { PracticePool } from '../../transport/database/user-lookups/user-lookups-repository'
import type { ReviewScope } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { resolveReviewCaps, type ReviewCapsDependencies } from './review-caps'

export type ListReviewTermsDependencies = ReviewCapsDependencies

// Resolve the effective caps for the (user, language, pool) and return the live
// review slice for the scope. Feeds both the flashcard queue (router) and the
// reading generator's candidate set, so the daily-new budget is shared between
// the two render modes.
export const listReviewTerms = async (
  userId: string,
  targetLanguage: string,
  pool: PracticePool,
  scope: ReviewScope,
  deps: ListReviewTermsDependencies
): Promise<DbUserLookup[]> => {
  const caps = await resolveReviewCaps({ userId, targetLanguage, pool, deps })
  return deps.userLookupsRepository.listReviewTerms({
    userId,
    targetLanguage,
    pool,
    scope,
    maxReviewTerms: caps.maxReviewTerms,
    maxNewTerms: caps.maxNewTerms,
  })
}
