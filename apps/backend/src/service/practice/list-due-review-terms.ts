import type {
  DbUserLookupWithFacet,
  PracticePool,
  UserLookupsRepositoryInterface,
} from '../../transport/database/user-lookups/user-lookups-repository'
import { resolveReviewCaps, type ReviewCapsDependencies } from './review-caps'

export type ListDueReviewTermsDependencies = ReviewCapsDependencies & {
  userLookupsRepository: UserLookupsRepositoryInterface
}

// The composed queue's due flashcards for a (language, pool), capped by the
// day's remaining review budget (resolveReviewCaps).
export const listDueReviewTerms = async (
  userId: string,
  targetLanguage: string,
  pool: PracticePool,
  deps: ListDueReviewTermsDependencies
): Promise<DbUserLookupWithFacet[]> => {
  const caps = await resolveReviewCaps({ userId, targetLanguage, pool, deps })
  return deps.userLookupsRepository.listDueReviewTerms({
    userId,
    targetLanguage,
    pool,
    maxReviewTerms: caps.maxReviewTerms,
    maxLearningTerms: caps.maxLearningTerms,
  })
}
