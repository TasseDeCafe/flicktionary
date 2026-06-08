import type postgres from 'postgres'
import { sql } from '../postgres-client'
import { Tables, Database } from '../database.public.types'
import type { PracticePool } from '../user-lookups/user-lookups-repository'
import { skillsForReviewMode, type FacetSkill, type ReviewMode } from '../study-facets/study-facets-repository'

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
      skill,
      target_form,
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
      ${params.skill},
      ${params.targetForm},
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

// The latest non-reverted event for one FACET (user, lookup, skill,
// target_form) — the only event undoRating may revert (its prev_srs_* snapshot
// describes the CURRENT facet state; older snapshots are stale). Keyed on the
// facet identity, NOT pool: once the passive queue serves multiple facets per
// term, pool would address the wrong card. FOR UPDATE serializes concurrent
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

// How much of today's daily REVIEW budget a (user, language, mode) has spent.
//
// - mode filter via skill set: caps are per-MODE, not per-pool. recognition
//   covers {meaning_recognition, pronunciation}; production covers
//   {meaning_production}. (Replaces the old pool filter: events of the wrong
//   mode must not eat this mode's allowance.) pronunciation has no rows until
//   Phase 4 but listing it is correct now.
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
  mode: ReviewMode
}): Promise<number> => {
  const skills = skillsForReviewMode(params.mode)
  const rows = (await sql`
    SELECT COUNT(DISTINCT (user_lookup_id, skill, target_form))::int AS consumed
    FROM public.practice_rating_events
    WHERE user_id = ${params.userId}
      AND target_language = ${params.targetLanguage}
      AND skill = ANY(${skills})
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
  mode: ReviewMode
}): Promise<Map<string, number>> => {
  const skills = skillsForReviewMode(params.mode)
  const rows = (await sql`
    SELECT target_language, COUNT(DISTINCT (user_lookup_id, skill, target_form))::int AS consumed
    FROM public.practice_rating_events
    WHERE user_id = ${params.userId}
      AND skill = ANY(${skills})
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
    params: { userId: string; userLookupId: string; skill: FacetSkill; targetForm: string },
    executor?: postgres.Sql
  ) => Promise<DbPracticeRatingEvent | null>
  markReverted: (params: { eventId: string; userId: string }, executor?: postgres.Sql) => Promise<void>
  countReviewBudgetConsumedToday: (params: {
    userId: string
    targetLanguage: string
    mode: ReviewMode
  }) => Promise<number>
  countReviewBudgetConsumedTodayByLanguage: (params: {
    userId: string
    mode: ReviewMode
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
