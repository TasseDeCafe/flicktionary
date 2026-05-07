import postgres from 'postgres'
import { sql } from '../postgres-client'
import { Tables, Database } from '../database.public.types'

export type DbUserLookup = Tables<'user_lookups'>
export type SrsState = Database['public']['Enums']['srs_state']

export type HeadwordSense = {
  headword: string
  sense: string
}

export type DueSummaryEntry = {
  targetLanguage: string
  totalKept: number
  dueCount: number
  newCount: number
}

export type RenameKeyResult = { ok: true } | { ok: false; reason: 'CONFLICT' }

const listHeadwordSensesForLanguage = async (userId: string, targetLanguage: string): Promise<HeadwordSense[]> => {
  const result = await sql`
    SELECT headword, sense FROM public.user_lookups
    WHERE user_id = ${userId}
      AND target_language = ${targetLanguage}
      AND deleted_at IS NULL
  `
  return result.map((row) => ({
    headword: row.headword as string,
    sense: (row.sense as string) ?? '',
  }))
}

// Idempotent get-or-insert keyed by (user_id, target_language, headword, sense).
// Called at card-creation time so the user_lookups row always exists by the
// time the card row references it. The no-op DO UPDATE clause exists solely so
// RETURNING gives us the existing row when there's a conflict.
const findOrCreate = async (params: {
  userId: string
  targetLanguage: string
  headword: string
  sense: string
}): Promise<DbUserLookup> => {
  // Re-keeping a previously soft-deleted chunk revives it: clear deleted_at
  // on conflict so the row reappears in the Vocabulary list and Practice queue.
  const result = (await sql`
    INSERT INTO public.user_lookups (user_id, target_language, headword, sense)
    VALUES (
      ${params.userId},
      ${params.targetLanguage},
      ${params.headword},
      ${params.sense}
    )
    ON CONFLICT ON CONSTRAINT user_lookups_user_target_headword_sense_unique DO UPDATE SET
      headword = EXCLUDED.headword,
      deleted_at = NULL
    RETURNING *
  `) as DbUserLookup[]
  return result[0]!
}

// Patch any subset of the canonical content fields. `undefined`/`null`
// preserve the existing value (COALESCE semantic); to clear a basic field,
// pass an explicit empty string. `explorationExtrasPatch` is shallow-merged
// into exploration_extras via JSONB `||` on the server.
const updateContent = async (params: {
  id: string
  translation?: string | null
  definition?: string | null
  targetExample?: string | null
  nativeExample?: string | null
  explorationExtrasPatch?: Record<string, unknown> | null
}): Promise<void> => {
  const extras = params.explorationExtrasPatch ?? null
  const extrasJson = extras ? sql.json(extras as unknown as postgres.JSONValue) : null
  await sql`
    UPDATE public.user_lookups
    SET
      translation = COALESCE(${params.translation ?? null}, translation),
      definition = COALESCE(${params.definition ?? null}, definition),
      target_example = COALESCE(${params.targetExample ?? null}, target_example),
      native_example = COALESCE(${params.nativeExample ?? null}, native_example),
      exploration_extras = exploration_extras || COALESCE(${extrasJson}::jsonb, '{}'::jsonb)
    WHERE id = ${params.id}
  `
}

// Rename the (headword, sense) pair on an existing user_lookups row. Surfaces
// 'CONFLICT' when another row already owns the target pair for the same
// (user_id, target_language). Callers map this to a 409.
const renameKey = async (params: { id: string; headword: string; sense: string }): Promise<RenameKeyResult> => {
  try {
    await sql`
      UPDATE public.user_lookups
      SET headword = ${params.headword},
          sense = ${params.sense}
      WHERE id = ${params.id}
    `
    return { ok: true }
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === '23505') return { ok: false, reason: 'CONFLICT' }
    throw err
  }
}

// Stamps exported_at and (optionally) backfills first_card_id. count is owned
// by keep/unkeep transitions on the cards table, not by export — exporting a
// card that's already kept must not inflate the badge.
const upsertOnExport = async (params: { userLookupId: string; firstCardId: string | null }): Promise<void> => {
  await sql`
    UPDATE public.user_lookups
    SET exported_at = COALESCE(exported_at, NOW()),
        first_card_id = COALESCE(first_card_id, ${params.firstCardId}),
        deleted_at = NULL
    WHERE id = ${params.userLookupId}
  `
}

