import postgres from 'postgres'
import { sql, beginTx } from '../postgres-client'
import { Tables, Database } from '../database.public.types'
import type { PracticePool } from '../user-lookups/user-lookups-repository'
import type { ReviewScope } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'

export type DbPracticeText = Tables<'practice_texts'>
export type PracticeTextStatus = Database['public']['Enums']['practice_text_status']

export type PracticeAnnotation = {
  headword: string
  sense: string
  surfaceForm: string
  charStart: number
  charEnd: number
  // The annotated term's user_lookups id, stamped at generation time so the
  // finalizer and serve-time content resolution survive a mid-text rename of
  // the (headword, sense) key. Null on texts stored before ids were stamped;
  // readers fall back to the key for those.
  userLookupId: string | null
}

export type PracticeSkippedChunk = {
  headword: string
  sense: string
  reason: string
}

// Identity of a sessionless reading queue. Texts are keyed by this triple
// instead of a practice_session_id: one ord sequence per group, doubling as
// per-group history.
export type ReadingGroup = {
  userId: string
  targetLanguage: string
  pool: PracticePool
}

const groupLockKey = (group: ReadingGroup): string =>
  `practice_texts:${group.userId}:${group.targetLanguage}:${group.pool}`

// Stale-slot recovery threshold. Workers are expected to finish in well under
// this; pre-gen slots that age past it without making it to 'ready' are
// considered crashed/abandoned and the next caller can fence them off.
const STALE_SLOT_SECONDS = 60

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
      user_lookup_id: a.userLookupId,
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

const findById = async (id: string): Promise<DbPracticeText | null> => {
  const result = (await sql`
    SELECT * FROM public.practice_texts WHERE id = ${id}
  `) as DbPracticeText[]
  return result[0] ?? null
}

// Ownership-checked fetch. The pool / target_language now live on the row
// itself (no session join), so the rating layer can advance the correct SRS
// column family straight from the returned tuple.
const findByIdForUser = async (
  id: string,
  userId: string
): Promise<{
  practiceText: DbPracticeText
  targetLanguage: string
  pool: PracticePool
} | null> => {
  const result = (await sql`
    SELECT *
    FROM public.practice_texts
    WHERE id = ${id} AND user_id = ${userId}
  `) as DbPracticeText[]
  const row = result[0]
  if (!row) return null
  return {
    practiceText: row,
    targetLanguage: row.target_language,
    pool: row.pool as PracticePool,
  }
}

// Past texts for a group, newest first. The 'done' filter keeps history to
// texts the user actually read; in-flight / failed slots are omitted.
const listHistory = async (group: ReadingGroup): Promise<DbPracticeText[]> => {
  return (await sql`
    SELECT *
    FROM public.practice_texts
    WHERE user_id = ${group.userId}
      AND target_language = ${group.targetLanguage}
      AND pool = ${group.pool}
      AND status = 'done'
    ORDER BY ord DESC
  `) as DbPracticeText[]
}

// Pure read of the in-progress 'reading' text for a group, if any. No side
// effects (unlike selectAndMarkReading). At most one row can be 'reading' per
// group (enforced by at_most_one_reading_per_user_lang_pool).
const findCurrentReading = async (group: ReadingGroup): Promise<DbPracticeText | null> => {
  const result = (await sql`
    SELECT *
    FROM public.practice_texts
    WHERE user_id = ${group.userId}
      AND target_language = ${group.targetLanguage}
      AND pool = ${group.pool}
      AND status = 'reading'
    LIMIT 1
  `) as DbPracticeText[]
  return result[0] ?? null
}

export type CurrentReadingSummary = {
  targetLanguage: string
  pool: PracticePool
  scope: ReviewScope | null
  termCount: number
}

