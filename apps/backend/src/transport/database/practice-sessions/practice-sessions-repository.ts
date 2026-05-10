import { sql } from '../postgres-client'
import { Tables, Database } from '../database.public.types'

export type DbPracticeSession = Tables<'practice_sessions'>
export type PracticeSessionStatus = Database['public']['Enums']['practice_session_status']

export type PracticeSessionInsertResult = {
  session: DbPracticeSession
  resumed: boolean
}

// Atomically: take the partial-unique-index slot for this (user_id,
// target_language) at status='active' (race-safe via INSERT ... ON CONFLICT
// DO NOTHING against `one_active_practice_session_per_user_lang`); if we won,
// snapshot the user's capped practice batch into practice_session_chunks; if
// we lost, fetch the existing active row.
//
// `resumed` is true when the caller is being handed an already-active session.
const insertOrResume = async (params: {
  userId: string
  targetLanguage: string
  maxNewTerms: number
  maxReviewTerms: number
}): Promise<PracticeSessionInsertResult> => {
  return await sql.begin(async (tx) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const inserted = (await (tx as any)`
      INSERT INTO public.practice_sessions (user_id, target_language, max_new_terms, max_review_terms)
      VALUES (${params.userId}, ${params.targetLanguage}, ${params.maxNewTerms}, ${params.maxReviewTerms})
      ON CONFLICT (user_id, target_language) WHERE status = 'active' DO NOTHING
      RETURNING *
    `) as DbPracticeSession[]

    if (inserted.length > 0) {
      const session = inserted[0]!
      // Snapshot the capped batch in the same transaction so the session can
      // never observe its own membership in a half-built state.
      await (tx as any)`
        INSERT INTO public.practice_session_chunks
          (practice_session_id, user_lookup_id, eligible_at_start)
        WITH review_terms AS (
          SELECT ul.id
          FROM public.user_lookups ul
          WHERE ul.user_id = ${params.userId}
            AND ul.target_language = ${params.targetLanguage}
            AND ul.count > 0
            AND ul.deleted_at IS NULL
            AND ul.srs_state IS NOT NULL
            AND ul.srs_due IS NOT NULL
            AND ul.srs_due <= NOW()
          ORDER BY ul.srs_due ASC NULLS LAST, ul.headword ASC, ul.sense ASC
          LIMIT ${params.maxReviewTerms}
        ),
        new_terms AS (
          SELECT ul.id
          FROM public.user_lookups ul
          WHERE ul.user_id = ${params.userId}
            AND ul.target_language = ${params.targetLanguage}
            AND ul.count > 0
            AND ul.deleted_at IS NULL
            AND ul.srs_state IS NULL
          ORDER BY ul.created_at ASC, ul.headword ASC, ul.sense ASC
          LIMIT ${params.maxNewTerms}
        ),
        selected AS (
          SELECT id FROM review_terms
          UNION ALL
          SELECT id FROM new_terms
        )
        SELECT ${session.id}, selected.id, TRUE
        FROM selected
      `
      return { session, resumed: false }
    }

    const existing = (await (tx as any)`
      SELECT *
      FROM public.practice_sessions
      WHERE user_id = ${params.userId}
        AND target_language = ${params.targetLanguage}
        AND status = 'active'
      LIMIT 1
    `) as DbPracticeSession[]
    /* eslint-enable @typescript-eslint/no-explicit-any */

    if (existing.length === 0) {
      throw new Error('practice_sessions: insertOrResume race lost without a resumable row')
    }
    return { session: existing[0]!, resumed: true }
  })
}

const findByIdForUser = async (id: string, userId: string): Promise<DbPracticeSession | null> => {
  const result = (await sql`
    SELECT *
    FROM public.practice_sessions
    WHERE id = ${id} AND user_id = ${userId}
  `) as DbPracticeSession[]
  return result[0] ?? null
}

const findActiveForUser = async (params: {
  userId: string
  targetLanguage: string
}): Promise<DbPracticeSession | null> => {
  const result = (await sql`
    SELECT *
    FROM public.practice_sessions
    WHERE user_id = ${params.userId}
      AND target_language = ${params.targetLanguage}
      AND status = 'active'
    LIMIT 1
  `) as DbPracticeSession[]
  return result[0] ?? null
}

const listRecentByUser = async (userId: string, limit = 20): Promise<DbPracticeSession[]> => {
  return (await sql`
    SELECT *
    FROM public.practice_sessions
    WHERE user_id = ${userId}
    ORDER BY started_at DESC
    LIMIT ${limit}
  `) as DbPracticeSession[]
}

