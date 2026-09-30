import {
  DEFAULT_PRACTICE_MAX_NEW_TERMS,
  DEFAULT_PRACTICE_MAX_REVIEW_TERMS,
  HARD_MAX_PRACTICE_NEW_TERMS,
  HARD_MAX_PRACTICE_REVIEW_TERMS,
  type PracticeSessionLimits,
  type UserTargetLanguagePrefsRepositoryInterface,
} from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import type { PracticePool } from '../../transport/database/user-lookups/user-lookups-repository'
import type { PracticeRatingEventsRepositoryInterface } from '../../transport/database/practice-rating-events/practice-rating-events-repository'

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
  userTargetLanguagePrefsRepository: UserTargetLanguagePrefsRepositoryInterface
  practiceRatingEventsRepository: PracticeRatingEventsRepositoryInterface
}

// Effective due-flashcard caps for a (user, language, pool).
//
//   - review budget: the clamped daily review limit minus review-state cards
//     already rated today (counted off the practice_rating_events log) — a
//     refresh mid-session doesn't refill the queue.
//   - learning follow-ups are exempt: maxLearningTerms is a hard ceiling,
//     never a budget, so a failed card's relearning step can't be stranded by
//     a spent budget.
//
// The production pool's review cap is per-pool and optional: NULL (the
// default) means uncapped — the hard ceiling; a set value runs the same
// remaining-budget math against the production-pool rating log. The daily NEW
// budget is not resolved here: introductions go through the composed queue's
// warm-up gates (plan-practice-queue.ts) and the atomic introduction guard.
export const resolveReviewCaps = async (params: {
  userId: string
  targetLanguage: string
  pool: PracticePool
  deps: ReviewCapsDependencies
}): Promise<{ maxReviewTerms: number; maxLearningTerms: number }> => {
  const rawLimits = await params.deps.userTargetLanguagePrefsRepository.getPracticeLimitsForLanguage(
    params.userId,
    params.targetLanguage
  )

  if (params.pool === 'production') {
    if (rawLimits.maxReviewTermsProduction == null) {
      return { maxReviewTerms: HARD_MAX_PRACTICE_REVIEW_TERMS, maxLearningTerms: HARD_MAX_PRACTICE_REVIEW_TERMS }
    }
    const cap = Math.min(Math.max(Math.trunc(rawLimits.maxReviewTermsProduction), 0), HARD_MAX_PRACTICE_REVIEW_TERMS)
    const consumedProductionReviews = await params.deps.practiceRatingEventsRepository.countReviewBudgetConsumedToday({
      userId: params.userId,
      targetLanguage: params.targetLanguage,
      pool: 'production',
    })
    return {
      maxReviewTerms: Math.max(0, cap - consumedProductionReviews),
      maxLearningTerms: HARD_MAX_PRACTICE_REVIEW_TERMS,
    }
  }

  const limits = clampPracticeSessionLimits(rawLimits)
  const consumedReviewsToday = await params.deps.practiceRatingEventsRepository.countReviewBudgetConsumedToday({
    userId: params.userId,
    targetLanguage: params.targetLanguage,
    pool: 'recognition',
  })
  return {
    maxReviewTerms: Math.max(0, limits.maxReviewTerms - consumedReviewsToday),
    maxLearningTerms: HARD_MAX_PRACTICE_REVIEW_TERMS,
  }
}