// All open 'reading' texts for a user across languages/pools (at most one per
// group), for the landing's "continue reading" affordance. The scope rides
// along because resuming under a different scope discards the open text
// (failMismatchedScopeSlots) — the affordance must re-enter with the text's
// own scope. NULL scope (legacy rows) resumes under any scope.
const listCurrentReadings = async (userId: string): Promise<CurrentReadingSummary[]> => {
  const rows = (await sql`
    SELECT target_language, pool, scope, jsonb_array_length(annotations)::int AS term_count
    FROM public.practice_texts
    WHERE user_id = ${userId} AND status = 'reading'
  `) as Array<{ target_language: string; pool: string; scope: string | null; term_count: number }>
  return rows.map((row) => ({
    targetLanguage: row.target_language,
    pool: row.pool as PracticePool,
    scope: row.scope as ReviewScope | null,
    termCount: row.term_count,
  }))
}

// Abandon any in-flight / speculative / in-progress text built under a
// different scope than the one now being requested. The reading queue is shared
// across scopes (keyed only by user/language/pool), but each text embeds the
// candidates eligible under the scope active when it was generated; resuming or
// consuming one under a new scope surfaces the wrong terms (e.g. entering
// "Learn new" but being shown a leftover mixed text). NULL-scope legacy rows
// are left alone — treated as usable under any scope.
const failMismatchedScopeSlots = async (group: ReadingGroup, scope: ReviewScope): Promise<void> => {
  await sql`
    UPDATE public.practice_texts
    SET status = 'failed',
        generation_warning = COALESCE(generation_warning, 'abandoned: scope changed')
    WHERE user_id = ${group.userId}
      AND target_language = ${group.targetLanguage}
      AND pool = ${group.pool}
      AND status IN ('pending', 'generating', 'ready', 'reading')
      AND scope IS NOT NULL
      AND scope <> ${scope}
  `
}

// Atomically pick the row to surface to the user and (if needed) flip it from
// 'ready' to 'reading' so closing & re-opening — or a second tab — sees the
// in-progress text rather than a pre-generated successor at a higher ord.
//
//   1. If a 'reading' row exists for this group, return it as-is.
//   2. Otherwise the lowest-ord 'ready' row gets promoted to 'reading' in a
//      single atomic UPDATE keyed on status='ready'.
//   3. Empty 'ready'/'reading' rows (no usable annotations) are failed first so
//      they're never surfaced.
const selectAndMarkReading = async (group: ReadingGroup): Promise<DbPracticeText | null> => {
  await sql`
    UPDATE public.practice_texts
    SET status = 'failed',
        generation_warning = COALESCE(generation_warning, 'readable text had no usable annotations')
    WHERE user_id = ${group.userId}
      AND target_language = ${group.targetLanguage}
      AND pool = ${group.pool}
      AND status IN ('ready', 'reading')
      AND jsonb_array_length(annotations) = 0
  `

  const existing = (await sql`
    SELECT *
    FROM public.practice_texts
    WHERE user_id = ${group.userId}
      AND target_language = ${group.targetLanguage}
      AND pool = ${group.pool}
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
      WHERE user_id = ${group.userId}
        AND target_language = ${group.targetLanguage}
        AND pool = ${group.pool}
        AND status = 'ready'
      ORDER BY ord ASC
      LIMIT 1
    )
    RETURNING *
  `) as DbPracticeText[]
  return result[0] ?? null
}

export type ReservedSlot = {
  practiceText: DbPracticeText
  isFresh: boolean
}

