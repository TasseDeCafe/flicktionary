import type postgres from 'postgres'
import { sql } from '../postgres-client'
import { Tables, Database } from '../database.public.types'
import type { PracticePool } from '../user-lookups/user-lookups-repository'

export type DbPracticeRatingEvent = Tables<'practice_rating_events'>
type SrsState = Database['public']['Enums']['srs_state']

export type InsertRatingEventInput = {
  userId: string
  userLookupId: string
  targetLanguage: string
  pool: PracticePool
  rating: 'again' | 'hard' | 'good' | 'easy'
  // false = implicit 'good' applied on a reading-text advance.
  wasExplicit: boolean
  // The term was state-NULL in this pool at rating time.
  wasIntroduction: boolean
  // This rating crossed the leech threshold and parked the term.
  causedParking: boolean
  // Reading-mode context; null for flashcard ratings.
  practiceTextId: string | null
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
      rating,
      was_explicit,
      was_introduction,
      caused_parking,
      practice_text_id,
      headword,
      sense,
      prev_srs_state,
      prev_srs_due,
      prev_srs_stability,
      prev_srs_difficulty,
      prev_srs_last_review,
      prev_srs_reps,
      prev_srs_lapses
    )
    VALUES (
      ${params.userId},
      ${params.userLookupId},
      ${params.targetLanguage},
      ${params.pool},
      ${params.rating},
      ${params.wasExplicit},
      ${params.wasIntroduction},
      ${params.causedParking},
      ${params.practiceTextId},
      ${params.headword},
      ${params.sense},
      ${params.prevSrsState},
      ${params.prevSrsDue},
      ${params.prevSrsStability},
      ${params.prevSrsDifficulty},
      ${params.prevSrsLastReview},
      ${params.prevSrsReps},
      ${params.prevSrsLapses}
    )
    RETURNING id
  `) as Array<{ id: string }>
  return rows[0]!.id
}

// The latest non-reverted event for one (user, lookup, pool) — the only event
// undoRating may revert (its prev_srs_* snapshot describes the CURRENT row
// state; older snapshots are stale). FOR UPDATE serializes concurrent undos of
// the same card: the loser re-reads after the winner's reverted_at stamp and
// sees no live event. The user_id predicate is defense-in-depth — callers
// already resolve the lookup through findByIdForUser.
const findLatestLiveEventForUndo = async (
  params: { userId: string; userLookupId: string; pool: PracticePool },
  executor: postgres.Sql = sql
): Promise<DbPracticeRatingEvent | null> => {
  const rows = (await executor`
    SELECT *
    FROM public.practice_rating_events
    WHERE user_id = ${params.userId}
      AND user_lookup_id = ${params.userLookupId}
      AND pool = ${params.pool}
      AND reverted_at IS NULL
    ORDER BY rated_at DESC
    LIMIT 1
    FOR UPDATE
  `) as DbPracticeRatingEvent[]
  return rows[0] ?? null
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
// - pool filter is required: active events are logged too (for undo), but the
//   active pool has no review budget — without it active ratings would eat the
//   passive allowance.
// - was_introduction = false: introductions consume the NEW budget instead.
// - prev_srs_state IN ('new','review'): only review-state cards charge the
//   budget (same state grouping as listDueSummary's review_due_count);
//   learning/relearning follow-ups are exempt so a failed card's intraday
//   redrill is never stranded until tomorrow. A same-day introduction's later
//   re-reviews are learning-state, so there's no double-charge in practice.
// - DISTINCT user_lookup_id: in-session 'again' redrills of the same card
//   count once.
// - reverted_at IS NULL: undone ratings (task 6) refund their slot.
// - The two-sided CURRENT_DATE window matches the new-card count's shape.
const countReviewBudgetConsumedToday = async (params: {
  userId: string
  targetLanguage: string
  pool: PracticePool
}): Promise<number> => {
  const rows = (await sql`
    SELECT COUNT(DISTINCT user_lookup_id)::int AS consumed
    FROM public.practice_rating_events
    WHERE user_id = ${params.userId}
      AND target_language = ${params.targetLanguage}
      AND pool = ${params.pool}
      AND was_introduction = FALSE
      AND prev_srs_state IN ('new', 'review')
      AND reverted_at IS NULL
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
  const rows = (await sql`
    SELECT target_language, COUNT(DISTINCT user_lookup_id)::int AS consumed
    FROM public.practice_rating_events
    WHERE user_id = ${params.userId}
      AND pool = ${params.pool}
      AND was_introduction = FALSE
      AND prev_srs_state IN ('new', 'review')
      AND reverted_at IS NULL
      AND rated_at >= CURRENT_DATE
      AND rated_at < CURRENT_DATE + INTERVAL '1 day'
    GROUP BY target_language
  `) as Array<{ target_language: string; consumed: number }>
  return new Map(rows.map((row) => [row.target_language, row.consumed]))
}

export interface PracticeRatingEventsRepositoryInterface {
  insert: (params: InsertRatingEventInput, executor?: postgres.Sql) => Promise<string>
  findLatestLiveEventForUndo: (
    params: { userId: string; userLookupId: string; pool: PracticePool },
    executor?: postgres.Sql
  ) => Promise<DbPracticeRatingEvent | null>
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
}

export const PracticeRatingEventsRepository = (): PracticeRatingEventsRepositoryInterface => {
  return {
    insert,
    findLatestLiveEventForUndo,
    markReverted,
    countReviewBudgetConsumedToday,
    countReviewBudgetConsumedTodayByLanguage,
  }
}
