import postgres from 'postgres'
import { beginTx, sql } from '../postgres-client'
import { Tables, Database } from '../database.public.types'
import { resolveRegconfig } from '../text-segments/text-segments-repository'

export type DbUserLookup = Tables<'user_lookups'>
export type SrsState = Database['public']['Enums']['srs_state']

// Per-term knob: every kept term is at minimum 'passive' (recognition pool).
// Promoting to 'active' adds the term to the parallel active-drill pool with
// its own independent SRS state under the active_srs_* columns.
export type LearningMode = 'passive' | 'active'

// Which SRS column set to read or advance. 1:1 with practice_sessions.pool —
// passive sessions read the legacy srs_* columns, active drills read
// active_srs_*.
export type PracticePool = 'passive' | 'active'

export type HeadwordSense = {
  headword: string
  sense: string
}

export type DueSummaryEntry = {
  targetLanguage: string
  totalKept: number
  // Legacy alias for clients that still read `dueCount`; this now maps to
  // daily reviews only, while intraday learning work is exposed separately.
  dueCount: number
  reviewDueCount: number
  learningDueCount: number
  nextLearningDueAt: string | null
  newCount: number
  newIntroducedTodayCount: number
  // Leech-parked terms (excluded from every practice queue until rehab
  // graduates them). The due/learning aggregates above already exclude them.
  parkedCount: number
  // Active-drill pool counters. Parallel to the passive counters above but
  // computed off learning_mode = 'active' and active_srs_* state.
  activeTotal: number
  activeReviewDueCount: number
  activeLearningDueCount: number
  activeNewCount: number
  activeParkedCount: number
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

// Source-relevant pre-filter for the basic-data pass. Returns only the user's
// (headword, sense) pairs whose headword plausibly appears in the source
// segments for `textTrackId` — bounded by source vocabulary, not user vocab.
//
// Mechanism: aggregate the track's text into one tsvector using the
// per-language regconfig (the same one the text_segments_set_tsv trigger
// uses), then keep user_lookups rows where plainto_tsquery(headword) matches.
//
// `plainto_tsquery` parses multi-word headwords as ANDed lexemes after
// stopword removal, which is liberal (false positives only). False negatives
// come from the 'simple' regconfig fallback for languages without a Postgres
// stemmer (zh/ja/ko/vi/etc.) — there's no stemming so inflected headwords
// won't match inflected source forms. The downstream Haiku tiebreaker is the
// correctness gate that catches what slips through.
//
// Also returns the user's total non-deleted vocab count for telemetry — lets
// callers report the prune ratio without an extra round-trip pattern at the
// call site.
const listHeadwordSensesRelevantToTrack = async (params: {
  userId: string
  targetLanguage: string
  textTrackId: string
}): Promise<{ headwordSenses: HeadwordSense[]; totalVocabSize: number }> => {
  const cfg = resolveRegconfig(params.targetLanguage)
  const [filtered, totals] = await Promise.all([
    sql`
      WITH agg AS (
        SELECT to_tsvector(${cfg}::regconfig, string_agg(text, ' ')) AS source_tsv
        FROM public.text_segments
        WHERE text_track_id = ${params.textTrackId}
      )
      SELECT ul.headword, ul.sense
      FROM public.user_lookups ul
      CROSS JOIN agg
      WHERE ul.user_id = ${params.userId}
        AND ul.target_language = ${params.targetLanguage}
        AND ul.deleted_at IS NULL
        AND agg.source_tsv @@ plainto_tsquery(${cfg}::regconfig, ul.headword)
    `,
    sql`
      SELECT COUNT(*)::int AS total
      FROM public.user_lookups
      WHERE user_id = ${params.userId}
        AND target_language = ${params.targetLanguage}
        AND deleted_at IS NULL
    `,
  ])

  const filteredRows = filtered as unknown as Array<{ headword: string; sense: string | null }>
  const totalsRows = totals as unknown as Array<{ total: number }>
  return {
    headwordSenses: filteredRows.map((row) => ({
      headword: row.headword,
      sense: row.sense ?? '',
    })),
    totalVocabSize: totalsRows[0]?.total ?? 0,
  }
}

// Broad lookup of existing senses that may collide with each candidate
// headword. Powers the Haiku tiebreaker — this deliberately overmatches:
// exact lowercase equality OR shared FTS lexemes under the target language
// regconfig. False positives are cheap because Haiku makes the final
// duplicate/distinct decision; false negatives silently create duplicate
// vocabulary rows.
//
// Result is keyed by the lowercased candidate headword so the caller can attach
// the right existing-sense set to each LLM-emitted candidate.
const findPotentialExistingSensesByHeadwords = async (params: {
  userId: string
  targetLanguage: string
  headwords: string[]
}): Promise<Map<string, Array<{ headword: string; sense: string; definition: string | null }>>> => {
  if (params.headwords.length === 0) return new Map()
  const cfg = resolveRegconfig(params.targetLanguage)
  const result = (await sql`
    WITH candidate_inputs AS (
      SELECT DISTINCT candidate_headword
      FROM unnest(${params.headwords}::text[]) AS input(candidate_headword)
    )
    SELECT
      ci.candidate_headword,
      ul.headword,
      ul.sense,
      ul.definition
    FROM candidate_inputs ci
    JOIN public.user_lookups ul
      ON ul.user_id = ${params.userId}
      AND ul.target_language = ${params.targetLanguage}
      AND ul.deleted_at IS NULL
      AND (
        LOWER(ul.headword) = LOWER(ci.candidate_headword)
        OR tsvector_to_array(to_tsvector(${cfg}::regconfig, ul.headword))
          && tsvector_to_array(to_tsvector(${cfg}::regconfig, ci.candidate_headword))
      )
    ORDER BY ci.candidate_headword ASC, ul.headword ASC, ul.sense ASC
  `) as Array<{
    candidate_headword: string
    headword: string
    sense: string | null
    definition: string | null
  }>

  const grouped = new Map<string, Array<{ headword: string; sense: string; definition: string | null }>>()
  for (const row of result) {
    const key = row.candidate_headword.toLowerCase()
    const senses = grouped.get(key) ?? []
    senses.push({ headword: row.headword, sense: row.sense ?? '', definition: row.definition })
    grouped.set(key, senses)
  }
  return grouped
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
// pass an explicit empty string or the corresponding clear flag.
// `explorationExtrasPatch` and `grammarPatch` are shallow-merged into their
// JSONB columns via `||` on the server.
const updateContent = async (params: {
  id: string
  translation?: string | null
  definition?: string | null
  targetExample?: string | null
  nativeExample?: string | null
  clearTranslation?: boolean
  clearNativeExample?: boolean
  explorationExtrasPatch?: Record<string, unknown> | null
  grammarPatch?: Record<string, unknown> | null
  markGrammarUserEdited?: boolean
}): Promise<void> => {
  const extras = params.explorationExtrasPatch ?? null
  const extrasJson = extras ? sql.json(extras as unknown as postgres.JSONValue) : null
  const grammar = params.grammarPatch ?? null
  const grammarJson = grammar ? sql.json(grammar as unknown as postgres.JSONValue) : null
  await sql`
    UPDATE public.user_lookups
    SET
      translation = CASE
        WHEN ${params.clearTranslation ?? false} THEN NULL
        ELSE COALESCE(${params.translation ?? null}, translation)
      END,
      definition = COALESCE(${params.definition ?? null}, definition),
      target_example = COALESCE(${params.targetExample ?? null}, target_example),
      native_example = CASE
        WHEN ${params.clearNativeExample ?? false} THEN NULL
        ELSE COALESCE(${params.nativeExample ?? null}, native_example)
      END,
      exploration_extras = exploration_extras || COALESCE(${extrasJson}::jsonb, '{}'::jsonb),
      grammar = grammar || COALESCE(${grammarJson}::jsonb, '{}'::jsonb),
      grammar_user_edited_at = CASE
        WHEN ${params.markGrammarUserEdited ?? false} THEN NOW()
        ELSE grammar_user_edited_at
      END
    WHERE id = ${params.id}
  `
}

// Apply a wiktionary-grounded grammar patch and stamp grounded_at. Kaikki
// values OVERRIDE the LLM-emitted values where they collide (the whole point
// of grounding is that the structured kaikki data is more reliable than the
// LLM's), so we use `patch || grammar` rather than the additive `grammar ||
// patch` semantics used elsewhere. Other LLM-only keys are preserved.
const applyGroundingPatch = async (params: { id: string; grammarPatch: Record<string, unknown> }): Promise<void> => {
  const grammarJson = sql.json(params.grammarPatch as unknown as postgres.JSONValue)
  await sql`
    UPDATE public.user_lookups
    SET grammar = grammar || ${grammarJson}::jsonb,
        grounded_at = NOW()
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
  markGrammarUserEdited?: boolean
}): Promise<RenameKeyResult> => {
  try {
    await sql`
      UPDATE public.user_lookups
      SET headword = ${params.headword},
          sense = ${params.sense},
          grammar_user_edited_at = CASE
            WHEN ${params.markGrammarUserEdited ?? false} THEN NOW()
            ELSE grammar_user_edited_at
          END
      WHERE id = ${params.id}
    `
    return { ok: true }
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === '23505') return { ok: false, reason: 'CONFLICT' }
    throw err
  }
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
// - reviewDueCount: daily review rows due now, plus initialized 'new' rows
//   due now from abandoned sessions so they don't get stranded
// - learningDueCount: intraday learning/relearning rows due now
// - nextLearningDueAt: soonest future intraday follow-up
// - newCount: rows with srs_state IS NULL (never reviewed; would enter as 'new')
//
// Rows with count = 0 exist because user_lookups is created eagerly at card
// insertion time (so content has a home before triage). Those rows are NOT
// part of the user's vocabulary until they keep at least one card for the
// chunk — hence the count > 0 gate everywhere on the Practice path.
const listDueSummary = async (userId: string): Promise<DueSummaryEntry[]> => {
  const result = await sql`
    SELECT
      ul.target_language,
      COUNT(*)::int AS total_kept,
      COUNT(*) FILTER (
        WHERE ul.srs_state IN ('new', 'review')
          AND ul.srs_due IS NOT NULL
          AND ul.srs_due <= NOW()
          AND ul.leech_parked_at IS NULL
      )::int AS review_due_count,
      COUNT(*) FILTER (
        WHERE ul.srs_state IN ('learning', 'relearning')
          AND ul.srs_due IS NOT NULL
          AND ul.srs_due <= NOW()
          AND ul.leech_parked_at IS NULL
      )::int AS learning_due_count,
      MIN(ul.srs_due) FILTER (
        WHERE ul.srs_state IN ('learning', 'relearning')
          AND ul.srs_due IS NOT NULL
          AND ul.srs_due > NOW()
          AND ul.leech_parked_at IS NULL
      ) AS next_learning_due_at,
      COUNT(*) FILTER (WHERE ul.srs_state IS NULL)::int AS new_count,
      COUNT(*) FILTER (
        WHERE ul.added_to_practice_at >= CURRENT_DATE
          AND ul.added_to_practice_at < CURRENT_DATE + INTERVAL '1 day'
      )::int AS new_introduced_today_count,
      COUNT(*) FILTER (WHERE ul.leech_parked_at IS NOT NULL)::int AS parked_count,
      COUNT(*) FILTER (WHERE ul.learning_mode = 'active')::int AS active_total,
      COUNT(*) FILTER (
        WHERE ul.learning_mode = 'active'
          AND ul.active_srs_state IN ('new', 'review')
          AND ul.active_srs_due IS NOT NULL
          AND ul.active_srs_due <= NOW()
          AND ul.active_leech_parked_at IS NULL
      )::int AS active_review_due_count,
      COUNT(*) FILTER (
        WHERE ul.learning_mode = 'active'
          AND ul.active_srs_state IN ('learning', 'relearning')
          AND ul.active_srs_due IS NOT NULL
          AND ul.active_srs_due <= NOW()
          AND ul.active_leech_parked_at IS NULL
      )::int AS active_learning_due_count,
      COUNT(*) FILTER (
        WHERE ul.learning_mode = 'active'
          AND ul.active_srs_state IS NULL
      )::int AS active_new_count,
      COUNT(*) FILTER (
        WHERE ul.learning_mode = 'active'
          AND ul.active_leech_parked_at IS NOT NULL
      )::int AS active_parked_count
    FROM public.user_lookups ul
    WHERE ul.user_id = ${userId}
      AND ul.count > 0
      AND ul.deleted_at IS NULL
    GROUP BY ul.target_language
    ORDER BY ul.target_language ASC
  `
  return result.map((row) => ({
    targetLanguage: row.target_language as string,
    totalKept: row.total_kept as number,
    dueCount: row.review_due_count as number,
    reviewDueCount: row.review_due_count as number,
    learningDueCount: row.learning_due_count as number,
    nextLearningDueAt: row.next_learning_due_at
      ? new Date(row.next_learning_due_at as string | Date).toISOString()
      : null,
    newCount: row.new_count as number,
    newIntroducedTodayCount: row.new_introduced_today_count as number,
    parkedCount: row.parked_count as number,
    activeTotal: row.active_total as number,
    activeReviewDueCount: row.active_review_due_count as number,
    activeLearningDueCount: row.active_learning_due_count as number,
    activeNewCount: row.active_new_count as number,
    activeParkedCount: row.active_parked_count as number,
  }))
}

// The live review pool for a (language, pool), sliced by scope. This is the
// single source for both render modes and the reading generator's candidate
// set. It replaces both the frozen practice_session_chunks snapshot
// (listEligibleForLanguage) and the passive-only flashcard query
// (listDueFlashcardsForLanguage):
//
//   - `pool` selects the SRS column family. The active pool additionally
//     restricts to learning_mode='active' rows (the passive pool spans every
//     kept term).
//   - `scope` gates the two capped sub-selects: 'review_due' returns due rows
//     only, 'learn_new' returns never-reviewed rows only, 'mixed' returns both
//     merged due-first then new (Anki-standard ordering).
//
// Due cards span review+learning; new are never-reviewed (state IS NULL). The
// two buckets are mutually exclusive (null vs non-null state), so no row
// appears twice.
const listReviewTerms = async (params: {
  userId: string
  targetLanguage: string
  pool: PracticePool
  scope: 'review_due' | 'learn_new' | 'mixed'
  maxReviewTerms: number
  maxNewTerms: number
  excludeUserLookupIds?: string[]
}): Promise<DbUserLookup[]> => {
  const wantDue = params.scope === 'review_due' || params.scope === 'mixed'
  const wantNew = params.scope === 'learn_new' || params.scope === 'mixed'
  const reviewLimit = wantDue ? params.maxReviewTerms : 0
  const newLimit = wantNew ? params.maxNewTerms : 0
  if (reviewLimit <= 0 && newLimit <= 0) return []

  const activeModeClause = params.pool === 'active' ? sql`AND ul.learning_mode = 'active'` : sql``
  const stateCol = params.pool === 'active' ? sql`ul.active_srs_state` : sql`ul.srs_state`
  const dueCol = params.pool === 'active' ? sql`ul.active_srs_due` : sql`ul.srs_due`
  // Leech-parked terms leave BOTH render modes at once — flashcards and the
  // reading-text generator's candidate set feed from this query. That's
  // intentional: reading mode implicitly rates untapped annotations 'good' on
  // advance, which must never mutate a parked term's FSRS. The only way back
  // into rotation is rehab graduation.
  const parkedCol = params.pool === 'active' ? sql`ul.active_leech_parked_at` : sql`ul.leech_parked_at`
  const excludedIds = params.excludeUserLookupIds ?? []
  const excludeClause = excludedIds.length > 0 ? sql`AND NOT (ul.id = ANY(${excludedIds}::uuid[]))` : sql``

  const dueRows =
    reviewLimit > 0
      ? ((await sql`
          SELECT ul.*
          FROM public.user_lookups ul
          WHERE ul.user_id = ${params.userId}
            AND ul.target_language = ${params.targetLanguage}
            AND ul.count > 0
            AND ul.deleted_at IS NULL
            ${activeModeClause}
            ${excludeClause}
            AND ${parkedCol} IS NULL
            AND ${dueCol} IS NOT NULL
            AND ${dueCol} <= NOW()
            AND ${stateCol} IN ('new', 'review', 'learning', 'relearning')
          ORDER BY ${dueCol} ASC, ul.headword ASC, ul.sense ASC
          LIMIT ${reviewLimit}
        `) as DbUserLookup[])
      : []

  const newRows =
    newLimit > 0
      ? ((await sql`
          SELECT ul.*
          FROM public.user_lookups ul
          WHERE ul.user_id = ${params.userId}
            AND ul.target_language = ${params.targetLanguage}
            AND ul.count > 0
            AND ul.deleted_at IS NULL
            ${activeModeClause}
            ${excludeClause}
            AND ${parkedCol} IS NULL
            AND ${stateCol} IS NULL
          ORDER BY ul.created_at ASC, ul.headword ASC, ul.sense ASC
          LIMIT ${newLimit}
        `) as DbUserLookup[])
      : []

  return [...dueRows, ...newRows]
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

// Sibling of findByIdForUser that does NOT filter out soft-deleted rows. Used
// by restoreChunk: a deleted row is exactly what we're looking up. Keeping
// the deleted-filter in the default lookup avoids accidental leakage in the
// many handlers that should never see soft-deleted entries.
const findByIdForUserIncludingDeleted = async (id: string, userId: string): Promise<DbUserLookup | null> => {
  const result = (await sql`
    SELECT *
    FROM public.user_lookups
    WHERE id = ${id}
      AND user_id = ${userId}
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

// Pool-aware initializer. The passive pool path is identical to
// initializeSrsState (and also stamps added_to_practice_at for the daily-new
// cap). The active pool path only touches active_srs_*; it must NOT bump
// added_to_practice_at because the daily-new cap is passive-only — an active
// drill should not eat the user's passive new-term allowance for the day.
const initializeSrsStateForPool = async (params: { userLookupId: string; pool: PracticePool }): Promise<void> => {
  if (params.pool === 'passive') {
    await sql`
      UPDATE public.user_lookups
      SET srs_state = 'new',
          srs_due = NOW(),
          added_to_practice_at = NOW()
      WHERE id = ${params.userLookupId}
        AND srs_state IS NULL
    `
    return
  }
  await sql`
    UPDATE public.user_lookups
    SET active_srs_state = 'new',
        active_srs_due = NOW()
    WHERE id = ${params.userLookupId}
      AND active_srs_state IS NULL
  `
}

// Race-safe daily-new-cap guard for the flashcard reviewer. Introduces a
// never-reviewed row into the passive pool (srs_state='new', due now, stamped
// added_to_practice_at) only when the day's introduced count for this
// (user, language) is still under maxNewTerms.
//
// The advisory transaction lock serializes all flashcard introductions for the
// same user/language. A single UPDATE with COUNT(*) still races across two
// different target rows because each transaction can see the same pre-update
// aggregate. The lock keeps the count + update decision one-at-a-time.
const initializeSrsStateIfUnderDailyCap = async (params: {
  userLookupId: string
  userId: string
  targetLanguage: string
  maxNewTerms: number
}): Promise<boolean> => {
  return await beginTx(async (tx) => {
    await tx`
      SELECT pg_advisory_xact_lock(hashtext(${`flashcards:${params.userId}:${params.targetLanguage}`}))
    `
    const rows = (await tx`
      UPDATE public.user_lookups
      SET srs_state = 'new',
          srs_due = NOW(),
          added_to_practice_at = NOW()
      WHERE id = ${params.userLookupId}
        AND user_id = ${params.userId}
        AND target_language = ${params.targetLanguage}
        AND count > 0
        AND srs_state IS NULL
        AND deleted_at IS NULL
        AND (
          SELECT COUNT(*)
          FROM public.user_lookups
          WHERE user_id = ${params.userId}
            AND target_language = ${params.targetLanguage}
            AND count > 0
            AND deleted_at IS NULL
            AND added_to_practice_at >= CURRENT_DATE
            AND added_to_practice_at < CURRENT_DATE + INTERVAL '1 day'
        ) < ${params.maxNewTerms}
      RETURNING id
    `) as Array<{ id: string }>
    return rows.length > 0
  })
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

// Pool-aware FSRS patch. The passive pool path matches applyFsrsResult; the
// active pool path writes the same fields under their active_srs_* names.
const applyFsrsResultForPool = async (params: {
  userLookupId: string
  pool: PracticePool
  state: SrsState
  due: Date
  stability: number
  difficulty: number
  lastReview: Date
  reps: number
  lapses: number
}): Promise<void> => {
  if (params.pool === 'passive') {
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
    return
  }
  await sql`
    UPDATE public.user_lookups
    SET active_srs_state = ${params.state},
        active_srs_due = ${params.due.toISOString()},
        active_srs_stability = ${params.stability},
        active_srs_difficulty = ${params.difficulty},
        active_srs_last_review = ${params.lastReview.toISOString()},
        active_srs_reps = ${params.reps},
        active_srs_lapses = ${params.lapses}
    WHERE id = ${params.userLookupId}
  `
}

// Switch a user_lookup between passive and active learning modes. Demoting
// active -> passive preserves active_srs_* so a future re-promotion resumes
// the schedule — but a REAL pool move resets the active leech-rehab state:
// the active pool's membership was created/destroyed, so any in-flight rehab
// progress (or parked flag) for that family is stale. The reset lives inside
// this UPDATE (guarded by IS DISTINCT FROM) so every pool-move surface
// (card triage, vocabulary tab) gets it, and idempotent "keep as active"
// re-stamps — which call this with an unchanged mode — never wipe progress.
// Passive rehab is untouched: passive membership never changes.
// Returns the post-update row.
const setLearningMode = async (params: {
  userLookupId: string
  userId: string
  learningMode: LearningMode
}): Promise<DbUserLookup | null> => {
  const result = (await sql`
    UPDATE public.user_lookups
    SET learning_mode = ${params.learningMode},
        active_leech_parked_at = NULL,
        active_leech_rehab_correct_days = 0,
        active_leech_rehab_last_correct_on = NULL
    WHERE id = ${params.userLookupId}
      AND user_id = ${params.userId}
      AND deleted_at IS NULL
      AND learning_mode IS DISTINCT FROM ${params.learningMode}
    RETURNING *
  `) as DbUserLookup[]
  if (result[0]) return result[0]
  // No mode change (idempotent re-stamp) — return the current row untouched.
  return findByIdForUser(params.userLookupId, params.userId)
}

// =========================================================================
// Leech parking / rehab
// =========================================================================

// Park a term out of the given pool's practice rotation. Zeroes any stale
// rehab progress so the graduation ladder always starts at day 0. The
// parked_at IS NULL guard makes a double-park (e.g. two racing rating events)
// a no-op rather than a rehab-progress reset.
const parkLeech = async (params: { userLookupId: string; pool: PracticePool }): Promise<void> => {
  if (params.pool === 'passive') {
    await sql`
      UPDATE public.user_lookups
      SET leech_parked_at = NOW(),
          leech_rehab_correct_days = 0,
          leech_rehab_last_correct_on = NULL
      WHERE id = ${params.userLookupId}
        AND leech_parked_at IS NULL
    `
    return
  }
  await sql`
    UPDATE public.user_lookups
    SET active_leech_parked_at = NOW(),
        active_leech_rehab_correct_days = 0,
        active_leech_rehab_last_correct_on = NULL
    WHERE id = ${params.userLookupId}
      AND active_leech_parked_at IS NULL
  `
}

// One graduation-day credit for a correct gate-exercise answer. The
// IS DISTINCT FROM CURRENT_DATE guard enforces at most one advance per server
// calendar day — massed same-day correct answers count once. Returns the new
// correct-day count, or null when no advance happened (already credited
// today, or the term isn't parked in this pool).
const advanceRehabDay = async (params: { userLookupId: string; pool: PracticePool }): Promise<number | null> => {
  if (params.pool === 'passive') {
    const rows = (await sql`
      UPDATE public.user_lookups
      SET leech_rehab_correct_days = leech_rehab_correct_days + 1,
          leech_rehab_last_correct_on = CURRENT_DATE
      WHERE id = ${params.userLookupId}
        AND leech_parked_at IS NOT NULL
        AND leech_rehab_last_correct_on IS DISTINCT FROM CURRENT_DATE
      RETURNING leech_rehab_correct_days
    `) as Array<{ leech_rehab_correct_days: number }>
    return rows[0]?.leech_rehab_correct_days ?? null
  }
  const rows = (await sql`
    UPDATE public.user_lookups
    SET active_leech_rehab_correct_days = active_leech_rehab_correct_days + 1,
        active_leech_rehab_last_correct_on = CURRENT_DATE
    WHERE id = ${params.userLookupId}
      AND active_leech_parked_at IS NOT NULL
      AND active_leech_rehab_last_correct_on IS DISTINCT FROM CURRENT_DATE
    RETURNING active_leech_rehab_correct_days
  `) as Array<{ active_leech_rehab_correct_days: number }>
  return rows[0]?.active_leech_rehab_correct_days ?? null
}

// Parked terms for the Strengthen session's gated track, oldest-parked first
// so the longest-stranded terms get rehab attention first.
const listParkedTerms = async (params: {
  userId: string
  targetLanguage: string
  pool: PracticePool
}): Promise<DbUserLookup[]> => {
  const parkedCol = params.pool === 'active' ? sql`ul.active_leech_parked_at` : sql`ul.leech_parked_at`
  const activeModeClause = params.pool === 'active' ? sql`AND ul.learning_mode = 'active'` : sql``
  return (await sql`
    SELECT ul.*
    FROM public.user_lookups ul
    WHERE ul.user_id = ${params.userId}
      AND ul.target_language = ${params.targetLanguage}
      AND ul.count > 0
      AND ul.deleted_at IS NULL
      ${activeModeClause}
      AND ${parkedCol} IS NOT NULL
    ORDER BY ${parkedCol} ASC, ul.headword ASC, ul.sense ASC
  `) as DbUserLookup[]
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
  grammar: Record<string, unknown>
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
      ul.grammar,
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
    grammar: (row.grammar as Record<string, unknown> | null) ?? {},
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
  grammar: Record<string, unknown>
  groundedAt: string | null
  grammarUserEditedAt: string | null
  count: number
  srsState: SrsState | null
  srsDue: string | null
  srsReps: number
  learningMode: LearningMode
  activeSrsState: SrsState | null
  activeSrsDue: string | null
  activeSrsReps: number
  createdAt: string
  firstCardId: string | null
  firstCardSegmentId: string | null
  studySessionId: string | null
  sourceAvailable: boolean
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
    ul.grammar,
    ul.grounded_at,
    ul.grammar_user_edited_at,
    ul.count,
    ul.srs_state,
    ul.srs_due,
    ul.srs_reps,
    ul.learning_mode,
    ul.active_srs_state,
    ul.active_srs_due,
    ul.active_srs_reps,
    ul.created_at,
    ul.first_card_id,
    c.segment_id AS first_card_segment_id,
    c.study_session_id,
    (s.id IS NOT NULL AND cs.type != 'adhoc') AS source_available
  FROM public.user_lookups ul
  LEFT JOIN public.cards c ON c.id = ul.first_card_id
  LEFT JOIN public.study_sessions s ON s.id = c.study_session_id AND s.deleted_at IS NULL
  LEFT JOIN public.content_sources cs ON cs.id = s.content_source_id
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
  grammar: ((row.grammar as Record<string, unknown> | null) ?? {}) as Record<string, unknown>,
  groundedAt: (row.grounded_at as string | null) ?? null,
  grammarUserEditedAt: (row.grammar_user_edited_at as string | null) ?? null,
  count: (row.count as number) ?? 0,
  srsState: (row.srs_state as SrsState | null) ?? null,
  srsDue: (row.srs_due as string | null) ?? null,
  srsReps: (row.srs_reps as number) ?? 0,
  learningMode: (row.learning_mode as LearningMode | null) ?? 'passive',
  activeSrsState: (row.active_srs_state as SrsState | null) ?? null,
  activeSrsDue: (row.active_srs_due as string | null) ?? null,
  activeSrsReps: (row.active_srs_reps as number) ?? 0,
  createdAt: row.created_at as string,
  firstCardId: (row.first_card_id as string | null) ?? null,
  firstCardSegmentId: (row.first_card_segment_id as string | null) ?? null,
  studySessionId: (row.study_session_id as string | null) ?? null,
  sourceAvailable: row.source_available === true,
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
  learningMode?: LearningMode | null
}): Promise<{ rows: ChunkRow[]; nextCursor: ChunksCursor | null }> => {
  const limit = Math.max(1, Math.min(params.limit, 200))
  const fetchLimit = limit + 1
  const searchClause = buildSearchClause(params.q)
  const learningModeClause = params.learningMode ? sql`AND ul.learning_mode = ${params.learningMode}` : sql``

  if (params.sort === 'recent') {
    const cursor = params.cursor && params.cursor.sort === 'recent' ? params.cursor : null
    const rows = (await sql`
      ${SELECT_CHUNK_ROW_SQL}
      WHERE ul.user_id = ${params.userId}
        AND ul.target_language = ${params.targetLanguage}
        AND ul.deleted_at IS NULL
        AND ul.count > 0
        ${searchClause}
        ${learningModeClause}
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
        ${learningModeClause}
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
        ${learningModeClause}
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
      ${learningModeClause}
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
// shipping a practice text to the client. Soft-deleted rows are still
// returned so the rate sheet can render the "deleted, tap to restore" state;
// `deletedAt` lets the renderer distinguish. We fetch all rows for the (user,
// language) and let the caller index by (headword, sense); typical user
// vocabularies stay in the low hundreds, so the simple query beats composing
// an array-tuple WHERE clause.
const listChunkContentForKeys = async (params: {
  userId: string
  targetLanguage: string
  keys: Array<{ headword: string; sense: string }>
}): Promise<
  Array<{
    id: string
    headword: string
    sense: string
    translation: string | null
    definition: string | null
    grammar: Record<string, unknown> | null
    firstCardId: string | null
    firstCardSessionId: string | null
    deletedAt: Date | null
    learningMode: LearningMode
  }>
> => {
  if (params.keys.length === 0) return []
  const result = (await sql`
    SELECT
      ul.id,
      ul.headword,
      ul.sense,
      ul.translation,
      ul.definition,
      ul.grammar,
      ul.first_card_id,
      ul.deleted_at,
      ul.learning_mode,
      c.study_session_id AS first_card_session_id
    FROM public.user_lookups ul
    LEFT JOIN public.cards c ON c.id = ul.first_card_id
    WHERE ul.user_id = ${params.userId}
      AND ul.target_language = ${params.targetLanguage}
  `) as Array<{
    id: string
    headword: string
    sense: string
    translation: string | null
    definition: string | null
    grammar: Record<string, unknown> | null
    first_card_id: string | null
    first_card_session_id: string | null
    deleted_at: Date | null
    learning_mode: LearningMode
  }>
  return result.map((row) => ({
    id: row.id,
    headword: row.headword,
    sense: row.sense,
    translation: row.translation,
    definition: row.definition,
    grammar: row.grammar,
    firstCardId: row.first_card_id,
    firstCardSessionId: row.first_card_session_id,
    deletedAt: row.deleted_at,
    learningMode: row.learning_mode,
  }))
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

const restoreChunk = async (id: string, userId: string): Promise<void> => {
  await sql`
    UPDATE public.user_lookups
    SET deleted_at = NULL
    WHERE id = ${id}
      AND user_id = ${userId}
      AND deleted_at IS NOT NULL
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
  listHeadwordSensesRelevantToTrack: (params: {
    userId: string
    targetLanguage: string
    textTrackId: string
  }) => Promise<{ headwordSenses: HeadwordSense[]; totalVocabSize: number }>
  findPotentialExistingSensesByHeadwords: (params: {
    userId: string
    targetLanguage: string
    headwords: string[]
  }) => Promise<Map<string, Array<{ headword: string; sense: string; definition: string | null }>>>
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
    clearTranslation?: boolean
    clearNativeExample?: boolean
    explorationExtrasPatch?: Record<string, unknown> | null
    grammarPatch?: Record<string, unknown> | null
    markGrammarUserEdited?: boolean
  }) => Promise<void>
  applyGroundingPatch: (params: { id: string; grammarPatch: Record<string, unknown> }) => Promise<void>
  renameKey: (params: {
    id: string
    headword: string
    sense: string
    markGrammarUserEdited?: boolean
  }) => Promise<RenameKeyResult>
  applyKeepTransition: (params: { userLookupId: string; cardId: string }) => Promise<void>
  applyUnkeepTransition: (params: { userLookupId: string }) => Promise<void>
  listDueSummary: (userId: string) => Promise<DueSummaryEntry[]>
  listReviewTerms: (params: {
    userId: string
    targetLanguage: string
    pool: PracticePool
    scope: 'review_due' | 'learn_new' | 'mixed'
    maxReviewTerms: number
    maxNewTerms: number
    excludeUserLookupIds?: string[]
  }) => Promise<DbUserLookup[]>
  findByKey: (params: {
    userId: string
    targetLanguage: string
    headword: string
    sense: string
  }) => Promise<DbUserLookup | null>
  findByIdForUser: (id: string, userId: string) => Promise<DbUserLookup | null>
  findByIdForUserIncludingDeleted: (id: string, userId: string) => Promise<DbUserLookup | null>
  initializeSrsState: (userLookupId: string) => Promise<void>
  initializeSrsStateForPool: (params: { userLookupId: string; pool: PracticePool }) => Promise<void>
  initializeSrsStateIfUnderDailyCap: (params: {
    userLookupId: string
    userId: string
    targetLanguage: string
    maxNewTerms: number
  }) => Promise<boolean>
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
  applyFsrsResultForPool: (params: {
    userLookupId: string
    pool: PracticePool
    state: SrsState
    due: Date
    stability: number
    difficulty: number
    lastReview: Date
    reps: number
    lapses: number
  }) => Promise<void>
  setLearningMode: (params: {
    userLookupId: string
    userId: string
    learningMode: LearningMode
  }) => Promise<DbUserLookup | null>
  parkLeech: (params: { userLookupId: string; pool: PracticePool }) => Promise<void>
  advanceRehabDay: (params: { userLookupId: string; pool: PracticePool }) => Promise<number | null>
  listParkedTerms: (params: { userId: string; targetLanguage: string; pool: PracticePool }) => Promise<DbUserLookup[]>
  listVocabularyForLanguage: (params: { userId: string; targetLanguage: string }) => Promise<VocabularyRow[]>
  listKeptChunksForExport: (params: { userId: string; targetLanguage: string }) => Promise<ExportChunkRow[]>
  listChunksForLanguage: (params: {
    userId: string
    targetLanguage: string
    sort: ChunksSort
    cursor: ChunksCursor | null
    limit: number
    q: string | null
    learningMode?: LearningMode | null
  }) => Promise<{ rows: ChunkRow[]; nextCursor: ChunksCursor | null }>
  softDeleteChunk: (id: string, userId: string) => Promise<void>
  restoreChunk: (id: string, userId: string) => Promise<void>
  listChunkContentForKeys: (params: {
    userId: string
    targetLanguage: string
    keys: Array<{ headword: string; sense: string }>
  }) => Promise<
    Array<{
      id: string
      headword: string
      sense: string
      translation: string | null
      definition: string | null
      grammar: Record<string, unknown> | null
      firstCardId: string | null
      firstCardSessionId: string | null
      deletedAt: Date | null
      learningMode: LearningMode
    }>
  >
  listLanguagesForUser: (userId: string) => Promise<string[]>
}

export const UserLookupsRepository = (): UserLookupsRepositoryInterface => {
  return {
    listHeadwordSensesForLanguage,
    listHeadwordSensesRelevantToTrack,
    findPotentialExistingSensesByHeadwords,
    findOrCreate,
    updateContent,
    applyGroundingPatch,
    renameKey,
    applyKeepTransition,
    applyUnkeepTransition,
    listDueSummary,
    listReviewTerms,
    findByKey,
    findByIdForUser,
    findByIdForUserIncludingDeleted,
    initializeSrsState,
    initializeSrsStateForPool,
    initializeSrsStateIfUnderDailyCap,
    applyFsrsResult,
    applyFsrsResultForPool,
    setLearningMode,
    parkLeech,
    advanceRehabDay,
    listParkedTerms,
    listVocabularyForLanguage,
    listKeptChunksForExport,
    listChunksForLanguage,
    softDeleteChunk,
    restoreChunk,
    listChunkContentForKeys,
    listLanguagesForUser,
  }
}