// Card transitioned X → 'kept' (X !== 'kept'). count bumps by 1, deleted_at
// clears (re-keeping a soft-deleted chunk revives it), first_card_id is
// backfilled if it wasn't set.
const applyKeepTransition = async (params: { userLookupId: string; cardId: string }): Promise<void> => {
  await sql`
    UPDATE public.user_lookups
    SET count = count + 1,
        first_card_id = COALESCE(first_card_id, ${params.cardId}),
        deleted_at = NULL
    WHERE id = ${params.userLookupId}
  `
}

// Card transitioned 'kept' → Y (Y !== 'kept'). count drops by 1, floored at 0.
// SRS state stays put — re-keeping later resumes the schedule.
const applyUnkeepTransition = async (params: { userLookupId: string }): Promise<void> => {
  await sql`
    UPDATE public.user_lookups
    SET count = GREATEST(count - 1, 0)
    WHERE id = ${params.userLookupId}
  `
}

// Per-language summary used by the Practice landing. Counts:
// - totalKept: rows the user has kept at least once (count > 0)
// - dueCount: rows whose srs_due <= now (rows already in the SRS queue)
// - newCount: rows with srs_state IS NULL (never reviewed; would enter as 'new')
//
// Rows with count = 0 exist because user_lookups is created eagerly at card
// insertion time (so content has a home before triage). Those rows are NOT
// part of the user's vocabulary until they keep at least one card for the
// chunk — hence the count > 0 gate everywhere on the Practice path.
const listDueSummary = async (userId: string): Promise<DueSummaryEntry[]> => {
  const result = await sql`
    SELECT
      target_language,
      COUNT(*)::int AS total_kept,
      COUNT(*) FILTER (WHERE srs_state IS NOT NULL AND srs_due IS NOT NULL AND srs_due <= NOW())::int AS due_count,
      COUNT(*) FILTER (WHERE srs_state IS NULL)::int AS new_count
    FROM public.user_lookups
    WHERE user_id = ${userId}
      AND count > 0
      AND deleted_at IS NULL
    GROUP BY target_language
    ORDER BY target_language ASC
  `
  return result.map((row) => ({
    targetLanguage: row.target_language as string,
    totalKept: row.total_kept as number,
    dueCount: row.due_count as number,
    newCount: row.new_count as number,
  }))
}

// Returns the rows eligible for the next practice text in this session:
// - rows already in SRS state with srs_due <= now (older first), AND
// - rows that have never been reviewed (srs_state IS NULL).
// Caller is expected to subtract chunks already covered by prior practice_texts
// in this session (that's a JSONB join the caller does after the fact).
const listEligibleForLanguage = async (params: { userId: string; targetLanguage: string }): Promise<DbUserLookup[]> => {
  return (await sql`
    SELECT *
    FROM public.user_lookups
    WHERE user_id = ${params.userId}
      AND target_language = ${params.targetLanguage}
      AND count > 0
      AND deleted_at IS NULL
      AND (
        srs_state IS NULL
        OR (srs_due IS NOT NULL AND srs_due <= NOW())
      )
    ORDER BY
      CASE WHEN srs_state IS NULL THEN 1 ELSE 0 END ASC,
      srs_due ASC NULLS LAST,
      headword ASC,
      sense ASC
  `) as DbUserLookup[]
}

const findByKey = async (params: {
  userId: string
  targetLanguage: string
  headword: string
  sense: string
}): Promise<DbUserLookup | null> => {
  const result = (await sql`
    SELECT *
    FROM public.user_lookups
    WHERE user_id = ${params.userId}
      AND target_language = ${params.targetLanguage}
      AND headword = ${params.headword}
      AND sense = ${params.sense}
      AND deleted_at IS NULL
  `) as DbUserLookup[]
  return result[0] ?? null
}

const findByIdForUser = async (id: string, userId: string): Promise<DbUserLookup | null> => {
  const result = (await sql`
    SELECT *
    FROM public.user_lookups
    WHERE id = ${id}
      AND user_id = ${userId}
      AND deleted_at IS NULL
  `) as DbUserLookup[]
  return result[0] ?? null
}

// Initialize SRS state on a row that's never been reviewed before, so it
// appears in the queue as 'new' and due now. No-op if srs_state is already
// non-null.
const initializeSrsState = async (userLookupId: string): Promise<void> => {
  await sql`
    UPDATE public.user_lookups
    SET srs_state = 'new',
        srs_due = NOW(),
        added_to_practice_at = NOW()
    WHERE id = ${userLookupId}
      AND srs_state IS NULL
  `
}

