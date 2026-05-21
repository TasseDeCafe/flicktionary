import postgres from 'postgres'
import { sql } from '../postgres-client'
import { Tables, Database } from '../database.public.types'
import type { PracticePool } from '../user-lookups/user-lookups-repository'

export type DbPracticeText = Tables<'practice_texts'>
export type PracticeTextStatus = Database['public']['Enums']['practice_text_status']

export type PracticeAnnotation = {
  headword: string
  sense: string
  surfaceForm: string
  charStart: number
  charEnd: number
}

export type PracticeSkippedChunk = {
  headword: string
  sense: string
  reason: string
}

// Stale-slot recovery threshold. Workers are expected to finish in well under
// this; pre-gen slots that age past it without making it to 'ready' are
// considered crashed/abandoned and the next caller can fence them off.
const STALE_SLOT_SECONDS = 60

const insertPending = async (params: { practiceSessionId: string; ord: number }): Promise<DbPracticeText> => {
  const result = (await sql`
    INSERT INTO public.practice_texts (practice_session_id, ord, status)
    VALUES (${params.practiceSessionId}, ${params.ord}, 'pending')
    RETURNING *
  `) as DbPracticeText[]
  return result[0]!
}

// Atomically transition pending -> generating and return the freshly minted
// fencing token. The token is bound to the worker that wins this update;
// markReady / markFailed verify it before persisting their result. Callers
// that lose the race (because takeover already moved the slot) get null.
const claimGenerating = async (id: string): Promise<{ token: string } | null> => {
  const result = (await sql`
    UPDATE public.practice_texts
    SET status = 'generating',
        generation_token = gen_random_uuid()
    WHERE id = ${id} AND status = 'pending'
    RETURNING generation_token
  `) as Array<{ generation_token: string }>
  const row = result[0]
  if (!row) return null
  return { token: row.generation_token }
}

const markReady = async (params: {
  id: string
  token: string
  body: string
  annotations: PracticeAnnotation[]
  skippedChunks: PracticeSkippedChunk[]
  generationWarning: string | null
}): Promise<DbPracticeText | null> => {
  const annotationsJson = sql.json(
    params.annotations.map((a) => ({
      headword: a.headword,
      sense: a.sense,
      surface_form: a.surfaceForm,
      char_start: a.charStart,
      char_end: a.charEnd,
    })) as unknown as postgres.JSONValue
  )
  const skippedJson = sql.json(params.skippedChunks as unknown as postgres.JSONValue)
  const result = (await sql`
    UPDATE public.practice_texts
    SET status = 'ready',
        body = ${params.body},
        annotations = ${annotationsJson}::jsonb,
        skipped_chunks = ${skippedJson}::jsonb,
        generation_warning = ${params.generationWarning},
        ready_at = NOW()
    WHERE id = ${params.id}
      AND status = 'generating'
      AND generation_token = ${params.token}::uuid
    RETURNING *
  `) as DbPracticeText[]
  return result[0] ?? null
}

const markFailed = async (params: { id: string; token: string | null; warning: string }): Promise<void> => {
  if (params.token != null) {
    await sql`
      UPDATE public.practice_texts
      SET status = 'failed', generation_warning = ${params.warning}
      WHERE id = ${params.id}
        AND generation_token = ${params.token}::uuid
        AND status IN ('pending', 'generating')
    `
    return
  }
  // Token-less failure: used by the takeover path to mark a stale slot
  // failed without holding ownership. The original worker's eventual write
  // is then fenced out by the gen_random_uuid() on its prior claim.
  await sql`
    UPDATE public.practice_texts
    SET status = 'failed', generation_warning = ${params.warning}
    WHERE id = ${params.id}
      AND status IN ('pending', 'generating')
  `
}

const markReading = async (id: string): Promise<DbPracticeText | null> => {
  const updated = (await sql`
    UPDATE public.practice_texts
    SET status = 'reading'
    WHERE id = ${id} AND status = 'ready'
    RETURNING *
  `) as DbPracticeText[]
  if (updated[0]) return updated[0]

  const existing = (await sql`
    SELECT *
    FROM public.practice_texts
    WHERE id = ${id} AND status = 'reading'
    LIMIT 1
  `) as DbPracticeText[]
  return existing[0] ?? null
}

