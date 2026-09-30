import type { DbUserLookupWithFacet } from '../../transport/database/user-lookups/user-lookups-repository'
import type { PracticePool } from '../../transport/database/user-lookups/user-lookups-repository'
import type { ReviewScope } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'
import { resolveReviewCaps, type ReviewCapsDependencies } from './review-caps'
import { resolveBookQuota, type BookQuotaDependencies } from './book-quota'

export type ListReviewTermsDependencies = ReviewCapsDependencies & BookQuotaDependencies

// Resolve the effective caps for the (user, language, pool, scope) and return
// the live review slice for the composed queue's flashcard sub-lists.
export const listReviewTerms = async (
  userId: string,
  targetLanguage: string,
  pool: PracticePool,
  scope: ReviewScope,
  deps: ListReviewTermsDependencies
): Promise<DbUserLookupWithFacet[]> => {
  const caps = await resolveReviewCaps({
    userId,
    targetLanguage,
    pool,
    scope,
    deps,
  })
  // Only the recognition new bucket follows the pinned-book order.
  const bookQuota =
    pool === 'recognition' && caps.maxNewTerms > 0 ? await resolveBookQuota(userId, targetLanguage, deps) : null
  return deps.userLookupsRepository.listReviewTerms({
    userId,
    targetLanguage,
    pool,
    scope,
    maxReviewTerms: caps.maxReviewTerms,
    maxLearningTerms: caps.maxLearningTerms,
    maxNewTerms: caps.maxNewTerms,
    maxOptInNewTerms: caps.maxOptInNewTerms,
    bookRemaining: bookQuota?.remaining ?? 0,
  })
}