// Patch the SRS columns from a ts-fsrs Card object. Atomic update — call this
// for every rating event.
const applyFsrsResult = async (params: {
  userLookupId: string
  state: SrsState
  due: Date
  stability: number
  difficulty: number
  lastReview: Date
  reps: number
  lapses: number
}): Promise<void> => {
  await sql`
    UPDATE public.user_lookups
    SET srs_state = ${params.state},
        srs_due = ${params.due.toISOString()},
        srs_stability = ${params.stability},
        srs_difficulty = ${params.difficulty},
        srs_last_review = ${params.lastReview.toISOString()},
        srs_reps = ${params.reps},
        srs_lapses = ${params.lapses}
    WHERE id = ${params.userLookupId}
  `
}

// Lightweight "vocabulary" view used by the practice-text generator's prompt
// builder. After the content refactor, content fields live on user_lookups
// directly — no card join required.
export type VocabularyRow = {
  headword: string
  sense: string
  translation: string | null
  definition: string | null
  targetExample: string | null
  nativeExample: string | null
  srsState: SrsState | null
  srsDue: string | null
  srsReps: number
}

const listVocabularyForLanguage = async (params: {
  userId: string
  targetLanguage: string
}): Promise<VocabularyRow[]> => {
  const result = await sql`
    SELECT
      headword,
      sense,
      translation,
      definition,
      target_example,
      native_example,
      srs_state,
      srs_due,
      srs_reps
    FROM public.user_lookups
    WHERE user_id = ${params.userId}
      AND target_language = ${params.targetLanguage}
      AND count > 0
      AND deleted_at IS NULL
  `
  return result.map((row) => ({
    headword: row.headword as string,
    sense: (row.sense as string) ?? '',
    translation: (row.translation as string | null) ?? null,
    definition: (row.definition as string | null) ?? null,
    targetExample: (row.target_example as string | null) ?? null,
    nativeExample: (row.native_example as string | null) ?? null,
    srsState: (row.srs_state as SrsState | null) ?? null,
    srsDue: (row.srs_due as string | null) ?? null,
    srsReps: (row.srs_reps as number) ?? 0,
  }))
}

// Row shape for the cross-session vocabulary CSV export. Pulls representative
// surface_form + segment text via the first_card_id back-pointer so the CSV
// has the same column shape per-session export produces. Surface_form /
// segment_text fall back to empty when first_card_id is null or stale.
export type ExportChunkRow = {
  headword: string
  sense: string
  translation: string | null
  definition: string | null
  targetExample: string | null
  nativeExample: string | null
  explorationExtras: Record<string, unknown>
  surfaceForm: string
  segmentText: string
}

const listKeptChunksForExport = async (params: {
  userId: string
  targetLanguage: string
}): Promise<ExportChunkRow[]> => {
  const result = await sql`
    SELECT
      ul.headword,
      ul.sense,
      ul.translation,
      ul.definition,
      ul.target_example,
      ul.native_example,
      ul.exploration_extras,
      c.surface_form,
      ts.text AS segment_text
    FROM public.user_lookups ul
    LEFT JOIN public.cards c ON c.id = ul.first_card_id
    LEFT JOIN public.text_segments ts ON ts.id = c.segment_id
    WHERE ul.user_id = ${params.userId}
      AND ul.target_language = ${params.targetLanguage}
      AND ul.count > 0
      AND ul.deleted_at IS NULL
    ORDER BY ul.created_at ASC, ul.id ASC
  `
  return result.map((row) => ({
    headword: row.headword as string,
    sense: (row.sense as string) ?? '',
    translation: (row.translation as string | null) ?? null,
    definition: (row.definition as string | null) ?? null,
    targetExample: (row.target_example as string | null) ?? null,
    nativeExample: (row.native_example as string | null) ?? null,
    explorationExtras: (row.exploration_extras as Record<string, unknown> | null) ?? {},
    surfaceForm: (row.surface_form as string | null) ?? '',
    segmentText: (row.segment_text as string | null) ?? '',
  }))
}

// =========================================================================
// Vocabulary management view (the /vocabulary tab)
// =========================================================================

export type ChunksSort = 'recent' | 'due'

