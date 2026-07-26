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
import type { UserTargetLanguagePrefsRepositoryInterface } from '../../transport/database/user-target-language-prefs/user-target-language-prefs-repository'
import { applyRating, type AppRating } from './fsrs'
import { isParked, shouldParkLeech } from './leech-config'
import { bridgeRecognitionFromProduction } from './recognition-bridge'
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
  // Lesson-import provenance for the event row; set only on the implicit
  // 'again' lapses a confirmed import applies (excluded from review budgets).
  importBatchId?: string
  // Checkpoint-review provenance: the session whose span was collected and the
  // checkpoint press batch-applying this credit (the batch-undo handle).
  // importBatchId stays unset on checkpoint credits, so they consume the
  // daily review budget — completed review work replaces flashcard load.
  studySessionId?: string
  checkpointId?: string
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
      // Citation facets of BOTH pools share the combined daily budget.
      const introduced = await deps.studyFacetsRepository.initializeCitationFacetIfUnderDailyCap({
        userLookupId: lookup.id,
        userId,
        targetLanguage: lookup.target_language,
        skill: skill as 'meaning_recognition' | 'meaning_production',
        maxNewTerms,
      })
      if (!introduced) return { ok: false, reason: 'daily_cap_reached' }
    } else {
      // Opt-in pronunciation/form facets: never daily-new-capped — each was
      // individually enabled, so the first rating must NOT be refused by the
      // cap guard (Trap 18). Initialize unconditionally.
      await deps.studyFacetsRepository.initializeFacet({ userLookupId: lookup.id, skill, targetForm })
    }
  }

  // Everything downstream of the introduction guard runs on a freshly LOCKED
  // facet row: the facet row lock is the serialization point shared by every
  // SRS writer (flashcard ratings, checkpoint batch credits, the undo paths).
  // Computing FSRS from the row the caller handed in would let a rating that
  // committed in between be silently overwritten from a stale snapshot — the
  // checkpoint collector's LLM passes leave a seconds-wide window.
  const outcome = await deps.withTransaction(async (tx) => {
    const freshFacet = await deps.studyFacetsRepository.getFacetForUpdate(
      { userLookupId: lookup.id, skill, targetForm },
      tx
    )
    // Facet row gone (the lookup was deleted concurrently): nothing to rate.
    if (!freshFacet) return { applied: false as const, parked: false }
    const fresh = mergeFacet(lookup, freshFacet)
    // Re-check parking on the locked row — a leech-park or warm-up entry that
    // landed while we waited on the lock must keep the facet frozen.
    if (isParked(fresh)) return { applied: false as const, parked: true }

    // Whether THIS rating is the introduction: the caller saw a NULL state and
    // the guard ran, and no concurrent rating slipped in ahead of our lock
    // (reps would be > 0). Drives the event's was_introduction and the NULL
    // prev snapshot below.
    const wasIntroduction = introducedNew && fresh.srs_reps === 0

    // Pre-rating snapshot of the facet's SRS family. For an introduction the
    // guard has already stamped the row 'new', but the restore target a future
    // undo needs is the pre-guard NULL family. Otherwise snapshot the locked
    // row, so the snapshot always describes the state this rating actually
    // transitioned from.
    const prev = wasIntroduction
      ? {
          state: null,
          due: null,
          stability: null,
          difficulty: null,
          lastReview: null,
          reps: 0,
          lapses: 0,
          learningSteps: 0,
        }
      : {
          state: fresh.srs_state,
          due: fresh.srs_due,
          stability: fresh.srs_stability,
          difficulty: fresh.srs_difficulty,
          lastReview: fresh.srs_last_review,
          reps: fresh.srs_reps,
          lapses: fresh.srs_lapses,
          learningSteps: fresh.srs_learning_steps,
        }

    // applyRating seeds null-state facets via createEmptyCard, then FSRS
    // transitions them (a just-introduced 'new' row with empty FSRS fields
    // maps to the same empty card). applyFsrsResultForFacet overwrites the
    // facet's srs columns; introduced_at (stamped by the guard) is untouched.
    const result = applyRating(fresh, rating, new Date())

    // Leech detection, computed (pure) BEFORE the write so the event records
    // caused_parking. The park write itself stays a separate post-commit
    // write — same exposure as the historical FSRS-then-park ordering (a tiny
    // event-says-parked-but-park-write-failed window, reconcilable).
    const parked = shouldParkLeech(fresh, result)

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
        learningSteps: result.learningSteps,
      },
      tx
    )
    const eventId = await deps.practiceRatingEventsRepository.insert(
      {
        userId,
        userLookupId: lookup.id,
        targetLanguage: lookup.target_language,
        pool,
        skill,
        targetForm,
        rating,
        wasExplicit: params.wasExplicit ?? true,
        wasIntroduction,
        causedParking: parked,
        practiceTextId: params.practiceTextId ?? null,
        importBatchId: params.importBatchId ?? null,
        studySessionId: params.studySessionId ?? null,
        checkpointId: params.checkpointId ?? null,
        headword: lookup.headword,
        sense: lookup.sense ?? '',
        prevSrsState: prev.state,
        prevSrsDue: prev.due,
        prevSrsStability: prev.stability,
        prevSrsDifficulty: prev.difficulty,
        prevSrsLastReview: prev.lastReview,
        prevSrsReps: prev.reps,
        prevSrsLapses: prev.lapses,
        prevSrsLearningSteps: prev.learningSteps,
      },
      tx
    )
    return { applied: true as const, parked, wasIntroduction, eventId }
  })

  if (!outcome.applied) return { ok: true, introducedNew: false, parked: outcome.parked, eventId: null }
  const { parked, wasIntroduction, eventId } = outcome

  if (parked) {
    await deps.studyFacetsRepository.parkLeechFacet({ userLookupId: lookup.id, skill, targetForm })
  }

  // Pre-warm the exercise bank in the background: a freshly parked leech needs
  // its gate exercises, and a struggling (again/hard) term feeds the
  // post-session Strengthen list.
  if (parked || rating === 'again' || rating === 'hard') {
    deps.warmExerciseBank?.({ lookup, pool })
  }

  // A correct citation-production answer also credits the recognition sibling
  // (see recognition-bridge.ts) — every production rating surface routes
  // through here (flashcards, production reading advances), so this is the
  // single hook point. Failures propagate nothing: missing a production isn't
  // evidence the user can't recognize. Best-effort: the production rating has
  // already committed above, so a bridge error must not fail the endpoint
  // (a client retry would double-apply the rating) — the next production
  // good/easy re-derives the credit anyway. Awaited (not fire-and-forget) so
  // an immediately following undo can never interleave with an in-flight
  // bridge write.
  if (skill === 'meaning_production' && targetForm === CITATION_FORM && (rating === 'good' || rating === 'easy')) {
    try {
      await bridgeRecognitionFromProduction({ lookup, deps })
    } catch (err) {
      console.error('recognition bridge threw', { userLookupId: lookup.id, err })
    }
  }

  return { ok: true, introducedNew: wasIntroduction, parked, eventId }
}

export type RateTermResult =
  | { ok: true; introducedNew: boolean; dailyCapReached: boolean; parked: boolean; eventId: string | null }
  | { ok: false; reason: 'lookup_not_found' | 'not_in_production_pool' | 'illegal_pool_skill' }

// Flashcard-mode single-card rating. The wire carries `pool` (the session queue
// the rating came from) plus `skill`/`targetForm` (which facet was rated); the
// queue can serve more than one facet per term, so identity is no longer
// derivable from pool. Daily-cap refusal is surfaced (not an error) so the
// client drops the card without applying FSRS.
export const rateTerm = async (
  userLookupId: string,
  userId: string,
  rating: AppRating,
  pool: PracticePool,
  skill: FacetSkill,
  targetForm: string,
  deps: RateTermDependencies
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
  // double-count). Both pools' citation intros consume the combined budget.
  const maxNewTerms = clampPracticeSessionLimits(
    await deps.userTargetLanguagePrefsRepository.getPracticeLimitsForLanguage(userId, lookup.target_language)
  ).maxNewTerms

  const result = await applyTermRating({
    lookup: facetRow,
    userId,
    rating,
    pool,
    maxNewTerms,
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