// Reserve the "next" slot for this group, or return the slot already reserved
// if one exists. Wraps the lookup-or-insert in a per-group advisory lock so two
// concurrent callers (foreground advance + background prepare) can't collide on
// the (user, language, pool, ord) unique constraint or insert duplicate slots.
//
// "Already reserved" means: a row at ord > the highest done/reading ord exists
// in status pending/generating/ready. If we find one but it's stuck
// (pending/generating older than STALE_SLOT_SECONDS), we mark it failed and
// reserve a fresh slot at the next ord.
//
// `isFresh` is true when the caller is responsible for kicking off the
// generation work for this slot.
const reserveOrFindNextSlot = async (group: ReadingGroup, scope: ReviewScope): Promise<ReservedSlot> => {
  return await beginTx(async (tx) => {
    await tx`
      SELECT pg_advisory_xact_lock(hashtext(${groupLockKey(group)}))
    `

    const anchorRows = (await tx`
      SELECT COALESCE(MAX(ord), -1) AS anchor_ord
      FROM public.practice_texts
      WHERE user_id = ${group.userId}
        AND target_language = ${group.targetLanguage}
        AND pool = ${group.pool}
        AND status IN ('reading', 'done')
    `) as Array<{ anchor_ord: number }>
    const anchorOrd = anchorRows[0]?.anchor_ord ?? -1

    const candidate = (await tx`
      SELECT *
      FROM public.practice_texts
      WHERE user_id = ${group.userId}
        AND target_language = ${group.targetLanguage}
        AND pool = ${group.pool}
        AND status IN ('pending', 'generating', 'ready')
        AND ord > ${anchorOrd}
      ORDER BY ord ASC
      LIMIT 1
    `) as DbPracticeText[]

    const existing = candidate[0]
    if (existing) {
      if (existing.status === 'ready' && (!Array.isArray(existing.annotations) || existing.annotations.length === 0)) {
        await tx`
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
        // Stale. Fence it off, then fall through to reserve a fresh slot. The
        // previous worker's markReady will fail its token check and no-op.
        await tx`
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

    const nextOrdRows = (await tx`
      SELECT COALESCE(MAX(ord), -1) + 1 AS next_ord
      FROM public.practice_texts
      WHERE user_id = ${group.userId}
        AND target_language = ${group.targetLanguage}
        AND pool = ${group.pool}
    `) as Array<{ next_ord: number }>
    const nextOrd = nextOrdRows[0]?.next_ord ?? 0

    const inserted = (await tx`
      INSERT INTO public.practice_texts (user_id, target_language, pool, ord, status, scope)
      VALUES (${group.userId}, ${group.targetLanguage}, ${group.pool}, ${nextOrd}, 'pending', ${scope})
      RETURNING *
    `) as DbPracticeText[]

    return { practiceText: inserted[0]!, isFresh: true }
  })
}

// Atomic finalize gate: only the caller who flips the row from 'ready' or
// 'reading' to 'done' owns the rating pass. Returns the post-update row if we
// won, null if another caller already finalized (idempotent advance).
const claimFinalize = async (id: string): Promise<DbPracticeText | null> => {
  const result = (await sql`
    UPDATE public.practice_texts
    SET status = 'done', read_at = NOW()
    WHERE id = ${id} AND status IN ('ready', 'reading')
    RETURNING *
  `) as DbPracticeText[]
  return result[0] ?? null
}

export interface PracticeTextsRepositoryInterface {
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
  findById: (id: string) => Promise<DbPracticeText | null>
  findByIdForUser: (
    id: string,
    userId: string
  ) => Promise<{
    practiceText: DbPracticeText
    targetLanguage: string
    pool: PracticePool
  } | null>
  listHistory: (group: ReadingGroup) => Promise<DbPracticeText[]>
  findCurrentReading: (group: ReadingGroup) => Promise<DbPracticeText | null>
  listCurrentReadings: (userId: string) => Promise<CurrentReadingSummary[]>
  failMismatchedScopeSlots: (group: ReadingGroup, scope: ReviewScope) => Promise<void>
  selectAndMarkReading: (group: ReadingGroup) => Promise<DbPracticeText | null>
  reserveOrFindNextSlot: (group: ReadingGroup, scope: ReviewScope) => Promise<ReservedSlot>
  claimFinalize: (id: string) => Promise<DbPracticeText | null>
}

export const PracticeTextsRepository = (): PracticeTextsRepositoryInterface => {
  return {
    claimGenerating,
    markReady,
    markFailed,
    markReading,
    findById,
    findByIdForUser,
    listHistory,
    findCurrentReading,
    listCurrentReadings,
    failMismatchedScopeSlots,
    selectAndMarkReading,
    reserveOrFindNextSlot,
    claimFinalize,
  }
}
