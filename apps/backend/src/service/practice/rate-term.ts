import type postgres from 'postgres'
import {
  mergeFacet,
  type DbUserLookup,
  type DbUserLookupWithFacet,
  type PracticePool,
  type UserLookupsRepositoryInterface,
} from '../../transport/database/user-lookups/user-lookups-repository'
import {
  CITATION_FORM,
  isDailyNewCappedFacet,
  isLegalPoolSkill,
  type FacetSkill,
  type StudyFacetsRepositoryInterface,
} from '../../transport/database/study-facets/study-facets-repository'
import type { PracticeRatingEventsRepositoryInterface } from '../../transport/database/practice-rating-events/practice-rating-events-repository'
import {
  HARD_MAX_PRACTICE_NEW_TERMS,
  type UserTargetLanguagePrefsRepositoryInterface,
} from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import { applyRating, type AppRating } from './fsrs'
import { isParked, shouldParkLeech } from './leech-config'
import { clampPracticeSessionLimits } from './review-caps'

// Runs `fn` inside one DB transaction and hands it the executor to thread into
// repo methods that accept one. Wired from postgres-client's beginTx; unit
// tests fake it as `(fn) => fn(undefined as never)`.
export type WithTransaction = <T>(fn: (tx: postgres.Sql) => Promise<T>) => Promise<T>

export type RateTermDependencies = {
  userLookupsRepository: UserLookupsRepositoryInterface
  studyFacetsRepository: StudyFacetsRepositoryInterface
  practiceRatingEventsRepository: PracticeRatingEventsRepositoryInterface
  // Per-language daily-new limit source for rateTerm (the language is only
  // known once the lookup row loads). applyTermRating itself takes the
  // resolved maxNewTerms — advanceReadingText computes its own.
  userTargetLanguagePrefsRepository: UserTargetLanguagePrefsRepositoryInterface
  withTransaction: WithTransaction
  // Optional fire-and-forget exercise-bank warmer. Both rating surfaces
  // (flashcards via rateTerm, reading via advanceReadingText) share
  // applyTermRating, so wiring it here covers again/hard triggers in both
  // render modes. Absent in unit tests and callers that don't care.
  warmExerciseBank?: (params: { lookup: DbUserLookup; pool: PracticePool }) => void
}

// `eventId` is the logged practice_rating_events row — the undo handle the
// client passes back to undoRating. Null exactly when nothing was applied
// (the parked stale-queue no-op), so the client knows there's nothing to undo.
export type ApplyTermRatingResult =
  | { ok: true; introducedNew: boolean; parked: boolean; eventId: string | null }
  | { ok: false; reason: 'daily_cap_reached' }