const markCompleted = async (id: string, userId: string): Promise<boolean> => {
  const result = await sql`
    UPDATE public.practice_sessions
    SET status = 'completed', ended_at = NOW()
    WHERE id = ${id} AND user_id = ${userId} AND status = 'active'
  `
  return result.count > 0
}

const markAbandoned = async (id: string, userId: string): Promise<boolean> => {
  const result = await sql`
    UPDATE public.practice_sessions
    SET status = 'abandoned', ended_at = NOW()
    WHERE id = ${id} AND user_id = ${userId} AND status = 'active'
  `
  return result.count > 0
}

// Auto-abandon active sessions older than the cutoff for a (user, language).
// Run before insertOrResume so a user who walked away days ago gets a fresh
// session instead of an indefinitely-stale one.
const abandonStaleForUser = async (params: {
  userId: string
  targetLanguage: string
  olderThanHours: number
}): Promise<number> => {
  const result = await sql`
    UPDATE public.practice_sessions
    SET status = 'abandoned', ended_at = NOW()
    WHERE user_id = ${params.userId}
      AND target_language = ${params.targetLanguage}
      AND status = 'active'
      AND started_at < NOW() - (${params.olderThanHours}::int || ' hours')::interval
  `
  return result.count
}

// Mark a chunk abandoned for this session (LLM hit ABANDON_THRESHOLD on it).
// Idempotent — only stamps abandoned_at the first time.
const markChunkAbandoned = async (params: { practiceSessionId: string; userLookupId: string }): Promise<void> => {
  await sql`
    UPDATE public.practice_session_chunks
    SET abandoned_at = NOW()
    WHERE practice_session_id = ${params.practiceSessionId}
      AND user_lookup_id = ${params.userLookupId}
      AND abandoned_at IS NULL
  `
}

// Session-progress numerator + denominator. Numerator = (latest rating per
// user_lookup_id IN ('hard','good','easy')) + COUNT(abandoned_at NOT NULL).
// Denominator = COUNT(*) WHERE eligible_at_start. Single round-trip: two
// scalars in one row.
const getSessionProgress = async (practiceSessionId: string): Promise<{ completed: number; target: number }> => {
  const result = (await sql`
    WITH latest AS (
      SELECT DISTINCT ON (pr.user_lookup_id)
        pr.user_lookup_id, pr.rating
      FROM public.practice_ratings pr
      JOIN public.practice_texts pt ON pt.id = pr.practice_text_id
      WHERE pt.practice_session_id = ${practiceSessionId}
      ORDER BY pr.user_lookup_id, pr.rated_at DESC, pr.id DESC
    ),
    membership AS (
      SELECT
        COUNT(*) FILTER (WHERE eligible_at_start) AS target,
        COUNT(*) FILTER (WHERE abandoned_at IS NOT NULL) AS abandoned
      FROM public.practice_session_chunks
      WHERE practice_session_id = ${practiceSessionId}
    ),
    rated_done AS (
      SELECT COUNT(*) AS n FROM latest WHERE rating IN ('hard','good','easy')
    )
    SELECT
      (rated_done.n + membership.abandoned)::int AS completed,
      membership.target::int AS target
    FROM rated_done, membership
  `) as Array<{ completed: number; target: number }>
  return { completed: result[0]?.completed ?? 0, target: result[0]?.target ?? 0 }
}

export interface PracticeSessionsRepositoryInterface {
  insertOrResume: (params: {
    userId: string
    targetLanguage: string
    maxNewTerms: number
    maxReviewTerms: number
  }) => Promise<PracticeSessionInsertResult>
  findByIdForUser: (id: string, userId: string) => Promise<DbPracticeSession | null>
  findActiveForUser: (params: { userId: string; targetLanguage: string }) => Promise<DbPracticeSession | null>
  listRecentByUser: (userId: string, limit?: number) => Promise<DbPracticeSession[]>
  markCompleted: (id: string, userId: string) => Promise<boolean>
  markAbandoned: (id: string, userId: string) => Promise<boolean>
  abandonStaleForUser: (params: { userId: string; targetLanguage: string; olderThanHours: number }) => Promise<number>
  markChunkAbandoned: (params: { practiceSessionId: string; userLookupId: string }) => Promise<void>
  getSessionProgress: (practiceSessionId: string) => Promise<{ completed: number; target: number }>
}

export const PracticeSessionsRepository = (): PracticeSessionsRepositoryInterface => {
  return {
    insertOrResume,
    findByIdForUser,
    findActiveForUser,
    listRecentByUser,
    markCompleted,
    markAbandoned,
    abandonStaleForUser,
    markChunkAbandoned,
    getSessionProgress,
  }
}
