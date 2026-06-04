import type {
  DbUserLookup,
  PracticePool,
  UserLookupsRepositoryInterface,
} from '../../transport/database/user-lookups/user-lookups-repository'
import { applyRating, type AppRating } from './fsrs'
import { isParked, shouldParkLeech } from './leech-config'

export type RateTermDependencies = {
  userLookupsRepository: UserLookupsRepositoryInterface
  // Optional fire-and-forget exercise-bank warmer. Both rating surfaces
  // (flashcards via rateTerm, reading via advanceReadingText) share
  // applyTermRating, so wiring it here covers again/hard triggers in both
  // render modes. Absent in unit tests and callers that don't care.
  warmExerciseBank?: (params: { lookup: DbUserLookup; pool: PracticePool }) => void
}

export type ApplyTermRatingResult =
  | { ok: true; introducedNew: boolean; parked: boolean }
  | { ok: false; reason: 'daily_cap_reached' | 'not_in_active_pool' }

// Apply one rating event to a user_lookup in the given pool. Shared by the
// flashcard reviewer (rateTerm) and the reading-text finalizer
// (advanceReadingText) so both introduce/grade terms identically.
//
// New-term introductions (state IS NULL) are gated at introduction time:
//   - passive: the atomic daily-cap guard stamps the row only if the day's
//     introduced count is still under maxNewTerms. Refusal => no FSRS applied,
//     the caller drops the term (flashcard) or leaves it new (reading).
//   - active: not daily-capped — initialize unconditionally.
// Already-scheduled terms skip the guard entirely.
export const applyTermRating = async (params: {
  lookup: DbUserLookup
  userId: string
  rating: AppRating
  pool: PracticePool
  maxNewTerms: number
  deps: RateTermDependencies
}): Promise<ApplyTermRatingResult> => {
  const { lookup, userId, rating, pool, maxNewTerms, deps } = params
  if (pool === 'active' && lookup.learning_mode !== 'active') {
    return { ok: false, reason: 'not_in_active_pool' }
  }
  if (isParked(lookup, pool)) {
    // Stale queues can outlive parking: an old flashcard tab or an already
    // generated reading text may still submit a rating after the term left
    // rotation. Parked terms must not mutate FSRS until rehab graduates them.
    return { ok: true, introducedNew: false, parked: true }
  }

  const introducedNew = pool === 'passive' ? lookup.srs_state == null : lookup.active_srs_state == null

  if (introducedNew) {
    if (pool === 'passive') {
      const introduced = await deps.userLookupsRepository.initializeSrsStateIfUnderDailyCap({
        userLookupId: lookup.id,
        userId,
        targetLanguage: lookup.target_language,
        maxNewTerms,
      })
      if (!introduced) return { ok: false, reason: 'daily_cap_reached' }
    } else {
      await deps.userLookupsRepository.initializeSrsStateForPool({ userLookupId: lookup.id, pool: 'active' })
    }
  }

  // applyRating seeds null-state rows via createEmptyCard, then FSRS transitions
  // them. applyFsrsResultForPool overwrites the pool's srs columns;
  // added_to_practice_at (stamped by the guard) is left untouched.
  const result = applyRating(lookup, rating, new Date(), pool)
  await deps.userLookupsRepository.applyFsrsResultForPool({
    userLookupId: lookup.id,
    pool,
    state: result.state,
    due: result.due,
    stability: result.stability,
    difficulty: result.difficulty,
    lastReview: result.lastReview,
    reps: result.reps,
    lapses: result.lapses,
  })

  // Leech detection — here in the shared path so a fresh lapse parks the term
  // whether it came from flashcards or a reading-text advance. The condition
  // is a new-lapse delta (see shouldParkLeech): historical lapses alone never
  // park, so graduated terms survive good/easy ratings.
  const parked = shouldParkLeech(lookup, result, pool)
  if (parked) {
    await deps.userLookupsRepository.parkLeech({ userLookupId: lookup.id, pool })
  }

  // Pre-warm the exercise bank in the background: a freshly parked leech needs
  // its gate exercises, and a struggling (again/hard) term feeds the
  // post-session Strengthen list.
  if (parked || rating === 'again' || rating === 'hard') {
    deps.warmExerciseBank?.({ lookup, pool })
  }

  return { ok: true, introducedNew, parked }
}

export type RateTermResult =
  | { ok: true; introducedNew: boolean; dailyCapReached: boolean; parked: boolean }
  | { ok: false; reason: 'lookup_not_found' | 'not_in_active_pool' }

// Flashcard-mode single-card rating. Pool-parametrized; no practice_text / no
// session. Daily-cap refusal is surfaced (not an error) so the client drops the
// card without applying FSRS.
export const rateTerm = async (
  userLookupId: string,
  userId: string,
  rating: AppRating,
  pool: PracticePool,
  maxNewTerms: number,
  deps: RateTermDependencies
): Promise<RateTermResult> => {
  const lookup = await deps.userLookupsRepository.findByIdForUser(userLookupId, userId)
  if (!lookup) return { ok: false, reason: 'lookup_not_found' }

  const result = await applyTermRating({ lookup, userId, rating, pool, maxNewTerms, deps })
  if (!result.ok && result.reason === 'not_in_active_pool') return { ok: false, reason: 'not_in_active_pool' }
  if (!result.ok) return { ok: true, introducedNew: false, dailyCapReached: true, parked: false }
  return { ok: true, introducedNew: result.introducedNew, dailyCapReached: false, parked: result.parked }
}
