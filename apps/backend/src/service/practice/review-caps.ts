import {
  DEFAULT_PRACTICE_MAX_NEW_TERMS,
  DEFAULT_PRACTICE_MAX_REVIEW_TERMS,
  HARD_MAX_PRACTICE_NEW_TERMS,
  HARD_MAX_PRACTICE_REVIEW_TERMS,
  type PracticeSessionLimits,
  type UserTargetLanguagePrefsRepositoryInterface,
} from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
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
  userTargetLanguagePrefsRepository: UserTargetLanguagePrefsRepositoryInterface
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
// The active pool's NEW intake is never daily-capped (active introductions
// don't consume the passive new allowance), so maxNewTerms stays the hard
// ceiling. Its REVIEW cap is per-mode and optional: NULL (the default until the
// Phase-3 UI sets it) means uncapped — the hard ceiling — preserving today's
// behavior; a set value runs the same remaining-budget math against the
// production-mode rating log.
export const resolveReviewCaps = async (params: {
  userId: string
  targetLanguage: string
  pool: PracticePool
  scope: ReviewScope
  requestedNewCount?: number
  deps: ReviewCapsDependencies
}): Promise<{
  maxReviewTerms: number
  maxLearningTerms: number
  maxNewTerms: number
  // Hard-ceiling cap for opt-in (non-citation) new facets — pronunciation/forms
  // (Phase 4). Non-zero ONLY for the passive pool in learn_new scope; the
  // primary Practice button (mixed) never serves them (Trap 22). The active
  // pool has no opt-in facets.
  maxOptInNewTerms: number
}> => {
  const rawLimits = await params.deps.userTargetLanguagePrefsRepository.getPracticeLimitsForLanguage(
    params.userId,
    params.targetLanguage
  )

  if (params.pool === 'active') {
    if (rawLimits.maxReviewTermsActive == null) {
      return {
        maxReviewTerms: HARD_MAX_PRACTICE_REVIEW_TERMS,
        maxLearningTerms: HARD_MAX_PRACTICE_REVIEW_TERMS,
        maxNewTerms: HARD_MAX_PRACTICE_NEW_TERMS,
        maxOptInNewTerms: 0,
      }
    }
    const cap = Math.min(Math.max(Math.trunc(rawLimits.maxReviewTermsActive), 0), HARD_MAX_PRACTICE_REVIEW_TERMS)
    const consumedActiveReviews = await params.deps.practiceRatingEventsRepository.countReviewBudgetConsumedToday({
      userId: params.userId,
      targetLanguage: params.targetLanguage,
      mode: 'production',
    })
    return {
      maxReviewTerms: Math.max(0, cap - consumedActiveReviews),
      maxLearningTerms: HARD_MAX_PRACTICE_REVIEW_TERMS,
      maxNewTerms: HARD_MAX_PRACTICE_NEW_TERMS,
      maxOptInNewTerms: 0,
    }
  }

  const limits = clampPracticeSessionLimits(rawLimits)

  const consumedReviewsToday = await params.deps.practiceRatingEventsRepository.countReviewBudgetConsumedToday({
    userId: params.userId,
    targetLanguage: params.targetLanguage,
    mode: 'recognition',
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

  return {
    maxReviewTerms: remainingReviews,
    maxLearningTerms: HARD_MAX_PRACTICE_REVIEW_TERMS,
    maxNewTerms,
    // Opt-in (non-citation) new facets bypass the daily-new cap entirely, but
    // only in an explicit learn-new session — never the mixed Practice button.
    maxOptInNewTerms: params.scope === 'learn_new' ? HARD_MAX_PRACTICE_NEW_TERMS : 0,
  }
}
