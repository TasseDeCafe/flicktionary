import type postgres from 'postgres'
import { sql } from '../postgres-client'
import { Tables, Database } from '../database.public.types'
import { skillsForPool, type FacetSkill, type PracticePool } from '../study-facets/study-facets-repository'

export type DbPracticeRatingEvent = Tables<'practice_rating_events'>
type SrsState = Database['public']['Enums']['srs_state']

export type InsertRatingEventInput = {
  userId: string
  userLookupId: string
  targetLanguage: string
  // `pool` names the session queue this rating came from; `skill`/`targetForm`
  // are the facet identity (which card was rated). They are distinct namespaces
  // — keep both (Trap 4).
  pool: PracticePool
  skill: FacetSkill
  targetForm: string
  rating: 'again' | 'hard' | 'good' | 'easy'
  // false = implicit 'good' applied on a reading-text advance.
  wasExplicit: boolean
  // The term was state-NULL in this pool at rating time.
  wasIntroduction: boolean
  // This rating crossed the leech threshold and parked the term.
  causedParking: boolean
  // Known-assertion on an onboarding-parked facet: the write unparked it, and
  // the prev_leech_* snapshot lets undo re-park with the exact prior state
  // (incl. partial rehab progress).
  causedUnparking?: boolean
  prevLeechParkedAt?: string | null
  prevLeechRehabCorrectDays?: number | null
  prevLeechRehabLastCorrectOn?: string | null
  // Reading-mode context; null for flashcard ratings.
  practiceTextId: string | null
  // Lesson-import provenance; set only on the implicit 'again' lapses a
  // confirmed import applies. Marked events are excluded from the daily
  // review budget (a big import must not eat the day's allowance).
  importBatchId?: string | null
  // Checkpoint-review provenance: the session the span was read in, and the
  // checkpoint press that batch-applied this event (the batch-undo handle).
  // import_batch_id stays NULL on checkpoint credits, so they count toward
  // the daily review budget.
  studySessionId?: string | null
  checkpointId?: string | null
  // Audit snapshots that survive renames.
  headword: string
  sense: string
  // Pre-rating snapshot of the rated pool's SRS family. All null for an
  // introduction (the row had no state in this pool yet).
  prevSrsState: SrsState | null
  prevSrsDue: string | null
  prevSrsStability: number | null
  prevSrsDifficulty: number | null
  prevSrsLastReview: string | null
  prevSrsReps: number | null
  prevSrsLapses: number | null
  prevSrsLearningSteps: number | null
}

// Append one rating event. `executor` defaults to the pooled connection; pass
// a transaction (beginTx's tx) so the event commits atomically with the FSRS
// column update it describes — the log is the review budget's source of truth,
// so a half-applied rating must not leave the two out of sync.
// Returns the new event's id so the rating response can hand the client an
// undo handle (undoRating verifies it's still the latest live event).
const insert = async (params: InsertRatingEventInput, executor: postgres.Sql = sql): Promise<string> => {
  const rows = (await executor`
    INSERT INTO public.practice_rating_events (
      user_id,
      user_lookup_id,
      target_language,
      pool,
      skill,
      target_form,
      rating,
      was_explicit,
      was_introduction,
      caused_parking,
      caused_unparking,
      prev_leech_parked_at,
      prev_leech_rehab_correct_days,
      prev_leech_rehab_last_correct_on,
      practice_text_id,
      import_batch_id,
      study_session_id,
      checkpoint_id,
      headword,
      sense,
      prev_srs_state,
      prev_srs_due,
      prev_srs_stability,
      prev_srs_difficulty,
      prev_srs_last_review,
      prev_srs_reps,
      prev_srs_lapses,
      prev_srs_learning_steps
    )
    VALUES (
      ${params.userId},
      ${params.userLookupId},
      ${params.targetLanguage},
      ${params.pool},
      ${params.skill},
      ${params.targetForm},
      ${params.rating},
      ${params.wasExplicit},
      ${params.wasIntroduction},
      ${params.causedParking},
      ${params.causedUnparking ?? false},
      ${params.prevLeechParkedAt ?? null},
      ${params.prevLeechRehabCorrectDays ?? null},
      ${params.prevLeechRehabLastCorrectOn ?? null},
      ${params.practiceTextId},
      ${params.importBatchId ?? null},
      ${params.studySessionId ?? null},
      ${params.checkpointId ?? null},
      ${params.headword},
      ${params.sense},
      ${params.prevSrsState},
      ${params.prevSrsDue},
      ${params.prevSrsStability},
      ${params.prevSrsDifficulty},
      ${params.prevSrsLastReview},
      ${params.prevSrsReps},
      ${params.prevSrsLapses},
      ${params.prevSrsLearningSteps}
    )
    RETURNING id
  `) as Array<{ id: string }>
  return rows[0]!.id
}

