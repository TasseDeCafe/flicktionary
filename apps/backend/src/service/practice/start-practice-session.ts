import type { PracticeSessionsRepositoryInterface } from '../../transport/database/practice-sessions/practice-sessions-repository'
import type { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'
import type { UsersRepositoryInterface } from '../../transport/database/users/users-repository'

export type StartPracticeSessionDependencies = {
  practiceSessionsRepository: PracticeSessionsRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
  usersRepository: UsersRepositoryInterface
}

export type StartPracticeSessionResult =
  | { ok: true; sessionId: string }
  | { ok: false; reason: 'no_kept_cards' | 'no_native_language' }

// Creates a new practice_session for (user, target_language). Refuses if the
// user has zero kept cards in that language (the review pool would be empty)
// or if their native_language pref isn't set (we need it for the LLM prompt).
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

  const session = await deps.practiceSessionsRepository.insert({ userId, targetLanguage })
  return { ok: true, sessionId: session.id }
}
