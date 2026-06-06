import type postgres from 'postgres'
import type {
  DbUserLookup,
  PracticePool,
  UserLookupsRepositoryInterface,
} from '../../transport/database/user-lookups/user-lookups-repository'
import type { PracticeRatingEventsRepositoryInterface } from '../../transport/database/practice-rating-events/practice-rating-events-repository'
import { applyRating, type AppRating } from './fsrs'
import { isParked, shouldParkLeech } from './leech-config'

// Runs `fn` inside one DB transaction and hands it the executor to thread into
// repo methods that accept one. Wired from postgres-client's beginTx; unit
// tests fake it as `(fn) => fn(undefined as never)`.
export type WithTransaction = <T>(fn: (tx: postgres.Sql) => Promise<T>) => Promise<T>

export type RateTermDependencies = {
  userLookupsRepository: UserLookupsRepositoryInterface
  practiceRatingEventsRepository: PracticeRatingEventsRepositoryInterface
  withTransaction: WithTransaction
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
//     `bypassDailyCap` (an explicit learn-new session) skips only the count
//     predicate — the row is still stamped, so it counts toward today.
//   - active: not daily-capped — initialize unconditionally.
// Already-scheduled terms skip the guard entirely.
//
// Every APPLIED rating also appends a practice_rating_events row in the same
// transaction as the FSRS write — the log is the daily review budget's source
// of truth, so a half-applied rating must not re-open the refill bug. No event
// on cap-refusal, parked no-op, or not-in-active-pool (nothing was applied).
//
// Known, accepted partial-failure window: the passive introduction guard runs
// in its OWN advisory-lock transaction. If the guard stamps the row and the
// FSRS+event tx then fails, the card shows up due ('new', due now) and
// self-heals on the next rating (which logs its event then); the consumed
// new-budget slot is correct since the introduction did happen, and there's no
// event to undo because no FSRS result was applied. Same risk window as the
// pre-event-log code.
export const applyTermRating = async (params: {
  lookup: DbUserLookup
  userId: string
  rating: AppRating
  pool: PracticePool
  maxNewTerms: number
  // false = implicit 'good' on a reading-text advance.
  wasExplicit?: boolean
  // Reading-mode context for the event row; absent for flashcards.
  practiceTextId?: string
  bypassDailyCap?: boolean
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
        bypassCap: params.bypassDailyCap ?? false,
      })
      if (!introduced) return { ok: false, reason: 'daily_cap_reached' }
    } else {
      await deps.userLookupsRepository.initializeSrsStateForPool({ userLookupId: lookup.id, pool: 'active' })
    }
  }

  // Pre-rating snapshot of the rated pool's SRS family, taken from the lookup
  // row BEFORE applyRating (which reads but never mutates it). For an
  // introduction the in-memory row still has its pre-guard NULL state — which
  // is exactly the restore target a future undo needs.
  const prev =
    pool === 'passive'
      ? {
          state: lookup.srs_state,
          due: lookup.srs_due,
          stability: lookup.srs_stability,
          difficulty: lookup.srs_difficulty,
          lastReview: lookup.srs_last_review,
          reps: lookup.srs_reps,
          lapses: lookup.srs_lapses,
        }
      : {
          state: lookup.active_srs_state,
          due: lookup.active_srs_due,
          stability: lookup.active_srs_stability,
          difficulty: lookup.active_srs_difficulty,
          lastReview: lookup.active_srs_last_review,
          reps: lookup.active_srs_reps,
          lapses: lookup.active_srs_lapses,
        }

  // applyRating seeds null-state rows via createEmptyCard, then FSRS transitions
  // them. applyFsrsResultForPool overwrites the pool's srs columns;
  // added_to_practice_at (stamped by the guard) is left untouched.
  const result = applyRating(lookup, rating, new Date(), pool)

  // Leech detection, computed (pure) BEFORE the write so the event records
  // caused_parking. The park write itself stays a separate post-commit write —
  // same exposure as the historical FSRS-then-park ordering (a tiny
  // event-says-parked-but-park-write-failed window, reconcilable).
  const parked = shouldParkLeech(lookup, result, pool)

  await deps.withTransaction(async (tx) => {
    await deps.userLookupsRepository.applyFsrsResultForPool(
      {
        userLookupId: lookup.id,
        pool,
        state: result.state,
        due: result.due,
        stability: result.stability,
        difficulty: result.difficulty,
        lastReview: result.lastReview,
        reps: result.reps,
        lapses: result.lapses,
      },
      tx
    )
    await deps.practiceRatingEventsRepository.insert(
      {
        userId,
        userLookupId: lookup.id,
        targetLanguage: lookup.target_language,
        pool,
        rating,
        wasExplicit: params.wasExplicit ?? true,
        wasIntroduction: introducedNew,
        causedParking: parked,
        practiceTextId: params.practiceTextId ?? null,
        headword: lookup.headword,
        sense: lookup.sense ?? '',
        prevSrsState: prev.state,
        prevSrsDue: prev.due,
        prevSrsStability: prev.stability,
        prevSrsDifficulty: prev.difficulty,
        prevSrsLastReview: prev.lastReview,
        prevSrsReps: prev.reps,
        prevSrsLapses: prev.lapses,
      },
      tx
    )
  })

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
// card without applying FSRS. `bypassDailyCap` carries the explicit learn-new
// session intent through to the introduction guard.
export const rateTerm = async (
  userLookupId: string,
  userId: string,
  rating: AppRating,
  pool: PracticePool,
  maxNewTerms: number,
  deps: RateTermDependencies,
  options?: { bypassDailyCap?: boolean }
): Promise<RateTermResult> => {
  const lookup = await deps.userLookupsRepository.findByIdForUser(userLookupId, userId)
  if (!lookup) return { ok: false, reason: 'lookup_not_found' }

  const result = await applyTermRating({
    lookup,
    userId,
    rating,
    pool,
    maxNewTerms,
    bypassDailyCap: options?.bypassDailyCap ?? false,
    deps,
  })
  if (!result.ok && result.reason === 'not_in_active_pool') return { ok: false, reason: 'not_in_active_pool' }
  if (!result.ok) return { ok: true, introducedNew: false, dailyCapReached: true, parked: false }
  return { ok: true, introducedNew: result.introducedNew, dailyCapReached: false, parked: result.parked }
}