// Apply one rating event to a user_lookup in the given pool. Shared by the
// flashcard reviewer (rateTerm) and the reading-text finalizer
// (advanceReadingText) so both introduce/grade terms identically.
//
// New-term introductions (state IS NULL) are gated at introduction time:
//   - recognition: the atomic daily-cap guard stamps the row only if the day's
//     introduced count is still under maxNewTerms. Refusal => no FSRS applied,
//     the caller drops the term (flashcard) or leaves it new (reading).
//     `bypassDailyCap` (an explicit learn-new session) skips only the count
//     predicate — the row is still stamped, so it counts toward today.
//   - production: not daily-capped — initialize unconditionally.
// Already-scheduled terms skip the guard entirely.
//
// Every APPLIED rating also appends a practice_rating_events row in the same
// transaction as the FSRS write — the log is the daily review budget's source
// of truth, so a half-applied rating must not re-open the refill bug. No event
// on cap-refusal, parked no-op, or not-in-production-pool (nothing was applied).
//
// Known, accepted partial-failure window: the recognition introduction guard runs
// in its OWN advisory-lock transaction. If the guard stamps the row and the
// FSRS+event tx then fails, the card shows up due ('new', due now) and
// self-heals on the next rating (which logs its event then); the consumed
// new-budget slot is correct since the introduction did happen, and there's no
// event to undo because no FSRS result was applied. Same risk window as the
// pre-event-log code.
export const applyTermRating = async (params: {
  // The term joined with the facet being rated (the pool's citation skill).
  // The callers build it via mergeFacet so the facet is
  // guaranteed to exist and carries the SRS/leech state to read.
  lookup: DbUserLookupWithFacet
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
  const skill = lookup.skill
  const targetForm = lookup.target_form
  if (isParked(lookup)) {
    // Stale queues can outlive parking: an old flashcard tab or an already
    // generated reading text may still submit a rating after the facet left
    // rotation. Parked facets must not mutate FSRS until rehab graduates them.
    // No event is logged, so eventId is null — there is nothing to undo.
    return { ok: true, introducedNew: false, parked: true, eventId: null }
  }

  const introducedNew = lookup.srs_state == null

  if (introducedNew) {
    if (isDailyNewCappedFacet(skill, targetForm)) {
      // The citation recognition facet is the ONLY daily-new-capped facet.
      const introduced = await deps.studyFacetsRepository.initializeCitationFacetIfUnderDailyCap({
        userLookupId: lookup.id,
        userId,
        targetLanguage: lookup.target_language,
        maxNewTerms,
        bypassCap: params.bypassDailyCap ?? false,
      })
      if (!introduced) return { ok: false, reason: 'daily_cap_reached' }
    } else {
      // Production citation, and (Phase 4) opt-in pronunciation/form facets:
      // never daily-new-capped, so the first rating must NOT be refused by the
      // cap guard (Trap 18). Initialize unconditionally.
      await deps.studyFacetsRepository.initializeFacet({ userLookupId: lookup.id, skill, targetForm })
    }
  }

  // Pre-rating snapshot of the facet's SRS family, taken from the merged row
  // BEFORE applyRating (which reads but never mutates it). For an introduction
  // the in-memory row still has its pre-guard NULL state — exactly the restore
  // target a future undo needs.
  const prev = {
    state: lookup.srs_state,
    due: lookup.srs_due,
    stability: lookup.srs_stability,
    difficulty: lookup.srs_difficulty,
    lastReview: lookup.srs_last_review,
    reps: lookup.srs_reps,
    lapses: lookup.srs_lapses,
  }

  // applyRating seeds null-state facets via createEmptyCard, then FSRS
  // transitions them. applyFsrsResultForFacet overwrites the facet's srs
  // columns; introduced_at (stamped by the guard) is left untouched.
  const result = applyRating(lookup, rating, new Date())

  // Leech detection, computed (pure) BEFORE the write so the event records
  // caused_parking. The park write itself stays a separate post-commit write —
  // same exposure as the historical FSRS-then-park ordering (a tiny
  // event-says-parked-but-park-write-failed window, reconcilable).
  const parked = shouldParkLeech(lookup, result)

  const eventId = await deps.withTransaction(async (tx) => {
    await deps.studyFacetsRepository.applyFsrsResultForFacet(
      {
        userLookupId: lookup.id,
        skill,
        targetForm,
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
    return await deps.practiceRatingEventsRepository.insert(
      {
        userId,
        userLookupId: lookup.id,
        targetLanguage: lookup.target_language,
        pool,
        skill,
        targetForm,
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
    await deps.studyFacetsRepository.parkLeechFacet({ userLookupId: lookup.id, skill, targetForm })
  }

  // Pre-warm the exercise bank in the background: a freshly parked leech needs
  // its gate exercises, and a struggling (again/hard) term feeds the
  // post-session Strengthen list.
  if (parked || rating === 'again' || rating === 'hard') {
    deps.warmExerciseBank?.({ lookup, pool })
  }

  return { ok: true, introducedNew, parked, eventId }
}

export type RateTermResult =
  | { ok: true; introducedNew: boolean; dailyCapReached: boolean; parked: boolean; eventId: string | null }
  | { ok: false; reason: 'lookup_not_found' | 'not_in_production_pool' | 'illegal_pool_skill' }

// Flashcard-mode single-card rating. The wire carries `pool` (the session queue
// the rating came from) plus `skill`/`targetForm` (which facet was rated); the
// queue can serve more than one facet per term, so identity is no longer
// derivable from pool. Daily-cap refusal is surfaced (not an error) so the
// client drops the card without applying FSRS. `bypassDailyCap` carries the
// explicit learn-new session intent through to the introduction guard.
export const rateTerm = async (
  userLookupId: string,
  userId: string,
  rating: AppRating,
  pool: PracticePool,
  skill: FacetSkill,
  targetForm: string,
  deps: RateTermDependencies,
  options?: { bypassDailyCap?: boolean }
): Promise<RateTermResult> => {
  // Reject illegal (pool, skill) pairings (e.g. production + pronunciation)
  // before touching any state — pool and skill are distinct namespaces.
  if (!isLegalPoolSkill(pool, skill)) return { ok: false, reason: 'illegal_pool_skill' }

  const lookup = await deps.userLookupsRepository.findByIdForUser(userLookupId, userId)
  if (!lookup) return { ok: false, reason: 'lookup_not_found' }

  // Load the facet being rated. The citation recognition facet is created
  // eagerly on keep; repair it defensively here so any count>0 term lacking it
  // can still be rated. Every other facet must already have been enabled (it is
  // NOT auto-created); a missing one means the card isn't enrolled (treat as not
  // in pool rather than 500).
  if (skill === 'meaning_recognition' && targetForm === CITATION_FORM) {
    await deps.studyFacetsRepository.ensureCitationFacet(lookup.id)
  }
  const facet = await deps.studyFacetsRepository.getFacet({ userLookupId: lookup.id, skill, targetForm })
  if (!facet) return { ok: false, reason: 'not_in_production_pool' }
  // Production-pool membership is now the production citation facet being
  // ENABLED (replaces the dropped learning_mode column). A disabled (demoted)
  // facet is not in the production pool — reject rather than re-rate a demoted
  // term.
  if (pool === 'production' && facet.disabled_at !== null) return { ok: false, reason: 'not_in_production_pool' }
  const facetRow = mergeFacet(lookup, facet)

  // Pass the FULL clamped per-language daily cap: the atomic guard does its
  // own today-count comparison against it (subtracting here would
  // double-count). The production pool isn't daily-capped, so skip the fetch.
  const maxNewTerms =
    pool === 'production'
      ? HARD_MAX_PRACTICE_NEW_TERMS
      : clampPracticeSessionLimits(
          await deps.userTargetLanguagePrefsRepository.getPracticeLimitsForLanguage(userId, lookup.target_language)
        ).maxNewTerms

  const result = await applyTermRating({
    lookup: facetRow,
    userId,
    rating,
    pool,
    maxNewTerms,
    bypassDailyCap: options?.bypassDailyCap ?? false,
    deps,
  })
  if (!result.ok) return { ok: true, introducedNew: false, dailyCapReached: true, parked: false, eventId: null }
  return {
    ok: true,
    introducedNew: result.introducedNew,
    dailyCapReached: false,
    parked: result.parked,
    eventId: result.eventId,
  }
}
