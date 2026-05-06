import type { PracticeSessionsRepositoryInterface } from '../../transport/database/practice-sessions/practice-sessions-repository'
import type { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'
import type { L1InterferenceNotesRepositoryInterface } from '../../transport/database/l1-interference-notes/l1-interference-notes-repository'
import type { UsersRepositoryInterface } from '../../transport/database/users/users-repository'
import { ensureL1InterferenceNotes } from './ensure-l1-interference-notes'

export type StartPracticeSessionDependencies = {
  practiceSessionsRepository: PracticeSessionsRepositoryInterface
  userLookupsRepository: UserLookupsRepositoryInterface
  l1InterferenceNotesRepository: L1InterferenceNotesRepositoryInterface
  usersRepository: UsersRepositoryInterface
}

export type StartPracticeSessionResult =
  | { ok: true; sessionId: string }
  | { ok: false; reason: 'no_kept_cards' | 'no_native_language' }

// Creates a new practice_session for (user, target_language). Refuses if the
// user has zero kept cards in that language (the review pool would be empty)
// or if their native_language pref isn't set (we need it for the L1
// interference notes that drive the LLM prompt).
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

  // Warm the L1 cache so the first generate-next-text call doesn't pay the
  // double LLM round-trip latency.
  await ensureL1InterferenceNotes(nativeLanguage, targetLanguage, deps.l1InterferenceNotesRepository)

  const session = await deps.practiceSessionsRepository.insert({ userId, targetLanguage })
  return { ok: true, sessionId: session.id }
}
