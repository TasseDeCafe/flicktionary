import {
  DEFAULT_PRACTICE_MAX_NEW_TERMS,
  DEFAULT_PRACTICE_MAX_REVIEW_TERMS,
  HARD_MAX_PRACTICE_NEW_TERMS,
  HARD_MAX_PRACTICE_REVIEW_TERMS,
  type PracticeSessionLimits,
  type UsersRepositoryInterface,
} from '../../transport/database/users/users-repository'
import type {
  PracticePool,
  UserLookupsRepositoryInterface,
} from '../../transport/database/user-lookups/user-lookups-repository'
import type { PracticeRatingEventsRepositoryInterface } from '../../transport/database/practice-rating-events/practice-rating-events-repository'
import type { ReviewScope } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'

export const clampPracticeSessionLimits = (limits: PracticeSessionLimits): PracticeSessionLimits => {
  const maxNewTerms = Math.min(Math.max(Math.trunc(limits.maxNewTerms), 0), HARD_MAX_PRACTICE_NEW_TERMS)
  const maxReviewTerms = Math.min(Math.max(Math.trunc(limits.maxReviewTerms), 0), HARD_MAX_PRACTICE_REVIEW_TERMS)
  if (maxNewTerms + maxReviewTerms > 0) return { maxNewTerms, maxReviewTerms }
  return {
    maxNewTerms: DEFAULT_PRACTICE_MAX_NEW_TERMS,
    maxReviewTerms: DEFAULT_PRACTICE_MAX_REVIEW_TERMS,
  }
}

export type ReviewCapsDependencies = {
  usersRepository: UsersRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
  practiceRatingEventsRepository: PracticeRatingEventsRepositoryInterface
}

// Effective per-fetch caps for a (user, language, pool, scope). The passive
// pool runs two daily budgets:
//
//   - review budget: the clamped daily review limit minus review-state cards
//     already rated today (counted off the practice_rating_events log) — a
//     refresh mid-session no longer refills the queue. Learning-state intraday
//     follow-ups are exempt: maxLearningTerms is a hard ceiling, never a
//     budget, so a failed card's relearning step can't be stranded by a spent
//     budget.
//   - new budget: the clamped daily limit minus today's introductions —
//     UNLESS this is an explicit learn-new session (`scope === 'learn_new'`
//     with a `requestedNewCount`), which serves exactly the requested batch
//     regardless of the remaining daily budget (Anki-style custom study; the
//     introductions still stamp added_to_practice_at, so they count toward
//     today and `mixed` won't re-add more). Without `requestedNewCount` (the
//     reading-generator path) learn_new keeps the daily-remaining math.
//
// The active pool is not daily-capped (active introductions don't consume the
// passive new allowance and active ratings are excluded from the review-budget
// count), so it uses the hard ceilings as generous bounds.
export const resolveReviewCaps = async (params: {
  userId: string
  targetLanguage: string
  pool: PracticePool
  scope: ReviewScope
  requestedNewCount?: number
  deps: ReviewCapsDependencies
}): Promise<{ maxReviewTerms: number; maxLearningTerms: number; maxNewTerms: number }> => {
  if (params.pool === 'active') {
    return {
      maxReviewTerms: HARD_MAX_PRACTICE_REVIEW_TERMS,
      maxLearningTerms: HARD_MAX_PRACTICE_REVIEW_TERMS,
      maxNewTerms: HARD_MAX_PRACTICE_NEW_TERMS,
    }
  }
  const limits = clampPracticeSessionLimits(await params.deps.usersRepository.getPracticeSessionLimits(params.userId))

  const consumedReviewsToday = await params.deps.practiceRatingEventsRepository.countReviewBudgetConsumedToday({
    userId: params.userId,
    targetLanguage: params.targetLanguage,
    pool: 'passive',
  })
  const remainingReviews = Math.max(0, limits.maxReviewTerms - consumedReviewsToday)

  let maxNewTerms: number
  if (params.scope === 'learn_new' && params.requestedNewCount != null) {
    maxNewTerms = Math.min(params.requestedNewCount, HARD_MAX_PRACTICE_NEW_TERMS)
  } else {
    const summary = (await params.deps.userLookupsRepository.listDueSummary(params.userId)).find(
      (s) => s.targetLanguage === params.targetLanguage
    )
    maxNewTerms = Math.max(0, limits.maxNewTerms - (summary?.newIntroducedTodayCount ?? 0))
  }

  return { maxReviewTerms: remainingReviews, maxLearningTerms: HARD_MAX_PRACTICE_REVIEW_TERMS, maxNewTerms }
}
