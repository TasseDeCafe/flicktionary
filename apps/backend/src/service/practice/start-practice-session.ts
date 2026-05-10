import type { PracticeSessionsRepositoryInterface } from '../../transport/database/practice-sessions/practice-sessions-repository'
import type { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'
import {
  DEFAULT_PRACTICE_MAX_NEW_TERMS,
  DEFAULT_PRACTICE_MAX_REVIEW_TERMS,
  HARD_MAX_PRACTICE_NEW_TERMS,
  HARD_MAX_PRACTICE_REVIEW_TERMS,
  type PracticeSessionLimits,
  type UsersRepositoryInterface,
} from '../../transport/database/users/users-repository'

export type StartPracticeSessionDependencies = {
  practiceSessionsRepository: PracticeSessionsRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
  usersRepository: UsersRepositoryInterface
}

export type StartPracticeSessionResult =
  | { ok: true; sessionId: string; resumed: boolean }
  | { ok: false; reason: 'no_kept_cards' | 'no_native_language' | 'no_practice_terms' }

// Sessions older than this are auto-abandoned before we try to resume — the
// user has clearly walked away, and we'd rather snapshot a fresh eligibility
// universe than dredge up a days-old one.
const STALE_SESSION_HOURS = 24

const clampPracticeSessionLimits = (limits: PracticeSessionLimits): PracticeSessionLimits => {
  const maxNewTerms = Math.min(Math.max(Math.trunc(limits.maxNewTerms), 0), HARD_MAX_PRACTICE_NEW_TERMS)
  const maxReviewTerms = Math.min(Math.max(Math.trunc(limits.maxReviewTerms), 0), HARD_MAX_PRACTICE_REVIEW_TERMS)
  if (maxNewTerms + maxReviewTerms > 0) return { maxNewTerms, maxReviewTerms }
  return {
    maxNewTerms: DEFAULT_PRACTICE_MAX_NEW_TERMS,
    maxReviewTerms: DEFAULT_PRACTICE_MAX_REVIEW_TERMS,
  }
}

// Resume-or-create. If the user has an active practice_session for this
// (user, target_language), return its id with resumed=true. Otherwise insert
// a fresh row + snapshot the capped practice batch in one transaction
// (insertOrResume handles the race; the partial unique index makes
// double-create impossible).
export const startPracticeSession = async (
  userId: string,
  targetLanguage: string,
  deps: StartPracticeSessionDependencies
): Promise<StartPracticeSessionResult> => {
  const nativeLanguage = await deps.usersRepository.getNativeLanguage(userId)
  if (!nativeLanguage) return { ok: false, reason: 'no_native_language' }

  const summary = await deps.userLookupsRepository.listDueSummary(userId)
  const langSummary = summary.find((s) => s.targetLanguage === targetLanguage)
  if (!langSummary || langSummary.totalKept === 0) return { ok: false, reason: 'no_kept_cards' }

  await deps.practiceSessionsRepository.abandonStaleForUser({
    userId,
    targetLanguage,
    olderThanHours: STALE_SESSION_HOURS,
  })

  const limits = clampPracticeSessionLimits(await deps.usersRepository.getPracticeSessionLimits(userId))
  const active = await deps.practiceSessionsRepository.findActiveForUser({ userId, targetLanguage })
  if (!active) {
    const selectedNewTerms = Math.min(langSummary.newCount, limits.maxNewTerms)
    const selectedReviewTerms = Math.min(
      langSummary.reviewDueCount + langSummary.learningDueCount,
      limits.maxReviewTerms
    )
    if (selectedNewTerms + selectedReviewTerms === 0) return { ok: false, reason: 'no_practice_terms' }
  }

  const { session, resumed } = await deps.practiceSessionsRepository.insertOrResume({
    userId,
    targetLanguage,
    maxNewTerms: limits.maxNewTerms,
    maxReviewTerms: limits.maxReviewTerms,
  })
  return { ok: true, sessionId: session.id, resumed }
}
