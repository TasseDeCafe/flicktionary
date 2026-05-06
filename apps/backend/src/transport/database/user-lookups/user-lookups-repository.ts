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

const upsertOnExport = async (params: {
  userId: string
  targetLanguage: string
  headword: string
  sense: string
  firstCardId: string | null
}): Promise<void> => {
  await sql`
    INSERT INTO public.user_lookups (user_id, target_language, headword, sense, first_card_id, exported_at, count)
    VALUES (
      ${params.userId},
      ${params.targetLanguage},
      ${params.headword},
      ${params.sense},
      ${params.firstCardId},
      NOW(),
      1
    )
    ON CONFLICT (user_id, target_language, headword, sense) DO UPDATE SET
      count = public.user_lookups.count + 1,
      exported_at = COALESCE(public.user_lookups.exported_at, EXCLUDED.exported_at)
  `
}

// Insert (or upsert) the row when a card transitions to status='kept'. This is
// the point where the chunk enters the user's personal vocabulary, so the
// Practice tab uses these rows as its review pool. SRS columns are left null
// here — they're initialized lazily on the user's first practice session for
// the language.
const upsertOnKeep = async (params: {
  userId: string
  targetLanguage: string
  headword: string
  sense: string
  cardId: string
}): Promise<void> => {
  await sql`
    INSERT INTO public.user_lookups (user_id, target_language, headword, sense, first_card_id, count)
    VALUES (
      ${params.userId},
      ${params.targetLanguage},
      ${params.headword},
      ${params.sense},
      ${params.cardId},
      1
    )
    ON CONFLICT (user_id, target_language, headword, sense) DO UPDATE SET
      count = public.user_lookups.count + 1,
      first_card_id = COALESCE(public.user_lookups.first_card_id, EXCLUDED.first_card_id)
  `
}

// Per-language summary used by the Practice landing. Counts:
// - totalKept: rows in user_lookups for the user (proxy for "personal vocab size")
// - dueCount: rows whose srs_due <= now (rows already in the SRS queue)
// - newCount: rows with srs_state IS NULL (never reviewed; would enter as 'new')
const listDueSummary = async (userId: string): Promise<DueSummaryEntry[]> => {
  const result = await sql`
    SELECT
      target_language,
      COUNT(*)::int AS total_kept,
      COUNT(*) FILTER (WHERE srs_state IS NOT NULL AND srs_due IS NOT NULL AND srs_due <= NOW())::int AS due_count,
      COUNT(*) FILTER (WHERE srs_state IS NULL)::int AS new_count
    FROM public.user_lookups
    WHERE user_id = ${userId}
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

// Initialize SRS state on a row that's never been reviewed before, so it
// appears in the queue as 'new' and due now. No-op if srs_state is already
// non-null.
const initializeSrsState = async (params: {
  userId: string
  targetLanguage: string
  headword: string
  sense: string
}): Promise<void> => {
  await sql`
    UPDATE public.user_lookups
    SET srs_state = 'new',
        srs_due = NOW(),
        added_to_practice_at = NOW()
    WHERE user_id = ${params.userId}
      AND target_language = ${params.targetLanguage}
      AND headword = ${params.headword}
      AND sense = ${params.sense}
      AND srs_state IS NULL
  `
}

// Patch the SRS columns from a ts-fsrs Card object. Atomic update — call this
// for every rating event.
const applyFsrsResult = async (params: {
  userId: string
  targetLanguage: string
  headword: string
  sense: string
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
    WHERE user_id = ${params.userId}
      AND target_language = ${params.targetLanguage}
      AND headword = ${params.headword}
      AND sense = ${params.sense}
  `
}

// Lightweight "vocabulary" join: pulls the row's representative card so the
// LLM generation pass can see translation/example fields. Returns a flat shape
// the caller can pass straight into the prompt builder.
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
      ul.headword,
      ul.sense,
      c.translation,
      c.definition,
      c.target_example,
      c.native_example,
      ul.srs_state,
      ul.srs_due,
      ul.srs_reps
    FROM public.user_lookups ul
    LEFT JOIN public.cards c ON c.id = ul.first_card_id
    WHERE ul.user_id = ${params.userId}
      AND ul.target_language = ${params.targetLanguage}
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
  upsertOnExport: (params: {
    userId: string
    targetLanguage: string
    headword: string
    sense: string
    firstCardId: string | null
  }) => Promise<void>
  upsertOnKeep: (params: {
    userId: string
    targetLanguage: string
    headword: string
    sense: string
    cardId: string
  }) => Promise<void>
  listDueSummary: (userId: string) => Promise<DueSummaryEntry[]>
  listEligibleForLanguage: (params: { userId: string; targetLanguage: string }) => Promise<DbUserLookup[]>
  findByKey: (params: {
    userId: string
    targetLanguage: string
    headword: string
    sense: string
  }) => Promise<DbUserLookup | null>
  initializeSrsState: (params: {
    userId: string
    targetLanguage: string
    headword: string
    sense: string
  }) => Promise<void>
  applyFsrsResult: (params: {
    userId: string
    targetLanguage: string
    headword: string
    sense: string
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
    upsertOnExport,
    upsertOnKeep,
    listDueSummary,
    listEligibleForLanguage,
    findByKey,
    initializeSrsState,
    applyFsrsResult,
    listVocabularyForLanguage,
  }
}
