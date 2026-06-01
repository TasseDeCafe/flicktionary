import {
  DEFAULT_PRACTICE_MAX_NEW_TERMS,
  DEFAULT_PRACTICE_MAX_REVIEW_TERMS,
  HARD_MAX_PRACTICE_NEW_TERMS,
  HARD_MAX_PRACTICE_REVIEW_TERMS,
  type PracticeSessionLimits,
  type UsersRepositoryInterface,
} from '../../transport/database/users/users-repository'
import type { PracticePool, UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'

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
}

// Effective per-fetch caps for a (user, language, pool). The passive pool
// shares the daily-new budget: its new cap is the clamped daily limit minus
// today's introductions. The active pool is not daily-capped (active
// introductions don't consume the passive new allowance), so it uses the hard
// ceilings as generous bounds.
export const resolveReviewCaps = async (params: {
  userId: string
  targetLanguage: string
  pool: PracticePool
  deps: ReviewCapsDependencies
}): Promise<{ maxReviewTerms: number; maxNewTerms: number }> => {
  if (params.pool === 'active') {
    return { maxReviewTerms: HARD_MAX_PRACTICE_REVIEW_TERMS, maxNewTerms: HARD_MAX_PRACTICE_NEW_TERMS }
  }
  const limits = clampPracticeSessionLimits(await params.deps.usersRepository.getPracticeSessionLimits(params.userId))
  const summary = (await params.deps.userLookupsRepository.listDueSummary(params.userId)).find(
    (s) => s.targetLanguage === params.targetLanguage
  )
  const remainingDailyNew = Math.max(0, limits.maxNewTerms - (summary?.newIntroducedTodayCount ?? 0))
  return { maxReviewTerms: limits.maxReviewTerms, maxNewTerms: remainingDailyNew }
}