// Cursor wire format. Encoded base64 by the contract layer; the repo deals in
// the structured form.
//
// `recent` orders by (created_at DESC, id ASC) — straightforward keyset.
// `due` is two-phase to handle NULLS LAST: phase 'scheduled' walks rows with
// srs_due NOT NULL ordered (srs_due ASC, id ASC); when that phase exhausts,
// we flip to phase 'unscheduled' which walks the srs_due IS NULL tail
// ordered by id ASC.
export type ChunksCursor =
  | { sort: 'recent'; createdAt: string; id: string }
  | { sort: 'due'; phase: 'scheduled'; srsDue: string; id: string }
  | { sort: 'due'; phase: 'unscheduled'; id: string }

export type ChunkRow = {
  id: string
  userId: string
  targetLanguage: string
  headword: string
  sense: string
  translation: string | null
  definition: string | null
  targetExample: string | null
  nativeExample: string | null
  explorationExtras: Record<string, unknown>
  count: number
  srsState: SrsState | null
  srsDue: string | null
  srsReps: number
  createdAt: string
  firstCardId: string | null
  firstCardSegmentId: string | null
  studySessionId: string | null
}

const SELECT_CHUNK_ROW_SQL = sql`
  SELECT
    ul.id,
    ul.user_id,
    ul.target_language,
    ul.headword,
    ul.sense,
    ul.translation,
    ul.definition,
    ul.target_example,
    ul.native_example,
    ul.exploration_extras,
    ul.count,
    ul.srs_state,
    ul.srs_due,
    ul.srs_reps,
    ul.created_at,
    ul.first_card_id,
    c.segment_id AS first_card_segment_id,
    c.study_session_id
  FROM public.user_lookups ul
  LEFT JOIN public.cards c ON c.id = ul.first_card_id
`

const mapChunkRow = (row: Record<string, unknown>): ChunkRow => ({
  id: row.id as string,
  userId: row.user_id as string,
  targetLanguage: row.target_language as string,
  headword: row.headword as string,
  sense: (row.sense as string) ?? '',
  translation: (row.translation as string | null) ?? null,
  definition: (row.definition as string | null) ?? null,
  targetExample: (row.target_example as string | null) ?? null,
  nativeExample: (row.native_example as string | null) ?? null,
  explorationExtras: ((row.exploration_extras as Record<string, unknown> | null) ?? {}) as Record<string, unknown>,
  count: (row.count as number) ?? 0,
  srsState: (row.srs_state as SrsState | null) ?? null,
  srsDue: (row.srs_due as string | null) ?? null,
  srsReps: (row.srs_reps as number) ?? 0,
  createdAt: row.created_at as string,
  firstCardId: (row.first_card_id as string | null) ?? null,
  firstCardSegmentId: (row.first_card_segment_id as string | null) ?? null,
  studySessionId: (row.study_session_id as string | null) ?? null,
})

// Case-insensitive substring filter across headword/translation/definition.
// `%` and `_` in user input retain LIKE-pattern semantics — acceptable for
// the v1 search bar; if it becomes a footgun we can escape later.
const buildSearchClause = (q: string | null) => {
  if (!q || q.length === 0) return sql``
  const pattern = `%${q}%`
  return sql`AND (ul.headword ILIKE ${pattern} OR ul.translation ILIKE ${pattern} OR ul.definition ILIKE ${pattern})`
}

