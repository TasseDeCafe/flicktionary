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
    WHERE user_id = ${userId} AND target_language = ${targetLanguage}
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
  const result = (await sql`
    INSERT INTO public.user_lookups (user_id, target_language, headword, sense)
    VALUES (
      ${params.userId},
      ${params.targetLanguage},
      ${params.headword},
      ${params.sense}
    )
    ON CONFLICT ON CONSTRAINT user_lookups_user_target_headword_sense_unique DO UPDATE SET
      headword = EXCLUDED.headword
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
const renameKey = async (params: {
  id: string
  headword: string
  sense: string
}): Promise<RenameKeyResult> => {
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

// Bumps `count` and (optionally) backfills first_card_id. The row is created
// at card-insert time via findOrCreate, so this is a pure update.
const upsertOnExport = async (params: {
  userLookupId: string
  firstCardId: string | null
}): Promise<void> => {
  await sql`
    UPDATE public.user_lookups
    SET count = count + 1,
        exported_at = COALESCE(exported_at, NOW()),
        first_card_id = COALESCE(first_card_id, ${params.firstCardId})
    WHERE id = ${params.userLookupId}
  `
}

// Bumps `count` (idempotent re-keep semantic) and backfills first_card_id if
// it wasn't set. The row exists by virtue of card creation; this never inserts.
const upsertOnKeep = async (params: { userLookupId: string; cardId: string }): Promise<void> => {
  await sql`
    UPDATE public.user_lookups
    SET count = count + 1,
        first_card_id = COALESCE(first_card_id, ${params.cardId})
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
    WHERE user_id = ${userId} AND count > 0
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
  `) as DbUserLookup[]
  return result[0] ?? null
}

const findByIdForUser = async (id: string, userId: string): Promise<DbUserLookup | null> => {
  const result = (await sql`
    SELECT *
    FROM public.user_lookups
    WHERE id = ${id} AND user_id = ${userId}
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
  upsertOnKeep: (params: { userLookupId: string; cardId: string }) => Promise<void>
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
}

export const UserLookupsRepository = (): UserLookupsRepositoryInterface => {
  return {
    listHeadwordSensesForLanguage,
    findOrCreate,
    updateContent,
    renameKey,
    upsertOnExport,
    upsertOnKeep,
    listDueSummary,
    listEligibleForLanguage,
    findByKey,
    findByIdForUser,
    initializeSrsState,
    applyFsrsResult,
    listVocabularyForLanguage,
  }
}