const markDone = async (id: string): Promise<DbPracticeText | null> => {
  const result = (await sql`
    UPDATE public.practice_texts
    SET status = 'done', read_at = NOW()
    WHERE id = ${id} AND status IN ('ready', 'reading')
    RETURNING *
  `) as DbPracticeText[]
  return result[0] ?? null
}

const findById = async (id: string): Promise<DbPracticeText | null> => {
  const result = (await sql`
    SELECT * FROM public.practice_texts WHERE id = ${id}
  `) as DbPracticeText[]
  return result[0] ?? null
}

// Ownership-checked fetch: joins through practice_sessions to verify user_id
// and to carry the session's pool tag so the rating layer can advance the
// correct SRS column family.
const findByIdForUser = async (
  id: string,
  userId: string
): Promise<{
  practiceText: DbPracticeText
  practiceSessionId: string
  targetLanguage: string
  pool: PracticePool
} | null> => {
  const result = (await sql`
    SELECT pt.*,
           ps.target_language AS session_target_language,
           ps.user_id AS session_user_id,
           ps.pool AS session_pool
    FROM public.practice_texts pt
    JOIN public.practice_sessions ps ON ps.id = pt.practice_session_id
    WHERE pt.id = ${id} AND ps.user_id = ${userId}
  `) as Array<DbPracticeText & { session_target_language: string; session_user_id: string; session_pool: string }>
  const row = result[0]
  if (!row) return null
  const { session_target_language, session_user_id, session_pool, ...practiceText } = row as DbPracticeText & {
    session_target_language: string
    session_user_id: string
    session_pool: string
  }
  void session_user_id
  return {
    practiceText: practiceText as DbPracticeText,
    practiceSessionId: practiceText.practice_session_id,
    targetLanguage: session_target_language,
    pool: session_pool as PracticePool,
  }
}

const listBySessionId = async (practiceSessionId: string): Promise<DbPracticeText[]> => {
  return (await sql`
    SELECT *
    FROM public.practice_texts
    WHERE practice_session_id = ${practiceSessionId}
    ORDER BY ord ASC
  `) as DbPracticeText[]
}

// Atomically pick the row to surface to the user and (if needed) flip it from
// 'ready' to 'reading' so closing & re-opening the modal — or hitting the
// session via a second tab — sees the in-progress text rather than a
// pre-generated successor at a higher ord.
//
// Selection rules:
//   1. If a 'reading' row exists for this session, return it as-is (only one
//      can exist; enforced by at_most_one_reading_per_session).
//   2. Otherwise the lowest-ord 'ready' row gets promoted to 'reading' in a
//      single atomic UPDATE keyed on status='ready', and the returned row is
//      the post-update one.
const selectAndMarkReading = async (practiceSessionId: string): Promise<DbPracticeText | null> => {
  await sql`
    UPDATE public.practice_texts
    SET status = 'failed',
        generation_warning = COALESCE(generation_warning, 'readable text had no usable annotations')
    WHERE practice_session_id = ${practiceSessionId}
      AND status IN ('ready', 'reading')
      AND jsonb_array_length(annotations) = 0
  `

  const existing = (await sql`
    SELECT *
    FROM public.practice_texts
    WHERE practice_session_id = ${practiceSessionId}
      AND status = 'reading'
    LIMIT 1
  `) as DbPracticeText[]
  if (existing[0]) return existing[0]

  const result = (await sql`
    UPDATE public.practice_texts
    SET status = 'reading'
    WHERE id = (
      SELECT id
      FROM public.practice_texts
      WHERE practice_session_id = ${practiceSessionId}
        AND status = 'ready'
      ORDER BY ord ASC
      LIMIT 1
    )
    RETURNING *
  `) as DbPracticeText[]
  return result[0] ?? null
}

const getNextOrd = async (practiceSessionId: string): Promise<number> => {
  const result = await sql`
    SELECT COALESCE(MAX(ord), -1) + 1 AS next_ord
    FROM public.practice_texts
    WHERE practice_session_id = ${practiceSessionId}
  `
  return (result[0]?.next_ord as number) ?? 0
}