const listChunksForLanguage = async (params: {
  userId: string
  targetLanguage: string
  sort: ChunksSort
  cursor: ChunksCursor | null
  limit: number
  q: string | null
}): Promise<{ rows: ChunkRow[]; nextCursor: ChunksCursor | null }> => {
  const limit = Math.max(1, Math.min(params.limit, 200))
  const fetchLimit = limit + 1
  const searchClause = buildSearchClause(params.q)

  if (params.sort === 'recent') {
    const cursor = params.cursor && params.cursor.sort === 'recent' ? params.cursor : null
    const rows = (await sql`
      ${SELECT_CHUNK_ROW_SQL}
      WHERE ul.user_id = ${params.userId}
        AND ul.target_language = ${params.targetLanguage}
        AND ul.deleted_at IS NULL
        AND ul.count > 0
        ${searchClause}
        AND ${cursor ? sql`(ul.created_at, ul.id) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)` : sql`TRUE`}
      ORDER BY ul.created_at DESC, ul.id ASC
      LIMIT ${fetchLimit}
    `) as Array<Record<string, unknown>>

    const mapped = rows.map(mapChunkRow)
    const hasMore = mapped.length > limit
    const sliced = hasMore ? mapped.slice(0, limit) : mapped
    const last = sliced[sliced.length - 1]
    const nextCursor: ChunksCursor | null =
      hasMore && last ? { sort: 'recent', createdAt: last.createdAt, id: last.id } : null
    return { rows: sliced, nextCursor }
  }

  // sort === 'due'. Two phases: scheduled rows (srs_due NOT NULL) first, then
  // the unscheduled tail. The cursor encodes which phase we're in.
  const cursor = params.cursor && params.cursor.sort === 'due' ? params.cursor : null
  const phase = cursor?.phase ?? 'scheduled'

  if (phase === 'scheduled') {
    const rows = (await sql`
      ${SELECT_CHUNK_ROW_SQL}
      WHERE ul.user_id = ${params.userId}
        AND ul.target_language = ${params.targetLanguage}
        AND ul.deleted_at IS NULL
        AND ul.count > 0
        AND ul.srs_due IS NOT NULL
        ${searchClause}
        AND ${
          cursor && cursor.phase === 'scheduled'
            ? sql`(ul.srs_due, ul.id) > (${cursor.srsDue}::timestamptz, ${cursor.id}::uuid)`
            : sql`TRUE`
        }
      ORDER BY ul.srs_due ASC, ul.id ASC
      LIMIT ${fetchLimit}
    `) as Array<Record<string, unknown>>

    const mapped = rows.map(mapChunkRow)
    const hasMoreScheduled = mapped.length > limit
    const sliced = hasMoreScheduled ? mapped.slice(0, limit) : mapped

    if (hasMoreScheduled) {
      const last = sliced[sliced.length - 1]!
      // srsDue is non-null because we filtered `srs_due IS NOT NULL`.
      const nextCursor: ChunksCursor = { sort: 'due', phase: 'scheduled', srsDue: last.srsDue!, id: last.id }
      return { rows: sliced, nextCursor }
    }

    // Scheduled phase exhausted in this fetch. If we still have room in the
    // page, fill from unscheduled. Otherwise hand the caller a cursor that
    // starts the unscheduled phase from the beginning.
    const remaining = limit - sliced.length
    if (remaining <= 0) {
      const nextCursor: ChunksCursor = { sort: 'due', phase: 'unscheduled', id: '00000000-0000-0000-0000-000000000000' }
      return { rows: sliced, nextCursor }
    }

    const tailFetchLimit = remaining + 1
    const tailRows = (await sql`
      ${SELECT_CHUNK_ROW_SQL}
      WHERE ul.user_id = ${params.userId}
        AND ul.target_language = ${params.targetLanguage}
        AND ul.deleted_at IS NULL
        AND ul.count > 0
        AND ul.srs_due IS NULL
        ${searchClause}
      ORDER BY ul.id ASC
      LIMIT ${tailFetchLimit}
    `) as Array<Record<string, unknown>>

    const tailMapped = tailRows.map(mapChunkRow)
    const hasMoreTail = tailMapped.length > remaining
    const tailSliced = hasMoreTail ? tailMapped.slice(0, remaining) : tailMapped
    const combined = [...sliced, ...tailSliced]
    const lastTail = tailSliced[tailSliced.length - 1]
    const nextCursor: ChunksCursor | null =
      hasMoreTail && lastTail ? { sort: 'due', phase: 'unscheduled', id: lastTail.id } : null
    return { rows: combined, nextCursor }
  }

  // phase === 'unscheduled'
  const rows = (await sql`
    ${SELECT_CHUNK_ROW_SQL}
    WHERE ul.user_id = ${params.userId}
      AND ul.target_language = ${params.targetLanguage}
      AND ul.deleted_at IS NULL
      AND ul.count > 0
      AND ul.srs_due IS NULL
      ${searchClause}
      AND ul.id > ${cursor!.id}::uuid
    ORDER BY ul.id ASC
    LIMIT ${fetchLimit}
  `) as Array<Record<string, unknown>>

  const mapped = rows.map(mapChunkRow)
  const hasMore = mapped.length > limit
  const sliced = hasMore ? mapped.slice(0, limit) : mapped
  const last = sliced[sliced.length - 1]
  const nextCursor: ChunksCursor | null = hasMore && last ? { sort: 'due', phase: 'unscheduled', id: last.id } : null
  return { rows: sliced, nextCursor }
}