// The latest non-reverted event for one FACET (user, lookup, skill,
// target_form) — the only event undoRating may revert (its prev_srs_* snapshot
// describes the CURRENT facet state; older snapshots are stale). Keyed on the
// facet identity, NOT pool: once the recognition queue serves multiple facets
// per term, pool would address the wrong card. FOR UPDATE serializes concurrent
// undos of the same facet: the loser re-reads after the winner's reverted_at
// stamp and sees no live event. The user_id predicate is defense-in-depth —
// callers already resolve the lookup through findByIdForUser.
const findLatestLiveEventForUndo = async (
  params: { userId: string; userLookupId: string; skill: FacetSkill; targetForm: string },
  executor: postgres.Sql = sql
): Promise<DbPracticeRatingEvent | null> => {
  const rows = (await executor`
    SELECT *
    FROM public.practice_rating_events
    WHERE user_id = ${params.userId}
      AND user_lookup_id = ${params.userLookupId}
      AND skill = ${params.skill}
      AND target_form = ${params.targetForm}
      AND reverted_at IS NULL
    ORDER BY rated_at DESC
    LIMIT 1
    FOR UPDATE
  `) as DbPracticeRatingEvent[]
  return rows[0] ?? null
}

// All live (non-reverted) events one checkpoint press applied, in one lane:
// wasExplicit=false → the implicit credits (checkpoint undo), true → the
// known-assertion events (assertion undo). The two lanes share checkpoint_id
// but revert independently. Ordered oldest-first for deterministic batch
// processing.
const listLiveEventsForCheckpoint = async (
  params: { checkpointId: string; userId: string; wasExplicit: boolean },
  executor: postgres.Sql = sql
): Promise<DbPracticeRatingEvent[]> => {
  return (await executor`
    SELECT *
    FROM public.practice_rating_events
    WHERE checkpoint_id = ${params.checkpointId}
      AND user_id = ${params.userId}
      AND was_explicit = ${params.wasExplicit}
      AND reverted_at IS NULL
    ORDER BY rated_at ASC, id ASC
  `) as DbPracticeRatingEvent[]
}

// Tombstone an event after its snapshot has been restored. The
// reverted_at IS NULL guard makes a double-undo a no-op; the budget queries'
// reverted_at IS NULL filters refund the slot automatically.
const markReverted = async (
  params: { eventId: string; userId: string },
  executor: postgres.Sql = sql
): Promise<void> => {
  await executor`
    UPDATE public.practice_rating_events
    SET reverted_at = NOW()
    WHERE id = ${params.eventId}
      AND user_id = ${params.userId}
      AND reverted_at IS NULL
  `
}

// How much of today's daily REVIEW budget a (user, language, pool) has spent.
//
// - pool filter via skill set (authoritative, rather than the events' pool
//   column): recognition covers {meaning_recognition, pronunciation};
//   production covers {meaning_production}. Events of the wrong pool must not
//   eat this pool's allowance. pronunciation has no rows until Phase 4 but
//   listing it is correct now.
// - was_introduction = false: introductions consume the NEW budget instead.
// - prev_srs_state IN ('new','review'): only review-state cards charge the
//   budget (same state grouping as listDueSummary's review_due_count);
//   learning/relearning follow-ups are exempt so a failed card's intraday
//   redrill is never stranded until tomorrow. A same-day introduction's later
//   re-reviews are learning-state, so there's no double-charge in practice.
// - COUNT(DISTINCT (user_lookup_id, skill, target_form)): one slot per FACET.
//   caveat-meaning + caveat-pronunciation = 2 slots; in-session 'again'
//   redrills of the SAME facet count once.
// - reverted_at IS NULL: undone ratings refund their slot.
// - The two-sided CURRENT_DATE window matches the new-card count's shape.
const countReviewBudgetConsumedToday = async (params: {
  userId: string
  targetLanguage: string
  pool: PracticePool
}): Promise<number> => {
  const skills = skillsForPool(params.pool)
  const rows = (await sql`
    SELECT COUNT(DISTINCT (user_lookup_id, skill, target_form))::int AS consumed
    FROM public.practice_rating_events
    WHERE user_id = ${params.userId}
      AND target_language = ${params.targetLanguage}
      AND skill = ANY(${skills})
      AND was_introduction = FALSE
      AND prev_srs_state IN ('new', 'review')
      AND reverted_at IS NULL
      AND import_batch_id IS NULL
      AND rated_at >= CURRENT_DATE
      AND rated_at < CURRENT_DATE + INTERVAL '1 day'
  `) as Array<{ consumed: number }>
  return rows[0]?.consumed ?? 0
}