export type ReservedSlot = {
  practiceText: DbPracticeText
  isFresh: boolean
}

// Reserve the "next" slot for this session, or return the slot already
// reserved if one exists. Wraps the lookup-or-insert in a per-session
// advisory lock so two concurrent callers (foreground generateNextText +
// background prepareNextText) can't collide on the (session, ord) unique
// constraint or insert duplicate slots.
//
// "Already reserved" means: a row at ord > the highest done/reading ord
// exists in status pending/generating/ready. If we find one but it's stuck
// (pending/generating older than STALE_SLOT_SECONDS), we mark it failed and
// reserve a fresh slot at the next ord. The original worker's eventual write
// is no-oped via the generation_token check.
//
// `isFresh` is true when the caller is responsible for kicking off the
// generation work for this slot. False means the slot is an existing
// pending/generating/ready row the caller can poll or return to the user.
const reserveOrFindNextSlot = async (practiceSessionId: string): Promise<ReservedSlot> => {
  return await sql.begin(async (tx) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    await (tx as any)`
      SELECT pg_advisory_xact_lock(hashtext(${practiceSessionId}))
    `

    const anchorRows = (await (tx as any)`
      SELECT COALESCE(MAX(ord), -1) AS anchor_ord
      FROM public.practice_texts
      WHERE practice_session_id = ${practiceSessionId}
        AND status IN ('reading', 'done')
    `) as Array<{ anchor_ord: number }>
    const anchorOrd = anchorRows[0]?.anchor_ord ?? -1

    const candidate = (await (tx as any)`
      SELECT *
      FROM public.practice_texts
      WHERE practice_session_id = ${practiceSessionId}
        AND status IN ('pending', 'generating', 'ready')
        AND ord > ${anchorOrd}
      ORDER BY ord ASC
      LIMIT 1
    `) as DbPracticeText[]

    const existing = candidate[0]
    if (existing) {
      if (existing.status === 'ready' && (!Array.isArray(existing.annotations) || existing.annotations.length === 0)) {
        await (tx as any)`
          UPDATE public.practice_texts
          SET status = 'failed',
              generation_warning = COALESCE(generation_warning, 'ready text had no usable annotations')
          WHERE id = ${existing.id}
            AND status = 'ready'
        `
      } else if (
        (existing.status === 'pending' || existing.status === 'generating') &&
        Date.now() - new Date(existing.created_at).getTime() > STALE_SLOT_SECONDS * 1000
      ) {
        // Stale. Fence it off by flipping to 'failed' (token-less, see
        // markFailed), then fall through to reserve a fresh slot at next
        // ord. The previous worker's markReady will fail its token check
        // and silently no-op.
        await (tx as any)`
          UPDATE public.practice_texts
          SET status = 'failed',
              generation_warning = COALESCE(generation_warning, 'stale slot reclaimed')
          WHERE id = ${existing.id}
            AND status IN ('pending', 'generating')
        `
      } else {
        return { practiceText: existing, isFresh: false }
      }
    }

    const nextOrdRows = (await (tx as any)`
      SELECT COALESCE(MAX(ord), -1) + 1 AS next_ord
      FROM public.practice_texts
      WHERE practice_session_id = ${practiceSessionId}
    `) as Array<{ next_ord: number }>
    const nextOrd = nextOrdRows[0]?.next_ord ?? 0

    const inserted = (await (tx as any)`
      INSERT INTO public.practice_texts (practice_session_id, ord, status)
      VALUES (${practiceSessionId}, ${nextOrd}, 'pending')
      RETURNING *
    `) as DbPracticeText[]
    /* eslint-enable @typescript-eslint/no-explicit-any */

    return { practiceText: inserted[0]!, isFresh: true }
  })
}

// Atomic finalize gate: only the caller who flips the row from 'ready' or
// 'reading' to 'done' owns the implicit-rating insert. Returns the
// post-update row if we won, null if another caller already finalized.
const claimFinalize = async (id: string): Promise<DbPracticeText | null> => {
  const result = (await sql`
    UPDATE public.practice_texts
    SET status = 'done', read_at = NOW()
    WHERE id = ${id} AND status IN ('ready', 'reading')
    RETURNING *
  `) as DbPracticeText[]
  return result[0] ?? null
}