// Used to enrich practice annotations with the live gloss/definition before
// shipping a practice text to the client. Soft-deleted rows are excluded —
// their content shouldn't surface in the rate sheet. We fetch all rows for
// the (user, language) and let the caller index by (headword, sense); typical
// user vocabularies stay in the low hundreds, so the simple query beats
// composing an array-tuple WHERE clause.
const listChunkContentForKeys = async (params: {
  userId: string
  targetLanguage: string
  keys: Array<{ headword: string; sense: string }>
}): Promise<Array<{ headword: string; sense: string; translation: string | null; definition: string | null }>> => {
  if (params.keys.length === 0) return []
  const result = (await sql`
    SELECT headword, sense, translation, definition
    FROM public.user_lookups
    WHERE user_id = ${params.userId}
      AND target_language = ${params.targetLanguage}
      AND deleted_at IS NULL
  `) as Array<{ headword: string; sense: string; translation: string | null; definition: string | null }>
  return result
}

const softDeleteChunk = async (id: string, userId: string): Promise<void> => {
  await sql`
    UPDATE public.user_lookups
    SET deleted_at = NOW()
    WHERE id = ${id}
      AND user_id = ${userId}
      AND deleted_at IS NULL
  `
}

const listLanguagesForUser = async (userId: string): Promise<string[]> => {
  const result = await sql`
    SELECT DISTINCT target_language
    FROM public.user_lookups
    WHERE user_id = ${userId}
      AND deleted_at IS NULL
      AND count > 0
    ORDER BY target_language ASC
  `
  return result.map((row) => row.target_language as string)
}

export interface UserLookupsRepositoryInterface {
  listHeadwordSensesForLanguage: (userId: string, targetLanguage: string) => Promise<HeadwordSense[]>
  findOrCreate: (params: {
    userId: string
    targetLanguage: string
    headword: string
    sense: string
  }) => Promise<DbUserLookup>
  updateContent: (params: {
    id: string
    translation?: string | null
    definition?: string | null
    targetExample?: string | null
    nativeExample?: string | null
    explorationExtrasPatch?: Record<string, unknown> | null
  }) => Promise<void>
  renameKey: (params: { id: string; headword: string; sense: string }) => Promise<RenameKeyResult>
  upsertOnExport: (params: { userLookupId: string; firstCardId: string | null }) => Promise<void>
  applyKeepTransition: (params: { userLookupId: string; cardId: string }) => Promise<void>
  applyUnkeepTransition: (params: { userLookupId: string }) => Promise<void>
  listDueSummary: (userId: string) => Promise<DueSummaryEntry[]>
  listEligibleForLanguage: (params: { userId: string; targetLanguage: string }) => Promise<DbUserLookup[]>
  findByKey: (params: {
    userId: string
    targetLanguage: string
    headword: string
    sense: string
  }) => Promise<DbUserLookup | null>
  findByIdForUser: (id: string, userId: string) => Promise<DbUserLookup | null>
  initializeSrsState: (userLookupId: string) => Promise<void>
  applyFsrsResult: (params: {
    userLookupId: string
    state: SrsState
    due: Date
    stability: number
    difficulty: number
    lastReview: Date
    reps: number
    lapses: number
  }) => Promise<void>
  listVocabularyForLanguage: (params: { userId: string; targetLanguage: string }) => Promise<VocabularyRow[]>
  listKeptChunksForExport: (params: { userId: string; targetLanguage: string }) => Promise<ExportChunkRow[]>
  listChunksForLanguage: (params: {
    userId: string
    targetLanguage: string
    sort: ChunksSort
    cursor: ChunksCursor | null
    limit: number
    q: string | null
  }) => Promise<{ rows: ChunkRow[]; nextCursor: ChunksCursor | null }>
  softDeleteChunk: (id: string, userId: string) => Promise<void>
  listChunkContentForKeys: (params: {
    userId: string
    targetLanguage: string
    keys: Array<{ headword: string; sense: string }>
  }) => Promise<Array<{ headword: string; sense: string; translation: string | null; definition: string | null }>>
  listLanguagesForUser: (userId: string) => Promise<string[]>
}

export const UserLookupsRepository = (): UserLookupsRepositoryInterface => {
  return {
    listHeadwordSensesForLanguage,
    findOrCreate,
    updateContent,
    renameKey,
    upsertOnExport,
    applyKeepTransition,
    applyUnkeepTransition,
    listDueSummary,
    listEligibleForLanguage,
    findByKey,
    findByIdForUser,
    initializeSrsState,
    applyFsrsResult,
    listVocabularyForLanguage,
    listKeptChunksForExport,
    listChunksForLanguage,
    softDeleteChunk,
    listChunkContentForKeys,
    listLanguagesForUser,
  }
}
