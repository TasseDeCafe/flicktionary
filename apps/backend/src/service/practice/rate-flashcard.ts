import type { UserLookupsRepositoryInterface } from '../../transport/database/user-lookups/user-lookups-repository'
import type { PracticeSessionsRepositoryInterface } from '../../transport/database/practice-sessions/practice-sessions-repository'
import { applyRating, type AppRating } from './fsrs'

export type RateFlashcardDependencies = {
  userLookupsRepository: UserLookupsRepositoryInterface
  practiceSessionsRepository: PracticeSessionsRepositoryInterface
}

export type RateFlashcardResult =
  | { ok: true; introducedNew: boolean }
  | { ok: false; reason: 'lookup_not_found' | 'daily_cap_reached' | 'passive_session_active' }

// Grade a single flashcard. Does NOT reuse rateChunk: that path requires a
// practice_text + annotation match and logs to practice_ratings (whose
// practice_text_id FK is NOT NULL). Flashcards are sessionless and textless, so
// we apply FSRS directly to the passive srs_* columns — the SAME shared SRS
// budget the reading flow writes.
//
// New-card introductions (srs_state IS NULL) must be capped at introduction
// time, not just at list time: list-time remaining-count is racy across
// tabs/devices. We delegate to the atomic guard
// initializeSrsStateIfUnderDailyCap, which stamps the row only if the day's
// introduced count is still under maxNewTerms in the same statement. When the
// guard refuses (0 rows) we return daily_cap_reached WITHOUT applying FSRS, so
// the client drops the card. Due cards (non-null srs_state) skip the guard
// entirely — they don't count against the new cap.
//
// `maxNewTerms` is the user's full clamped daily new cap; the guard does its own
// today-count comparison against it.
export const rateFlashcard = async (
  userLookupId: string,
  userId: string,
  rating: AppRating,
  maxNewTerms: number,
  deps: RateFlashcardDependencies
): Promise<RateFlashcardResult> => {
  const lookup = await deps.userLookupsRepository.findByIdForUser(userLookupId, userId)
  if (!lookup) return { ok: false, reason: 'lookup_not_found' }

  const activeSession = await deps.practiceSessionsRepository.findActiveForUser({
    userId,
    targetLanguage: lookup.target_language,
    pool: 'passive',
  })
  if (activeSession) return { ok: false, reason: 'passive_session_active' }

  const introducedNew = lookup.srs_state == null
  if (introducedNew) {
    const introduced = await deps.userLookupsRepository.initializeSrsStateIfUnderDailyCap({
      userLookupId: lookup.id,
      userId,
      targetLanguage: lookup.target_language,
      maxNewTerms,
    })
    if (!introduced) return { ok: false, reason: 'daily_cap_reached' }
  }

  // applyRating seeds null-state rows via createEmptyCard, then FSRS transitions
  // them. applyFsrsResultForPool overwrites srs_state/due with the FSRS result;
  // added_to_practice_at (stamped by the guard) is left untouched.
  const result = applyRating(lookup, rating, new Date(), 'passive')
  await deps.userLookupsRepository.applyFsrsResultForPool({
    userLookupId: lookup.id,
    pool: 'passive',
    state: result.state,
    due: result.due,
    stability: result.stability,
    difficulty: result.difficulty,
    lastReview: result.lastReview,
    reps: result.reps,
    lapses: result.lapses,
  })

  return { ok: true, introducedNew }
}