// Returns the union of (headword, sense) pairs already covered by any
// user-visible practice_text in this session. Pre-generated 'ready' rows are
// deliberately excluded: they have not been shown to the user yet, and
// counting them here can make the foreground path complete the session before
// surfacing the queued text.
const getCoveredHeadwordSenses = async (
  practiceSessionId: string
): Promise<Array<{ headword: string; sense: string }>> => {
  const result = await sql`
    SELECT DISTINCT
      ann->>'headword' AS headword,
      COALESCE(ann->>'sense', '') AS sense
    FROM public.practice_texts pt,
         jsonb_array_elements(pt.annotations) AS ann
    WHERE pt.practice_session_id = ${practiceSessionId}
      AND pt.status IN ('reading', 'done')
  `
  return result.map((row) => ({
    headword: row.headword as string,
    sense: (row.sense as string) ?? '',
  }))
}

// Returns how many times each (headword, sense) was reported in skipped_chunks
// across all texts in this session. Used to detect "stubborn" chunks the LLM
// can't fit in normal multi-chunk generation, which then get a one-shot
// single-sentence rescue.
const getSkippedChunkCountsForSession = async (
  practiceSessionId: string
): Promise<Array<{ headword: string; sense: string; count: number }>> => {
  const result = await sql`
    SELECT
      sk->>'headword' AS headword,
      COALESCE(sk->>'sense', '') AS sense,
      COUNT(*)::int AS count
    FROM public.practice_texts pt,
         jsonb_array_elements(pt.skipped_chunks) AS sk
    WHERE pt.practice_session_id = ${practiceSessionId}
      AND pt.status IN ('ready', 'reading', 'done')
    GROUP BY headword, sense
  `
  return result.map((row) => ({
    headword: row.headword as string,
    sense: (row.sense as string) ?? '',
    count: row.count as number,
  }))
}

export interface PracticeTextsRepositoryInterface {
  insertPending: (params: { practiceSessionId: string; ord: number }) => Promise<DbPracticeText>
  claimGenerating: (id: string) => Promise<{ token: string } | null>
  markReady: (params: {
    id: string
    token: string
    body: string
    annotations: PracticeAnnotation[]
    skippedChunks: PracticeSkippedChunk[]
    generationWarning: string | null
  }) => Promise<DbPracticeText | null>
  markFailed: (params: { id: string; token: string | null; warning: string }) => Promise<void>
  markReading: (id: string) => Promise<DbPracticeText | null>
  markDone: (id: string) => Promise<DbPracticeText | null>
  findById: (id: string) => Promise<DbPracticeText | null>
  findByIdForUser: (
    id: string,
    userId: string
  ) => Promise<{
    practiceText: DbPracticeText
    practiceSessionId: string
    targetLanguage: string
    pool: PracticePool
  } | null>
  listBySessionId: (practiceSessionId: string) => Promise<DbPracticeText[]>
  selectAndMarkReading: (practiceSessionId: string) => Promise<DbPracticeText | null>
  getNextOrd: (practiceSessionId: string) => Promise<number>
  reserveOrFindNextSlot: (practiceSessionId: string) => Promise<ReservedSlot>
  claimFinalize: (id: string) => Promise<DbPracticeText | null>
  getCoveredHeadwordSenses: (practiceSessionId: string) => Promise<Array<{ headword: string; sense: string }>>
  getSkippedChunkCountsForSession: (
    practiceSessionId: string
  ) => Promise<Array<{ headword: string; sense: string; count: number }>>
}

export const PracticeTextsRepository = (): PracticeTextsRepositoryInterface => {
  return {
    insertPending,
    claimGenerating,
    markReady,
    markFailed,
    markReading,
    markDone,
    findById,
    findByIdForUser,
    listBySessionId,
    selectAndMarkReading,
    getNextOrd,
    reserveOrFindNextSlot,
    claimFinalize,
    getCoveredHeadwordSenses,
    getSkippedChunkCountsForSession,
  }
}