// Per-language variant for the dueSummary handler: one query, not N.
const countReviewBudgetConsumedTodayByLanguage = async (params: {
  userId: string
  pool: PracticePool
}): Promise<Map<string, number>> => {
  const skills = skillsForPool(params.pool)
  const rows = (await sql`
    SELECT target_language, COUNT(DISTINCT (user_lookup_id, skill, target_form))::int AS consumed
    FROM public.practice_rating_events
    WHERE user_id = ${params.userId}
      AND skill = ANY(${skills})
      AND was_introduction = FALSE
      AND prev_srs_state IN ('new', 'review')
      AND reverted_at IS NULL
      AND import_batch_id IS NULL
      AND rated_at >= CURRENT_DATE
      AND rated_at < CURRENT_DATE + INTERVAL '1 day'
    GROUP BY target_language
  `) as Array<{ target_language: string; consumed: number }>
  return new Map(rows.map((row) => [row.target_language, row.consumed]))
}

// "Has ever rated in a live practice session" for the getting-started
// checklist — lesson-import backfill events carry import_batch_id and don't
// count as practicing.
const hasLiveEvent = async (userId: string): Promise<boolean> => {
  const result = (await sql`
    SELECT EXISTS(
      SELECT 1
      FROM public.practice_rating_events
      WHERE user_id = ${userId} AND import_batch_id IS NULL
    ) AS "exists"
  `) as { exists: boolean }[]
  return result[0]?.exists ?? false
}

// Most recent live (non-reverted, non-imported) rating per language — half of
// the due summary's lastPracticedAt (the other half is exercise use, which
// never writes a rating event). Covered by the budget index.
const getLastRatedAtByLanguage = async (userId: string): Promise<Map<string, Date>> => {
  const rows = (await sql`
    SELECT target_language, MAX(rated_at) AS last_rated_at
    FROM public.practice_rating_events
    WHERE user_id = ${userId}
      AND reverted_at IS NULL
      AND import_batch_id IS NULL
    GROUP BY target_language
  `) as Array<{ target_language: string; last_rated_at: Date }>
  return new Map(rows.map((row) => [row.target_language, row.last_rated_at]))
}

export interface PracticeRatingEventsRepositoryInterface {
  insert: (params: InsertRatingEventInput, executor?: postgres.Sql) => Promise<string>
  getLastRatedAtByLanguage: (userId: string) => Promise<Map<string, Date>>
  findLatestLiveEventForUndo: (
    params: { userId: string; userLookupId: string; skill: FacetSkill; targetForm: string },
    executor?: postgres.Sql
  ) => Promise<DbPracticeRatingEvent | null>
  listLiveEventsForCheckpoint: (
    params: { checkpointId: string; userId: string; wasExplicit: boolean },
    executor?: postgres.Sql
  ) => Promise<DbPracticeRatingEvent[]>
  markReverted: (params: { eventId: string; userId: string }, executor?: postgres.Sql) => Promise<void>
  countReviewBudgetConsumedToday: (params: {
    userId: string
    targetLanguage: string
    pool: PracticePool
  }) => Promise<number>
  countReviewBudgetConsumedTodayByLanguage: (params: {
    userId: string
    pool: PracticePool
  }) => Promise<Map<string, number>>
  hasLiveEvent: (userId: string) => Promise<boolean>
}

export const PracticeRatingEventsRepository = (): PracticeRatingEventsRepositoryInterface => {
  return {
    insert,
    getLastRatedAtByLanguage,
    findLatestLiveEventForUndo,
    listLiveEventsForCheckpoint,
    markReverted,
    countReviewBudgetConsumedToday,
    countReviewBudgetConsumedTodayByLanguage,
    hasLiveEvent,
  }
}
