import postgres from 'postgres'
import { beginTx, sql } from '../postgres-client'
import { newTermNotDecayedSql, newTermOrderSql, newTermTierSql } from '../../../service/practice/new-term-priority'
import { Tables, Database } from '../database.public.types'
import { resolveRegconfig } from '../text-segments/text-segments-repository'
import {
  CITATION_FORM,
  enableFacet,
  ensureDefaultCitationFacetIfUnconfigured,
  ensureFacet,
  skillForPool,
  skillsForPool,
  type DbStudyFacet,
  type FacetSkill,
  type PracticePool,
} from '../study-facets/study-facets-repository'

export type DbUserLookup = Tables<'user_lookups'>
export type SrsState = Database['public']['Enums']['srs_state']

// A user_lookups row joined with one facet's FSRS + leech state, flattened with
// the legacy srs_*/leech_* column names so the rating/leech services read a
// single column family (the facet's skill already encodes the pool — there is
// no per-pool column mirror). `skill`/`target_form` carry the facet identity for
// the writers. Produced by the facet-joined readers (listReviewTerms,
// listParkedTerms) and by mergeFacet at the rating boundary.
export type DbUserLookupWithFacet = DbUserLookup & {
  skill: FacetSkill
  target_form: string
  srs_state: SrsState | null
  srs_due: string | null
  srs_stability: number | null
  srs_difficulty: number | null
  srs_last_review: string | null
  srs_reps: number
  srs_lapses: number
  srs_learning_steps: number
  leech_parked_at: string | null
  leech_rehab_correct_days: number
  leech_rehab_last_correct_on: string | null
  introduced_at: string | null
  // Form facets carry {form, translation}; citation cards carry {}. Surfaced to
  // the queue DTO (facetPayload). Populated in Phase 4.
  payload: DbStudyFacet['payload']
  // True iff an ENABLED citation meaning_production facet exists for this term
  // — the derived "in production study" / production-pool membership flag
  // (replaces the dropped user_lookups.learning_mode column). For the
  // production-pool readers (listReviewTerms/listParkedTerms with
  // pool='production') the merged facet IS that production facet, so this
  // mirrors `disabled_at IS NULL` on it; the production queries already filter
  // to enabled production facets, so it is always true there. Service-layer
  // guards read this instead of learning_mode.
  is_production_enabled: boolean
}

// Flatten a (lookup, facet) pair into the combined row the rating/leech
// services consume. Used at the flashcard and reading rating boundaries where
// the term and its facet are fetched separately.
export const mergeFacet = (lookup: DbUserLookup, facet: DbStudyFacet): DbUserLookupWithFacet => ({
  ...lookup,
  skill: facet.skill as FacetSkill,
  target_form: facet.target_form,
  srs_state: facet.srs_state,
  srs_due: facet.srs_due,
  srs_stability: facet.srs_stability,
  srs_difficulty: facet.srs_difficulty,
  srs_last_review: facet.srs_last_review,
  srs_reps: facet.srs_reps,
  srs_lapses: facet.srs_lapses,
  srs_learning_steps: facet.srs_learning_steps,
  leech_parked_at: facet.leech_parked_at,
  leech_rehab_correct_days: facet.leech_rehab_correct_days,
  leech_rehab_last_correct_on: facet.leech_rehab_last_correct_on,
  introduced_at: facet.introduced_at,
  payload: facet.payload,
  // The production-pool membership flag is the production citation facet's
  // enabled state. mergeFacet is the rating boundary: a production rating
  // merges THE production citation facet, so its own disabled_at is the source
  // of truth. For any other facet (recognition, forms) production-membership
  // isn't carried here and is irrelevant to the production-pool guards, so it
  // resolves false.
  is_production_enabled:
    facet.skill === 'meaning_production' && facet.target_form === CITATION_FORM && facet.disabled_at === null,
})

// One study facet projected for the Study-targets control (listFacetsForChunk).
// Structurally matches StudyFacetSummarySchema in api-client; declared locally
// to keep this repository decoupled from the contract package (same convention
// as ChunkRow).
// The encountered occurrence backing a study target. Matches
// StudyFacetSourceSchema in api-client; declared locally to keep the repo
// decoupled from the contract package (ChunkRow convention).
export type FacetSource = {
  sessionId: string
  segmentId: string
  textTrackId: string
  sentence: string
}

export type ChunkFacetSummary = {
  skill: FacetSkill
  targetForm: string
  enabled: boolean
  dataStatus: 'ready' | 'pending_data'
  srsState: SrsState | null
  payload: Record<string, unknown>
  // Snapshot of the payload as the generate pass wrote it (generated_payload
  // column). Null for manually-entered / legacy form facets.
  generatedPayload: Record<string, unknown> | null
  // The most-recent kept card backing this target (its inflection's occurrence;
  // the lemma's for citation), joined to its source segment. null when there's
  // no kept occurrence with a readable source (adhoc session / no text track).
  source: FacetSource | null
}

export type { PracticePool }

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
  // Recognition-facet stage populations from the shared vocabStageClauseSql
  // partition — identical predicates to the Vocabulary tab's stage filters, so
  // the practice landing's funnel and the filtered lists agree by construction.
  // warmupCount / parkedCount below carry the warming_up / strengthen stages.
  upNextCount: number
  learningCount: number
  reviewCount: number
  unseenCount: number
  // Unseen OPT-IN facets (pronunciation / specific forms — everything except
  // the daily-new-capped citation facet of each pool) that are enabled+ready,
  // split by pool. These are served only in learn-new sessions, so the
  // landing's Learn-new affordances need them; newCount/productionNewCount stay
  // citation-only because the mixed Practice queue never serves opt-ins.
  optInNewCount: number
  productionOptInNewCount: number
  // Parked recognition terms, split by origin (both are excluded from every
  // practice queue; the due/learning aggregates already exclude them):
  //   parkedCount  — genuine leeches (parked + srs_state NOT NULL), surfaced as
  //                  "N parked — strengthen them".
  //   warmupCount  — exercise-first onboarding terms still climbing the ladder
  //                  (parked + never-reviewed, srs_state NULL), surfaced as
  //                  "N warming up — continue". Recognition-only (warm-up never
  //                  parks production facets).
  parkedCount: number
  warmupCount: number
  // Production-pool counters. Parallel to the recognition counters above but
  // computed off the enabled citation meaning_production facet (membership) and
  // its SRS state. productionParkedCount / productionWarmupCount split the parked
  // production facets the same way parkedCount / warmupCount split recognition:
  //   productionParkedCount  — genuine leeches (parked + srs_state NOT NULL).
  //   productionWarmupCount  — exercise-first onboarding (parked + srs_state NULL).
  productionTotal: number
  productionReviewDueCount: number
  productionLearningDueCount: number
  productionNewCount: number
  productionParkedCount: number
  productionWarmupCount: number
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

// One row of the lesson-import duplicate resolution: an existing vocabulary
// term matching an extracted headword, with the production-citation facet's
// SRS state and the term's enabled skills — everything the extract job needs
// to compute the planned action (create / add_facet / lapse_and_add_facet).
export type HeadwordMatch = {
  id: string
  headword: string
  sense: string
  count: number
  // The citation meaning_production facet's state; nulls when absent.
  productionSrsState: SrsState | null
  productionEnabled: boolean
  productionParked: boolean
  enabledSkills: FacetSkill[]
}

// Case-insensitive exact-headword matches against the user's live vocabulary.
// Keyed by the lowercased headword; a headword with several senses returns
// several rows (the caller picks — sense '' first).
const listByHeadwords = async (params: {
  userId: string
  targetLanguage: string
  headwords: string[]
}): Promise<Map<string, HeadwordMatch[]>> => {
  if (params.headwords.length === 0) return new Map()
  const result = (await sql`
    SELECT
      ul.id,
      ul.headword,
      ul.sense,
      ul.count,
      pf.srs_state AS production_srs_state,
      (pf.id IS NOT NULL AND pf.disabled_at IS NULL) AS production_enabled,
      (pf.leech_parked_at IS NOT NULL) AS production_parked,
      COALESCE(
        (
          SELECT array_agg(DISTINCT f.skill)
          FROM public.study_facets f
          WHERE f.user_lookup_id = ul.id AND f.disabled_at IS NULL
        ),
        '{}'
      ) AS enabled_skills
    FROM public.user_lookups ul
    LEFT JOIN public.study_facets pf
      ON pf.user_lookup_id = ul.id AND pf.skill = 'meaning_production' AND pf.target_form = ''
    WHERE ul.user_id = ${params.userId}
      AND ul.target_language = ${params.targetLanguage}
      AND ul.deleted_at IS NULL
      AND LOWER(ul.headword) = ANY(SELECT LOWER(h) FROM unnest(${params.headwords}::text[]) AS h)
    ORDER BY ul.headword ASC, ul.sense ASC
  `) as Array<{
    id: string
    headword: string
    sense: string | null
    count: number
    production_srs_state: SrsState | null
    production_enabled: boolean
    production_parked: boolean
    enabled_skills: FacetSkill[]
  }>

  const grouped = new Map<string, HeadwordMatch[]>()
  for (const row of result) {
    const key = row.headword.toLowerCase()
    const matches = grouped.get(key) ?? []
    matches.push({
      id: row.id,
      headword: row.headword,
      sense: row.sense ?? '',
      count: row.count,
      productionSrsState: row.production_srs_state,
      productionEnabled: row.production_enabled,
      productionParked: row.production_parked,
      enabledSkills: row.enabled_skills ?? [],
    })
    grouped.set(key, matches)
  }
  return grouped
}

// Idempotent get-or-insert keyed by (user_id, target_language, headword, sense).
// Called at card-creation time so the user_lookups row always exists by the
// time the card row references it. The no-op DO UPDATE clause exists solely so
// RETURNING gives us the existing row when there's a conflict.
const findOrCreate = async (
  params: {
    userId: string
    targetLanguage: string
    headword: string
    sense: string
  },
  executor: postgres.Sql = sql
): Promise<DbUserLookup> => {
  // Re-keeping a previously soft-deleted chunk revives it: clear deleted_at
  // on conflict so the row reappears in the Vocabulary list and Practice queue.
  const result = (await executor`
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

// Bump the new-term priority signals at a user-intent boundary (saving a
// highlight, confirming a lesson import). encounter_count >= 2 is the tier-1
// "revealed demand" signal, and last_encountered_at drives freshness + decay.
// The collapse window makes retries and multi-chunk runs idempotent regardless
// of call site: a bump within an hour of the last one is a no-op, so a worker
// retry (or a batch touching the same lookup twice) can never inflate a single
// save into tier 1. Rows created moments ago (last_encountered_at defaults to
// NOW()) are skipped for the same reason — their creation IS the encounter.
const recordEncounter = async (userLookupIds: string[], executor: postgres.Sql = sql): Promise<void> => {
  if (userLookupIds.length === 0) return
  await executor`
    UPDATE public.user_lookups
    SET encounter_count = encounter_count + 1,
        last_encountered_at = NOW()
    WHERE id = ANY(${userLookupIds}::uuid[])
      AND last_encountered_at < NOW() - INTERVAL '1 hour'
  `
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
  zipf?: number | null
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
      zipf_estimate = COALESCE(${params.zipf ?? null}, zipf_estimate),
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
  // grounding_patch is replaced wholesale (the latest grounding run owns the
  // snapshot) — per-field provenance compares grammar values against it.
  await sql`
    UPDATE public.user_lookups
    SET grammar = grammar || ${grammarJson}::jsonb,
        grounding_patch = ${grammarJson}::jsonb,
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
  // The count bump and the citation recognition facet creation must commit
  // together: once a queueable facet is required on keep, a failure between the
  // two would leave a kept term that can never appear in practice. The facet is
  // a DEFAULT, not a mandate: it's created only when the term has no facet rows
  // yet — a study-target configuration made pre-keep in the focus view
  // (e.g. pronunciation-only) must survive Keep. Idempotent, so a re-keep /
  // repair pass is safe.
  await beginTx(async (tx) => {
    await tx`
      UPDATE public.user_lookups
      SET count = count + 1,
          first_card_id = COALESCE(first_card_id, ${params.cardId}),
          deleted_at = NULL
      WHERE id = ${params.userLookupId}
    `
    await ensureDefaultCitationFacetIfUnconfigured(params.userLookupId, tx)
  })
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
// insertion time (so content has a home before keep). Those rows are NOT
// part of the user's vocabulary until they keep at least one card for the
// chunk — hence the count > 0 gate everywhere on the Practice path.
const listDueSummary = async (userId: string): Promise<DueSummaryEntry[]> => {
  // Recognition numbers read the citation meaning_recognition facet; the
  // production mirror reads the citation meaning_production facet. Both are 1:1
  // with the term (target_form=''), so the LEFT JOINs never fan out.
  //
  // Every queue-feeding count requires an ENABLED (id IS NOT NULL via the
  // state predicates, disabled_at IS NULL) and READY (data_status = 'ready')
  // facet — the queue (listReviewTerms) filters both, so a recognition skill
  // the user switched off, or a production facet whose card data is still
  // generating, must not inflate the landing numbers (it would promise cards
  // the queue then refuses to serve). The parked counts skip the data_status
  // check to mirror their consumer (listParkedTerms doesn't filter it).
  // new_count needs the explicit rf.id check because its `srs_state IS NULL`
  // test is also true on a join miss. It also excludes leech_parked_at: an
  // exercise-first warm-up term is parked AND never-reviewed (srs_state NULL),
  // and the queue (listReviewTerms) won't serve a parked term, so counting it
  // here would promise a new card the queue refuses. newIntroducedTodayCount
  // intentionally
  // stays unfiltered: it feeds the remaining-daily-new budget, and an
  // introduction performed today consumed that budget even if the facet was
  // disabled later.
  const result = await sql`
    SELECT
      ul.target_language,
      COUNT(*)::int AS total_kept,
      COUNT(*) FILTER (
        WHERE rf.disabled_at IS NULL
          AND rf.data_status = 'ready'
          AND rf.srs_state IN ('new', 'review')
          AND rf.srs_due IS NOT NULL
          AND rf.srs_due <= NOW()
          AND rf.leech_parked_at IS NULL
      )::int AS review_due_count,
      COUNT(*) FILTER (
        WHERE rf.disabled_at IS NULL
          AND rf.data_status = 'ready'
          AND rf.srs_state IN ('learning', 'relearning')
          AND rf.srs_due IS NOT NULL
          AND rf.srs_due <= NOW()
          AND rf.leech_parked_at IS NULL
      )::int AS learning_due_count,
      MIN(rf.srs_due) FILTER (
        WHERE rf.disabled_at IS NULL
          AND rf.data_status = 'ready'
          AND rf.srs_state IN ('learning', 'relearning')
          AND rf.srs_due IS NOT NULL
          AND rf.srs_due > NOW()
          AND rf.leech_parked_at IS NULL
      ) AS next_learning_due_at,
      COUNT(*) FILTER (
        WHERE rf.id IS NOT NULL AND rf.disabled_at IS NULL
          AND rf.data_status = 'ready' AND rf.srs_state IS NULL
          AND rf.leech_parked_at IS NULL
          AND ${newTermNotDecayedSql()}
      )::int AS new_count,
      COUNT(*) FILTER (
        WHERE rf.introduced_at >= CURRENT_DATE
          AND rf.introduced_at < CURRENT_DATE + INTERVAL '1 day'
      )::int AS new_introduced_today_count,
      COUNT(*) FILTER (WHERE ${vocabStageClauseSql('up_next')})::int AS up_next_count,
      COUNT(*) FILTER (WHERE ${vocabStageClauseSql('learning')})::int AS learning_count,
      COUNT(*) FILTER (WHERE ${vocabStageClauseSql('review')})::int AS review_count,
      COUNT(*) FILTER (WHERE ${vocabStageClauseSql('unseen')})::int AS unseen_count,
      COUNT(*) FILTER (
        WHERE rf.disabled_at IS NULL AND rf.leech_parked_at IS NOT NULL
          AND rf.srs_state IS NOT NULL
      )::int AS parked_count,
      COUNT(*) FILTER (
        WHERE rf.disabled_at IS NULL AND rf.leech_parked_at IS NOT NULL
          AND rf.srs_state IS NULL
      )::int AS warmup_count,
      COUNT(*) FILTER (WHERE pf.id IS NOT NULL AND pf.disabled_at IS NULL)::int AS production_total,
      COUNT(*) FILTER (
        WHERE pf.id IS NOT NULL AND pf.disabled_at IS NULL
          AND pf.data_status = 'ready'
          AND pf.srs_state IN ('new', 'review')
          AND pf.srs_due IS NOT NULL
          AND pf.srs_due <= NOW()
          AND pf.leech_parked_at IS NULL
      )::int AS production_review_due_count,
      COUNT(*) FILTER (
        WHERE pf.id IS NOT NULL AND pf.disabled_at IS NULL
          AND pf.data_status = 'ready'
          AND pf.srs_state IN ('learning', 'relearning')
          AND pf.srs_due IS NOT NULL
          AND pf.srs_due <= NOW()
          AND pf.leech_parked_at IS NULL
      )::int AS production_learning_due_count,
      COUNT(*) FILTER (
        WHERE pf.id IS NOT NULL AND pf.disabled_at IS NULL
          AND pf.data_status = 'ready'
          AND pf.srs_state IS NULL
          AND pf.leech_parked_at IS NULL
          AND ${newTermNotDecayedSql()}
      )::int AS production_new_count,
      COUNT(*) FILTER (
        WHERE pf.id IS NOT NULL AND pf.disabled_at IS NULL
          AND pf.leech_parked_at IS NOT NULL
          AND pf.srs_state IS NOT NULL
      )::int AS production_parked_count,
      COUNT(*) FILTER (
        WHERE pf.id IS NOT NULL AND pf.disabled_at IS NULL
          AND pf.leech_parked_at IS NOT NULL
          AND pf.srs_state IS NULL
      )::int AS production_warmup_count
    FROM public.user_lookups ul
    LEFT JOIN public.study_facets rf
      ON rf.user_lookup_id = ul.id AND rf.skill = 'meaning_recognition' AND rf.target_form = ''
    LEFT JOIN public.study_facets pf
      ON pf.user_lookup_id = ul.id AND pf.skill = 'meaning_production' AND pf.target_form = ''
    WHERE ul.user_id = ${userId}
      AND ul.count > 0
      AND ul.deleted_at IS NULL
    GROUP BY ul.target_language
    ORDER BY ul.target_language ASC
  `
  // Unseen opt-in facets per language — a separate aggregate because facets
  // are 1:many with the term here (forms + pronunciation), and joining them
  // into the grouped query above would fan out every other count. The
  // predicate mirrors listReviewTerms' opt-in new bucket exactly: enabled,
  // ready, non-parked, unseen, and NOT the pool's daily-new-capped citation
  // facet. Citation pronunciation counts (it is opt-in); citation
  // meaning_recognition/meaning_production are the primaries, excluded.
  const optInResult = await sql`
    SELECT
      ul.target_language,
      COUNT(*) FILTER (WHERE f.skill IN ('meaning_recognition', 'pronunciation'))::int AS opt_in_new_count,
      COUNT(*) FILTER (WHERE f.skill = 'meaning_production')::int AS production_opt_in_new_count
    FROM public.study_facets f
    JOIN public.user_lookups ul ON ul.id = f.user_lookup_id
    WHERE ul.user_id = ${userId}
      AND ul.count > 0
      AND ul.deleted_at IS NULL
      AND f.disabled_at IS NULL
      AND f.data_status = 'ready'
      AND f.leech_parked_at IS NULL
      AND f.srs_state IS NULL
      AND NOT (f.target_form = '' AND f.skill IN ('meaning_recognition', 'meaning_production'))
      AND ${newTermNotDecayedSql()}
    GROUP BY ul.target_language
  `
  const optInByLanguage = new Map(optInResult.map((row) => [row.target_language as string, row]))
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
    upNextCount: row.up_next_count as number,
    learningCount: row.learning_count as number,
    reviewCount: row.review_count as number,
    unseenCount: row.unseen_count as number,
    optInNewCount: (optInByLanguage.get(row.target_language as string)?.opt_in_new_count as number) ?? 0,
    productionOptInNewCount:
      (optInByLanguage.get(row.target_language as string)?.production_opt_in_new_count as number) ?? 0,
    parkedCount: row.parked_count as number,
    warmupCount: row.warmup_count as number,
    productionTotal: row.production_total as number,
    productionReviewDueCount: row.production_review_due_count as number,
    productionLearningDueCount: row.production_learning_due_count as number,
    productionNewCount: row.production_new_count as number,
    productionParkedCount: row.production_parked_count as number,
    productionWarmupCount: row.production_warmup_count as number,
  }))
}

// The live review pool for a (language, pool), sliced by scope. Single source
// for both render modes and the reading generator's candidate set.
//
//   - `pool` selects the facet skill SET, not a single skill: the recognition
//     queue serves {meaning_recognition, pronunciation}, the production queue
//     serves {meaning_production}. Production-pool membership needs no extra
//     row filter: the enabled-facet filter below IS the membership test (an
//     enabled meaning_production facet == "in production study"; recognition
//     spans every kept term via its recognition facet).
//     Facets are filtered to enabled (disabled_at IS NULL — keeps demoted
//     production facets out) and ready (data_status='ready' — keeps pending_data
//     facets out); leech-parked facets leave BOTH render modes (the reading
//     generator feeds from this query and must never re-rate a parked facet).
//   - `scope` gates the buckets: 'review_due' = due only, 'learn_new' =
//     never-reviewed only, 'mixed' = due + capped citation-new.
//
// Due cards split into two independently-capped buckets (review-state
// {'new','review'} consume the daily review budget = maxReviewTerms; learning
// follow-ups {'learning','relearning'} are exempt under maxLearningTerms, a hard
// ceiling, so a spent budget can't strand a failed card's relearning step).
//
// New cards split too: the pool's citation card is the only
// daily-new-capped facet — capped by maxNewTerms, served in 'mixed' + 'learn_new'.
// Opt-in new facets (pronunciation/forms, Phase 4) bypass the daily-new cap
// (maxOptInNewTerms = a hard ceiling) and are served ONLY in 'learn_new', never
// 'mixed' — otherwise the primary Practice button would flood a session with
// every enabled-but-unseen facet (Trap 22). Enabling a facet is a deliberate
// "go learn it via learn-new" act.
//
// SIBLING SPACING (Trap 5/16): a term's facets ("siblings") must not be
// adjacent. Each selected facet is ranked within its term by priority
// (due-review > intraday-learning > unseen); the outer queue orders by that rank
// first, so every term's rank-1 facet precedes any rank-2 — best-effort (a term
// dominating the due set has no separators left for its high-rank siblings, which
// go adjacent at the tail; accepted, not a guarantee). In Phase 2 each term has
// exactly one citation facet, so sibling_rank is always 1 and the order collapses
// to today's due-time-then-new ordering (behavior-preserving); Phase-4 facets
// exercise the spacing.
const listReviewTerms = async (params: {
  userId: string
  targetLanguage: string
  pool: PracticePool
  scope: 'review_due' | 'learn_new' | 'mixed'
  maxReviewTerms: number
  maxLearningTerms: number
  maxNewTerms: number
  maxOptInNewTerms: number
  excludeUserLookupIds?: string[]
}): Promise<DbUserLookupWithFacet[]> => {
  const wantDue = params.scope === 'review_due' || params.scope === 'mixed'
  const wantNew = params.scope === 'learn_new' || params.scope === 'mixed'
  const reviewLimit = wantDue ? params.maxReviewTerms : 0
  const learningLimit = wantDue ? params.maxLearningTerms : 0
  const newLimit = wantNew ? params.maxNewTerms : 0
  // maxOptInNewTerms is already pool+scope-gated by resolveReviewCaps (0 unless
  // recognition learn_new), so apply it directly.
  const optInNewLimit = params.maxOptInNewTerms
  if (reviewLimit <= 0 && learningLimit <= 0 && newLimit <= 0 && optInNewLimit <= 0) return []

  // The skill set this queue serves, and its daily-new-capped primary citation
  // facet. 'pronunciation' has no rows until Phase 4, so listing it is inert now.
  const skills = skillsForPool(params.pool)
  const primarySkill = skillForPool(params.pool)
  const facetCols = sql`
    f.skill, f.target_form, f.srs_state, f.srs_due, f.srs_stability, f.srs_difficulty,
    f.srs_last_review, f.srs_reps, f.srs_lapses, f.srs_learning_steps, f.leech_parked_at,
    f.leech_rehab_correct_days, f.leech_rehab_last_correct_on, f.introduced_at, f.payload,
    (f.skill = 'meaning_production' AND f.target_form = ${CITATION_FORM} AND f.disabled_at IS NULL)
      AS is_production_enabled
  `
  const excludedIds = params.excludeUserLookupIds ?? []
  const excludeClause = excludedIds.length > 0 ? sql`AND NOT (ul.id = ANY(${excludedIds}::uuid[]))` : sql``
  // Shared eligibility: kept, live term; enabled, ready, non-parked facet in the
  // pool's skill set. Always-true conditions first so the optional AND clauses
  // append cleanly. Production-pool membership needs no extra clause: the facetJoin
  // is to the meaning_production facet and `f.disabled_at IS NULL` already keeps
  // demoted (disabled) production facets out — that IS the membership filter.
  const eligible = sql`
    ul.user_id = ${params.userId}
    AND ul.target_language = ${params.targetLanguage}
    AND ul.count > 0
    AND ul.deleted_at IS NULL
    AND f.disabled_at IS NULL
    AND f.data_status = 'ready'
    AND f.leech_parked_at IS NULL
    ${excludeClause}
  `
  const facetJoin = sql`JOIN public.study_facets f ON f.user_lookup_id = ul.id AND f.skill = ANY(${skills})`
  const primaryCitation = sql`(f.skill = ${primarySkill} AND f.target_form = ${CITATION_FORM})`

  // Four capped buckets unioned, then spaced. Priority: 1 due-review,
  // 2 due-learning, 3 new. A bucket with a 0 LIMIT contributes nothing.
  //
  // The new buckets select and serve by tier (see new-term-priority.ts), and
  // never-introduced terms outside the decay window fall off entirely. The
  // tier is selected as a column (due buckets emit a constant) because the
  // spaced CTE window and the final ORDER BY re-order after the bucket LIMITs
  // — tiering only the bucket ORDER BY would tier *selection* while still
  // *serving* FIFO.
  const rows = (await sql`
    WITH selected AS (
      (
        SELECT ul.*, ${facetCols}, 1 AS facet_priority, 0 AS new_tier
        FROM public.user_lookups ul
        ${facetJoin}
        WHERE ${eligible}
          AND f.srs_due IS NOT NULL AND f.srs_due <= NOW()
          AND f.srs_state IN ('new', 'review')
        ORDER BY f.srs_due ASC, ul.headword ASC, ul.sense ASC, f.target_form ASC
        LIMIT ${reviewLimit}
      )
      UNION ALL
      (
        SELECT ul.*, ${facetCols}, 2 AS facet_priority, 0 AS new_tier
        FROM public.user_lookups ul
        ${facetJoin}
        WHERE ${eligible}
          AND f.srs_due IS NOT NULL AND f.srs_due <= NOW()
          AND f.srs_state IN ('learning', 'relearning')
        ORDER BY f.srs_due ASC, ul.headword ASC, ul.sense ASC, f.target_form ASC
        LIMIT ${learningLimit}
      )
      UNION ALL
      (
        SELECT ul.*, ${facetCols}, 3 AS facet_priority, ${newTermTierSql()} AS new_tier
        FROM public.user_lookups ul
        ${facetJoin}
        WHERE ${eligible}
          AND f.srs_state IS NULL
          AND ${primaryCitation}
          AND ${newTermNotDecayedSql()}
        ORDER BY ${newTermOrderSql()}, f.target_form ASC
        LIMIT ${newLimit}
      )
      UNION ALL
      (
        SELECT ul.*, ${facetCols}, 3 AS facet_priority, ${newTermTierSql()} AS new_tier
        FROM public.user_lookups ul
        ${facetJoin}
        WHERE ${eligible}
          AND f.srs_state IS NULL
          AND NOT ${primaryCitation}
          AND ${newTermNotDecayedSql()}
        ORDER BY ${newTermOrderSql()}, f.target_form ASC
        LIMIT ${optInNewLimit}
      )
    ),
    spaced AS (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY id
        ORDER BY facet_priority ASC, srs_due ASC NULLS LAST, new_tier ASC, zipf_estimate DESC NULLS LAST,
          created_at ASC, headword ASC, sense ASC, target_form ASC
      ) AS sibling_rank
      FROM selected
    )
    SELECT * FROM spaced
    ORDER BY sibling_rank ASC, srs_due ASC NULLS LAST, new_tier ASC, zipf_estimate DESC NULLS LAST,
      created_at ASC, headword ASC, sense ASC, target_form ASC
  `) as DbUserLookupWithFacet[]
  return rows
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

// Representative-card deep-link pointer for one chunk, resolved through the
// first_card_id back-pointer (same representative the vocabulary list and the
// practice-text annotations use). Both fields null when the back-pointer is
// null or stale. Powers the practice "Edit term" action's focus-view link
// (`/sessions/$sessionId/review/$cardId`).
const getFirstCardPointerForChunk = async (params: {
  userLookupId: string
  userId: string
}): Promise<{ cardId: string | null; sessionId: string | null }> => {
  const rows = (await sql`
    SELECT c.id AS card_id, c.study_session_id
    FROM public.user_lookups ul
    LEFT JOIN public.cards c ON c.id = ul.first_card_id
    WHERE ul.id = ${params.userLookupId}
      AND ul.user_id = ${params.userId}
  `) as Array<{ card_id: string | null; study_session_id: string | null }>
  return { cardId: rows[0]?.card_id ?? null, sessionId: rows[0]?.study_session_id ?? null }
}

// Thrown by setFacetEnabled when disabling would leave a kept term with zero
// enabled facets. The router maps it to a 409 CONFLICT — it's a client-correctable
// invariant (delete the term instead), not a 500.
export class LastFacetFloorError extends Error {
  constructor() {
    super('Cannot disable the last enabled facet of a kept term')
    this.name = 'LastFacetFloorError'
  }
}

// Enable or disable a single study facet (skill x target_form) on a term. The
// facet's `disabled_at` IS the membership flag — there is no more
// user_lookups.learning_mode column. Enabling the citation meaning_production
// facet is what "promote to production study" used to be; disabling it is
// "demote".
//   - enabled:true: ensure the facet exists (created with NULL srs state if
//     absent) then CLEAR its disabled_at — re-enabling a previously-disabled,
//     history-bearing facet so it resumes its schedule. `payload` (when
//     provided) is merged into the facet's JSONB payload.
//   - enabled:false: SET disabled_at (its SRS history is preserved — disable !=
//     delete).
// A REAL flip (membership actually changed, guarded by `disabled_at IS DISTINCT
// FROM` the target) additionally resets the facet's leech-rehab state:
// membership changed, so any in-flight rehab progress is stale. An idempotent
// re-enable/re-disable (no change) never wipes progress. Ownership: the term
// must belong to the user and not be deleted, else returns null. Returns the
// post-update term row (the router re-derives learning_mode from facet state).
const setFacetEnabled = async (params: {
  userLookupId: string
  userId: string
  skill: FacetSkill
  targetForm: string
  enabled: boolean
  payload?: Record<string, unknown>
}): Promise<DbUserLookup | null> => {
  return await beginTx(async (tx) => {
    // Ownership / existence guard. The facet UPDATEs below are not user-scoped
    // (study_facets has no user_id filter here), so verify the term first.
    const owned = (await tx`
      SELECT id, count
      FROM public.user_lookups
      WHERE id = ${params.userLookupId}
        AND user_id = ${params.userId}
        AND deleted_at IS NULL
    `) as Array<{ id: string; count: number }>
    if (!owned[0]) return null

    const payloadJson = params.payload ? sql.json(params.payload as unknown as postgres.JSONValue) : null

    // Floor guard: a KEPT term (count > 0) must keep ≥1 enabled facet somewhere —
    // a term studied for nothing is an orphan. Reject a disable that would zero
    // out its last enabled facet. Pre-keep terms keep their freedom to drop to
    // zero (a needs-data card with no pre-configured skills). Re-disabling an
    // already-disabled facet is a no-op and never trips the guard.
    if (!params.enabled && owned[0].count > 0) {
      const otherEnabled = (await tx`
        SELECT COUNT(*)::int AS n
        FROM public.study_facets
        WHERE user_lookup_id = ${params.userLookupId}
          AND disabled_at IS NULL
          AND NOT (skill = ${params.skill} AND target_form = ${params.targetForm})
      `) as Array<{ n: number }>
      const thisEnabled = (await tx`
        SELECT 1
        FROM public.study_facets
        WHERE user_lookup_id = ${params.userLookupId}
          AND skill = ${params.skill}
          AND target_form = ${params.targetForm}
          AND disabled_at IS NULL
      `) as Array<{ '?column?': number }>
      if (thisEnabled[0] && (otherEnabled[0]?.n ?? 0) === 0) {
        throw new LastFacetFloorError()
      }
    }

    if (params.enabled) {
      // A NEW form facet (non-empty target_form) added WITHOUT render data is
      // born `pending_data`: it has no render back until Opus generation or
      // manual entry fills its payload, so it's enabled-but-not-queued (the queue
      // filters data_status='ready'). Adding a form from a candidate sends only
      // {form} -> pending_data; enabling a SECOND skill on a form that's already
      // filled sends the known payload -> born ready (no regeneration). "Has
      // render data" is skill-aware: meaning skills key on the translation key,
      // pronunciation on a non-empty grammar.ipa bag (its back IS the IPA — a
      // copied meaning payload without form IPA must not flip it ready).
      // Citation facets (target_form='') are always ready. ON CONFLICT inside
      // ensureFacet means an EXISTING facet keeps its data_status — a re-enabled
      // form facet with generated data stays ready.
      const isFormFacet = params.targetForm !== ''
      const payloadIpa = (params.payload?.grammar as Record<string, unknown> | undefined)?.ipa
      const hasIpaData =
        !!payloadIpa &&
        typeof payloadIpa === 'object' &&
        Object.values(payloadIpa).some((v) => typeof v === 'string' && v.trim().length > 0)
      const hasRenderData =
        params.skill === 'pronunciation' ? hasIpaData : !!params.payload && 'translation' in params.payload
      await ensureFacet(
        {
          userLookupId: params.userLookupId,
          skill: params.skill,
          targetForm: params.targetForm,
          dataStatus: isFormFacet && !hasRenderData ? 'pending_data' : 'ready',
          source: isFormFacet ? 'manual' : 'system',
          payload: params.payload,
        },
        tx
      )
      // enableFacet clears disabled_at, merges the payload, and resets
      // leech-rehab state only on a REAL re-enable (see its doc comment).
      await enableFacet(
        {
          userLookupId: params.userLookupId,
          skill: params.skill,
          targetForm: params.targetForm,
          payload: params.payload,
        },
        tx
      )
    } else {
      // A real disable flips a currently-NULL disabled_at to NOW(); only then is
      // the leech-rehab progress stale. Re-disabling an already-disabled facet
      // leaves rehab columns untouched.
      await tx`
        UPDATE public.study_facets
        SET payload = ${payloadJson ? sql`payload || ${payloadJson}::jsonb` : sql`payload`},
            leech_parked_at = CASE WHEN disabled_at IS NULL THEN NULL ELSE leech_parked_at END,
            leech_rehab_correct_days = CASE WHEN disabled_at IS NULL THEN 0 ELSE leech_rehab_correct_days END,
            leech_rehab_last_correct_on = CASE WHEN disabled_at IS NULL THEN NULL ELSE leech_rehab_last_correct_on END,
            disabled_at = CASE WHEN disabled_at IS NULL THEN NOW() ELSE disabled_at END,
            updated_at = NOW()
        WHERE user_lookup_id = ${params.userLookupId}
          AND skill = ${params.skill}
          AND target_form = ${params.targetForm}
      `
    }
    return findByIdForUser(params.userLookupId, params.userId)
  })
}

// Parked facets for the Strengthen session's gated track, oldest-parked first
// so the longest-stranded facets get rehab attention first. Joined with the
// term so callers still get the content fields; the leech/SRS state is the
// facet's.
const listParkedTerms = async (params: {
  userId: string
  targetLanguage: string
  pool: PracticePool
  // Warm-up scopes parked-term serving to one session's onboarding terms; when
  // omitted, every parked term for the (user, language, pool) is returned (the
  // general Strengthen surface).
  restrictToUserLookupIds?: string[]
  // Split the parked population by how it got parked: 'onboarding' = an
  // exercise-first warm-up term (parked + never-reviewed, srs_state NULL),
  // 'leech' = a genuine lapsed term (parked + srs_state NOT NULL). Omitted
  // returns both. The two share one DB shape; srs_state is the only thing that
  // tells them apart, so Strengthen (leeches) and Warm-up (onboarding) read
  // disjoint sets from the same column.
  parkedOrigin?: 'onboarding' | 'leech'
  // Drop terms whose rehab day-credit was already earned today (server
  // CURRENT_DATE, matching advanceRehabDayFacet's guard). The composed daily
  // queue sets this: answering an already-credited gate consumes a banked
  // exercise while advancing nothing, so serving one is pure waste. The
  // explicit Strengthen/Warm-up surfaces keep serving them (extra practice on
  // request).
  excludeCreditedToday?: boolean
}): Promise<DbUserLookupWithFacet[]> => {
  const skill = skillForPool(params.pool)
  const restrictClause =
    params.restrictToUserLookupIds != null ? sql`AND ul.id = ANY(${params.restrictToUserLookupIds}::uuid[])` : sql``
  const originClause =
    params.parkedOrigin === 'onboarding'
      ? sql`AND f.srs_state IS NULL`
      : params.parkedOrigin === 'leech'
        ? sql`AND f.srs_state IS NOT NULL`
        : sql``
  const creditedClause = params.excludeCreditedToday
    ? sql`AND f.leech_rehab_last_correct_on IS DISTINCT FROM CURRENT_DATE`
    : sql``
  // No membership clause: the join is to the pool's citation facet
  // (meaning_production for the production pool) and `f.disabled_at IS NULL`
  // already enforces membership — a demoted (disabled) production facet is
  // excluded.
  return (await sql`
    SELECT
      ul.*,
      f.skill, f.target_form, f.srs_state, f.srs_due, f.srs_stability, f.srs_difficulty,
      f.srs_last_review, f.srs_reps, f.srs_lapses, f.srs_learning_steps, f.leech_parked_at,
      f.leech_rehab_correct_days, f.leech_rehab_last_correct_on, f.introduced_at, f.payload,
      (f.skill = 'meaning_production' AND f.target_form = ${CITATION_FORM} AND f.disabled_at IS NULL)
        AS is_production_enabled
    FROM public.user_lookups ul
    JOIN public.study_facets f
      ON f.user_lookup_id = ul.id AND f.skill = ${skill} AND f.target_form = ${CITATION_FORM}
    WHERE ul.user_id = ${params.userId}
      AND ul.target_language = ${params.targetLanguage}
      AND ul.count > 0
      AND ul.deleted_at IS NULL
      AND f.disabled_at IS NULL
      AND f.leech_parked_at IS NOT NULL
      ${restrictClause}
      ${originClause}
      ${creditedClause}
    ORDER BY f.leech_parked_at ASC, ul.headword ASC, ul.sense ASC
  `) as DbUserLookupWithFacet[]
}

// Terms whose citation facet for the pool's skill could ENTER warm-up
// scaffolding right now: kept, live term; facet exists, enabled, never
// reviewed, not parked. The by-(user, language) counterpart of warmup.ts's
// session-scoped eligibleToEnter — feeds the composed queue's auto-warm-up
// discovery. Tier-ordered (see new-term-priority.ts), so the daily-new cap
// admits terms in the same order the flashcard new bucket serves them; decayed
// never-encountered-lately terms are off the shelf here too.
const listEligibleNewCitationFacets = async (params: {
  userId: string
  targetLanguage: string
  pool: PracticePool
}): Promise<string[]> => {
  const skill = skillForPool(params.pool)
  const rows = (await sql`
    SELECT ul.id
    FROM public.user_lookups ul
    JOIN public.study_facets f
      ON f.user_lookup_id = ul.id AND f.skill = ${skill} AND f.target_form = ${CITATION_FORM}
    WHERE ul.user_id = ${params.userId}
      AND ul.target_language = ${params.targetLanguage}
      AND ul.count > 0
      AND ul.deleted_at IS NULL
      AND f.disabled_at IS NULL
      AND f.srs_state IS NULL
      AND f.leech_parked_at IS NULL
      AND ${newTermNotDecayedSql()}
    ORDER BY ${newTermOrderSql()}
  `) as Array<{ id: string }>
  return rows.map((row) => row.id)
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
      ul.headword,
      ul.sense,
      ul.translation,
      ul.definition,
      ul.target_example,
      ul.native_example,
      rf.srs_state,
      rf.srs_due,
      rf.srs_reps
    FROM public.user_lookups ul
    LEFT JOIN public.study_facets rf
      ON rf.user_lookup_id = ul.id AND rf.skill = 'meaning_recognition' AND rf.target_form = ''
    WHERE ul.user_id = ${params.userId}
      AND ul.target_language = ${params.targetLanguage}
      AND ul.count > 0
      AND ul.deleted_at IS NULL
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
  isProductionEnabled: boolean
  isLeechParked: boolean
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
      (pf.disabled_at IS NULL AND pf.id IS NOT NULL) AS is_production_enabled,
      (rf.leech_parked_at IS NOT NULL OR pf.leech_parked_at IS NOT NULL) AS is_leech_parked,
      c.surface_form,
      ts.text AS segment_text
    FROM public.user_lookups ul
    LEFT JOIN public.study_facets rf
      ON rf.user_lookup_id = ul.id AND rf.skill = 'meaning_recognition' AND rf.target_form = ''
    LEFT JOIN public.study_facets pf
      ON pf.user_lookup_id = ul.id AND pf.skill = 'meaning_production' AND pf.target_form = ''
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
    isProductionEnabled: row.is_production_enabled as boolean,
    isLeechParked: row.is_leech_parked as boolean,
    surfaceForm: (row.surface_form as string | null) ?? '',
    segmentText: (row.segment_text as string | null) ?? '',
  }))
}

// =========================================================================
// Vocabulary management view (the /vocabulary tab)
// =========================================================================

export type ChunksSort = 'recent' | 'due'

// SRS stages of the citation recognition facet. The six stages are disjoint
// and partition a language's kept terms exactly — the practice landing's
// segmented bar and the vocabulary Stage filter both rely on that, and
// vocabStageClauseSql is the single predicate source for both.
export type VocabStage = 'up_next' | 'warming_up' | 'learning' | 'review' | 'strengthen' | 'unseen'
export type VocabStatus = 'due' | VocabStage

// Cursor wire format. Encoded base64 by the contract layer; the repo deals in
// the structured form.
//
// `recent` orders by (created_at DESC, id ASC) — straightforward keyset.
// `due` is two-phase to handle NULLS LAST: phase 'scheduled' walks rows with
// srs_due NOT NULL ordered (srs_due ASC, id ASC); when that phase exhausts,
// we flip to phase 'unscheduled' which walks the srs_due IS NULL tail
// ordered by id ASC.
// `queue` pages the up_next stage in introduction order (newTermOrderSql);
// every ordering key rides the cursor so one row comparison resumes the scan.
// zipfKey carries COALESCE(zipf_estimate, -1) (zipf is never negative, so -1
// reproduces DESC NULLS LAST when the comparison negates both sides).
export type ChunksCursor =
  | { sort: 'recent'; createdAt: string; id: string }
  | { sort: 'due'; phase: 'scheduled'; srsDue: string; id: string }
  | { sort: 'due'; phase: 'unscheduled'; id: string }
  | { sort: 'queue'; tier: number; zipfKey: number; createdAt: string; headword: string; sense: string; id: string }

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
  groundingPatch: Record<string, unknown> | null
  grammarUserEditedAt: string | null
  count: number
  srsState: SrsState | null
  srsDue: string | null
  srsReps: number
  isProductionEnabled: boolean
  productionSrsState: SrsState | null
  productionSrsDue: string | null
  productionSrsReps: number
  createdAt: string
  firstCardId: string | null
  firstCardSegmentId: string | null
  studySessionId: string | null
  sourceAvailable: boolean
}

// Projection and FROM/joins kept separate so a branch can append extra
// SELECT columns (the up_next queue branch selects its cursor keys) while
// every consumer shares one column list and join set.
const CHUNK_ROW_COLUMNS_SQL = sql`
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
    ul.grounding_patch,
    ul.grammar_user_edited_at,
    ul.count,
    rf.srs_state AS srs_state,
    rf.srs_due AS srs_due,
    rf.srs_reps AS srs_reps,
    (pf.disabled_at IS NULL AND pf.id IS NOT NULL) AS is_production_enabled,
    pf.srs_state AS production_srs_state,
    pf.srs_due AS production_srs_due,
    pf.srs_reps AS production_srs_reps,
    ul.created_at,
    ul.first_card_id,
    c.segment_id AS first_card_segment_id,
    c.study_session_id,
    (s.id IS NOT NULL AND cs.type != 'adhoc') AS source_available
`

const CHUNK_ROW_FROM_SQL = sql`
  FROM public.user_lookups ul
  LEFT JOIN public.study_facets rf
    ON rf.user_lookup_id = ul.id AND rf.skill = 'meaning_recognition' AND rf.target_form = ''
  LEFT JOIN public.study_facets pf
    ON pf.user_lookup_id = ul.id AND pf.skill = 'meaning_production' AND pf.target_form = ''
  LEFT JOIN public.cards c ON c.id = ul.first_card_id
  LEFT JOIN public.study_sessions s ON s.id = c.study_session_id AND s.deleted_at IS NULL
  LEFT JOIN public.content_sources cs ON cs.id = s.content_source_id
`

const SELECT_CHUNK_ROW_SQL = sql`
  SELECT
    ${CHUNK_ROW_COLUMNS_SQL}
  ${CHUNK_ROW_FROM_SQL}
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
  groundingPatch: (row.grounding_patch as Record<string, unknown> | null) ?? null,
  grammarUserEditedAt: (row.grammar_user_edited_at as string | null) ?? null,
  count: (row.count as number) ?? 0,
  srsState: (row.srs_state as SrsState | null) ?? null,
  srsDue: (row.srs_due as string | null) ?? null,
  srsReps: (row.srs_reps as number) ?? 0,
  isProductionEnabled: (row.is_production_enabled as boolean | null) ?? false,
  productionSrsState: (row.production_srs_state as SrsState | null) ?? null,
  productionSrsDue: (row.production_srs_due as string | null) ?? null,
  productionSrsReps: (row.production_srs_reps as number) ?? 0,
  createdAt: row.created_at as string,
  firstCardId: (row.first_card_id as string | null) ?? null,
  firstCardSegmentId: (row.first_card_segment_id as string | null) ?? null,
  studySessionId: (row.study_session_id as string | null) ?? null,
  sourceAvailable: row.source_available === true,
})

// Single chunk row (facet-joined, so isProductionEnabled is the DERIVED
// production state) for one term, scoped to its owner. Used by setFacetEnabled's
// response path where the caller needs the post-update production state in the
// ChunkSchema shape.
const getChunkRowForUser = async (userLookupId: string, userId: string): Promise<ChunkRow | null> => {
  const rows = (await sql`
    ${SELECT_CHUNK_ROW_SQL}
    WHERE ul.id = ${userLookupId}
      AND ul.user_id = ${userId}
      AND ul.deleted_at IS NULL
  `) as Array<Record<string, unknown>>
  return rows[0] ? mapChunkRow(rows[0]) : null
}

// Hard-delete one facet (skill x target_form) of a term. Unlike setFacetEnabled
// (disable != delete: keeps SRS history for re-enable), this drops the row and
// its schedule entirely. Used for the IPA-vanished case (Trap 12): a
// pronunciation facet has nothing to rehab once its IPA precondition disappears,
// so it is deleted rather than disabled. Keyed on user_lookup_id (FK-cascade
// scope); ownership is enforced by the caller.
const deleteFacet = async (
  params: { userLookupId: string; skill: FacetSkill; targetForm: string },
  executor: postgres.Sql = sql
): Promise<void> => {
  await executor`
    DELETE FROM public.study_facets
    WHERE user_lookup_id = ${params.userLookupId}
      AND skill = ${params.skill}
      AND target_form = ${params.targetForm}
  `
}

// All study facets of one term, for the Study-targets control (term view). The
// chunk DTO only derives isProductionEnabled from the citation production facet; this
// surfaces every facet's identity + membership (enabled = disabled_at IS NULL) +
// data readiness so the term view can render the pronunciation row and form
// chips. Ownership is enforced by the caller (findByIdForUser) — this is keyed
// on user_lookup_id alone, matching the FK-cascade scope of study_facets.
// Resolve the encountered occurrence backing each study target: the
// most-recent kept card per normalized surface form, joined to its session /
// text track and the center segment's text, and a citation occurrence (prefer
// an exact-lemma card, else the most-recent kept card overall — the lemma was
// met there in some form). Adhoc sessions / cards without a text track or
// segment are dropped by the inner JOINs, so they yield no source. The SQL key
// normalizer (strip U+0301 -> NFC -> trim -> lower) is the byte-for-byte twin of
// normalizeTargetForm() in @flicktionary/core (Trap 21); chr(769) is the
// combining acute, written this way to dodge the JS `\0` template escape.
const resolveFacetSources = async (
  userLookupId: string
): Promise<{ citation: FacetSource | null; byForm: Map<string, FacetSource> }> => {
  const rows = (await sql`
    SELECT
      lower(trim(normalize(regexp_replace(c.surface_form, chr(769), '', 'g'), NFC))) AS norm_form,
      lower(trim(normalize(regexp_replace(ul.headword, chr(769), '', 'g'), NFC))) AS norm_headword,
      c.study_session_id,
      c.segment_id,
      s.text_track_id,
      ts.text AS sentence
    FROM public.cards c
    JOIN public.user_lookups ul ON ul.id = c.user_lookup_id
    JOIN public.study_sessions s ON s.id = c.study_session_id AND s.deleted_at IS NULL
    JOIN public.content_sources cs ON cs.id = s.content_source_id AND cs.type != 'adhoc'
    JOIN public.text_segments ts ON ts.id = c.segment_id
    WHERE c.user_lookup_id = ${userLookupId}
      AND c.status = 'kept'
    ORDER BY c.created_at DESC, c.id DESC
  `) as Array<{
    norm_form: string
    norm_headword: string
    study_session_id: string
    segment_id: string
    text_track_id: string
    sentence: string
  }>

  const byForm = new Map<string, FacetSource>()
  let citation: FacetSource | null = null
  let citationFallback: FacetSource | null = null
  // Rows are most-recent-first, so the first time we see a key it's the winner.
  for (const r of rows) {
    const source: FacetSource = {
      sessionId: r.study_session_id,
      segmentId: r.segment_id,
      textTrackId: r.text_track_id,
      sentence: r.sentence,
    }
    if (r.norm_form !== '' && !byForm.has(r.norm_form)) byForm.set(r.norm_form, source)
    if (citationFallback === null) citationFallback = source
    if (citation === null && r.norm_form === r.norm_headword) citation = source
  }
  return { citation: citation ?? citationFallback, byForm }
}

const listFacetsForChunk = async (userLookupId: string): Promise<ChunkFacetSummary[]> => {
  const [rows, sources] = await Promise.all([
    sql`
      SELECT skill, target_form, srs_state, data_status, payload, generated_payload, disabled_at
      FROM public.study_facets
      WHERE user_lookup_id = ${userLookupId}
      ORDER BY skill ASC, target_form ASC
    ` as Promise<
      Array<{
        skill: FacetSkill
        target_form: string
        srs_state: SrsState | null
        data_status: 'ready' | 'pending_data'
        payload: Record<string, unknown>
        generated_payload: Record<string, unknown> | null
        disabled_at: string | null
      }>
    >,
    resolveFacetSources(userLookupId),
  ])
  return rows.map((r) => ({
    skill: r.skill,
    targetForm: r.target_form,
    enabled: r.disabled_at === null,
    dataStatus: r.data_status,
    srsState: r.srs_state,
    payload: r.payload ?? {},
    generatedPayload: r.generated_payload ?? null,
    // Citation/pronunciation (target_form='') get the lemma occurrence; form
    // facets get their own inflection's occurrence (null if never kept w/ source).
    source: r.target_form === '' ? sources.citation : (sources.byForm.get(r.target_form) ?? null),
  }))
}

// Fill a form facet's render data and flip it from 'pending_data' to 'ready' so
// the queue picks it up. Used by both the Opus generation pass and the manual
// "enter it yourself" path — both terminate a pending_data facet's wait by
// supplying {form, translation}. payload merges via || (a partial patch keeps
// the rest), and data_status is set unconditionally to 'ready': you only call
// this when you have the data. Owner-scoped via the term join.
const setFacetPayload = async (params: {
  userLookupId: string
  userId: string
  skill: FacetSkill
  targetForm: string
  payload: Record<string, unknown>
  // Provenance snapshot, passed ONLY by the server-side generate pass (the
  // public contract never carries it, so a client can't forge a "generated"
  // claim). Omitted on manual edits — the existing snapshot is preserved so
  // per-field comparison keeps working against what generation wrote.
  generatedPayload?: Record<string, unknown>
}): Promise<void> => {
  const payloadJson = sql.json(params.payload as unknown as postgres.JSONValue)
  const generatedJson = params.generatedPayload
    ? sql.json(params.generatedPayload as unknown as postgres.JSONValue)
    : null
  await sql`
    UPDATE public.study_facets f
    SET payload = f.payload || ${payloadJson}::jsonb,
        generated_payload = COALESCE(${generatedJson}::jsonb, f.generated_payload),
        data_status = 'ready',
        updated_at = NOW()
    FROM public.user_lookups ul
    WHERE f.user_lookup_id = ul.id
      AND f.user_lookup_id = ${params.userLookupId}
      AND f.skill = ${params.skill}
      AND f.target_form = ${params.targetForm}
      AND ul.user_id = ${params.userId}
      AND ul.deleted_at IS NULL
  `
}

// Encountered surface forms for the "+ Add a form" picker (Worked example 3):
// distinct kept-card surface forms for this term, minus the lemma itself and any
// form already turned into a meaning_recognition facet. A card row stores only
// the string, so that's all we return — translation/morphology are generated by
// Opus on enable. The SQL key normalizer (strip U+0301 -> NFC -> trim -> lower)
// is the byte-for-byte twin of normalizeTargetForm() in @flicktionary/core
// (Trap 21); chr(769) is the combining acute, written this way to avoid the JS
// template-literal `\0` escape trap. DISTINCT ON the normalized key collapses
// case/stress variants (`Houses`/`houses`) while returning a display form.
const listCandidateFormsForChunk = async (userLookupId: string): Promise<string[]> => {
  const rows = (await sql`
    WITH norm AS (
      SELECT
        c.surface_form,
        lower(trim(normalize(regexp_replace(c.surface_form, chr(769), '', 'g'), NFC))) AS norm_form,
        lower(trim(normalize(regexp_replace(ul.headword, chr(769), '', 'g'), NFC))) AS norm_headword
      FROM public.cards c
      JOIN public.user_lookups ul ON ul.id = c.user_lookup_id
      WHERE c.user_lookup_id = ${userLookupId}
        AND c.status = 'kept'
    )
    SELECT DISTINCT ON (norm_form) surface_form
    FROM norm
    WHERE btrim(surface_form) <> ''
      AND norm_form <> ''
      AND norm_form <> norm_headword
      AND norm_form NOT IN (
        SELECT target_form
        FROM public.study_facets
        WHERE user_lookup_id = ${userLookupId}
          AND skill = 'meaning_recognition'
          AND target_form <> ''
      )
    ORDER BY norm_form, surface_form
  `) as Array<{ surface_form: string }>
  return rows.map((r) => r.surface_form)
}

// Case-insensitive substring filter across headword/translation/definition.
// `%` and `_` in user input retain LIKE-pattern semantics — acceptable for
// the v1 search bar; if it becomes a footgun we can escape later.
const buildSearchClause = (q: string | null) => {
  if (!q || q.length === 0) return sql``
  const pattern = `%${q}%`
  return sql`AND (ul.headword ILIKE ${pattern} OR ul.translation ILIKE ${pattern} OR ul.definition ILIKE ${pattern})`
}

// Vocabulary "Skills" filter tokens → the study_facets.skill they match. The
// filter matches an enabled facet of the mapped skill on ANY target_form
// (citation or a specific inflection), so a term studied for production only on
// a form still matches "production".
const FILTER_SKILL_TO_FACET: Record<string, FacetSkill> = {
  recognition: 'meaning_recognition',
  production: 'meaning_production',
  pronunciation: 'pronunciation',
}

// Parse the CSV `skills` filter into the distinct facet skills it maps to,
// ignoring unknown tokens (the wire is a free CSV string — see the contract).
const parseSkillFilter = (csv: string | null | undefined): FacetSkill[] => {
  if (!csv) return []
  const mapped = csv
    .split(',')
    .map((token) => FILTER_SKILL_TO_FACET[token.trim()])
    .filter((skill): skill is FacetSkill => skill !== undefined)
  return [...new Set(mapped)]
}

// One boolean fragment per stage, on the citation recognition facet (`rf`
// alias, LEFT-joined; `ul` for the decay signals). The single predicate source
// for the vocabulary Stage filter AND the practice landing's stage counts —
// the two surfaces agree by construction. The stages are disjoint and their
// union is TRUE for every kept term (partition of totalKept):
// parked rows split into warming_up/strengthen by srs_state, unparked rows
// split into up_next/learning/review/unseen by srs_state + decay, and rows
// with a missing or disabled facet land in unseen.
export const vocabStageClauseSql = (stage: VocabStage) => {
  switch (stage) {
    case 'up_next':
      // Mirrors listEligibleNewCitationFacets exactly — deliberately NO
      // data_status check: the composed queue parks these terms regardless of
      // card-data readiness, so the stage must count them the same way.
      return sql`(rf.id IS NOT NULL AND rf.disabled_at IS NULL AND rf.srs_state IS NULL
        AND rf.leech_parked_at IS NULL AND ${newTermNotDecayedSql()})`
    case 'warming_up':
      return sql`(rf.id IS NOT NULL AND rf.disabled_at IS NULL
        AND rf.leech_parked_at IS NOT NULL AND rf.srs_state IS NULL)`
    case 'learning':
      return sql`(rf.id IS NOT NULL AND rf.disabled_at IS NULL AND rf.leech_parked_at IS NULL
        AND rf.srs_state IN ('new', 'learning', 'relearning'))`
    case 'review':
      return sql`(rf.id IS NOT NULL AND rf.disabled_at IS NULL AND rf.leech_parked_at IS NULL
        AND rf.srs_state = 'review')`
    case 'strengthen':
      return sql`(rf.id IS NOT NULL AND rf.disabled_at IS NULL
        AND rf.leech_parked_at IS NOT NULL AND rf.srs_state IS NOT NULL)`
    case 'unseen':
      // Explicit disjuncts, NOT a negation of the other stages: under SQL
      // three-valued logic a NOT over the rf columns is NULL (not TRUE) for
      // missing-facet rows, which would silently drop them from the bucket.
      // (ul.last_encountered_at is NOT NULL by schema, so negating the decay
      // predicate is safe.)
      return sql`(rf.id IS NULL OR rf.disabled_at IS NOT NULL
        OR (rf.srs_state IS NULL AND rf.leech_parked_at IS NULL AND NOT (${newTermNotDecayedSql()})))`
  }
}

const listChunksForLanguage = async (params: {
  userId: string
  targetLanguage: string
  sort: ChunksSort
  cursor: ChunksCursor | null
  limit: number
  q: string | null
  skills?: string | null
  status?: VocabStatus | null
  hasMultipleForms?: boolean | null
}): Promise<{ rows: ChunkRow[]; nextCursor: ChunksCursor | null }> => {
  const limit = Math.max(1, Math.min(params.limit, 200))
  const fetchLimit = limit + 1
  const searchClause = buildSearchClause(params.q)

  // Study-state filter on the citation recognition facet (rf, joined in
  // SELECT_CHUNK_ROW_SQL). 'due' = a review is waiting now; the six stages
  // come from the shared vocabStageClauseSql partition.
  const statusClause =
    params.status === 'due'
      ? sql`AND rf.srs_state IS NOT NULL AND rf.srs_due IS NOT NULL AND rf.srs_due <= now()`
      : params.status
        ? sql`AND ${vocabStageClauseSql(params.status)}`
        : sql``

  // Skill-membership filter: keep terms with an enabled facet of any selected
  // skill, on the citation OR any form. EXISTS (not a join) so a term matching
  // on multiple facets isn't duplicated.
  const facetSkills = parseSkillFilter(params.skills)
  const skillsClause =
    facetSkills.length === 0
      ? sql``
      : sql`AND EXISTS (
          SELECT 1 FROM public.study_facets sf
          WHERE sf.user_lookup_id = ul.id
            AND sf.disabled_at IS NULL
            AND sf.skill = ANY(${facetSkills})
        )`

  // "Has multiple forms": studied in at least one inflected form (an enabled
  // facet keyed to a non-empty target_form, beyond the citation lemma).
  const formsClause = params.hasMultipleForms
    ? sql`AND EXISTS (
        SELECT 1 FROM public.study_facets sf
        WHERE sf.user_lookup_id = ul.id
          AND sf.disabled_at IS NULL
          AND sf.target_form <> ''
      )`
    : sql``

  // Composed once, injected verbatim into every sort/phase branch below.
  const filterClause = sql`${statusClause} ${skillsClause} ${formsClause}`

  // status='up_next' overrides `sort`: the stage IS the introduction queue, so
  // it pages in newTermOrderSql order — the list a user inspects here is
  // exactly the order the composed queue will introduce these terms. The
  // cursor keys (tier/zipf) are selected alongside the row columns; the row
  // comparison negates zipf on both sides so every key ascends (zipf is never
  // negative, so COALESCE(zipf, -1) reproduces DESC NULLS LAST).
  if (params.status === 'up_next') {
    const cursor = params.cursor && params.cursor.sort === 'queue' ? params.cursor : null
    const rows = (await sql`
      SELECT
        ${CHUNK_ROW_COLUMNS_SQL},
        ${newTermTierSql()} AS queue_tier,
        COALESCE(ul.zipf_estimate, -1) AS queue_zipf_key
      ${CHUNK_ROW_FROM_SQL}
      WHERE ul.user_id = ${params.userId}
        AND ul.target_language = ${params.targetLanguage}
        AND ul.deleted_at IS NULL
        AND ul.count > 0
        ${searchClause}
        ${filterClause}
        AND ${
          cursor
            ? sql`(${newTermTierSql()}, -COALESCE(ul.zipf_estimate, -1), ul.created_at, ul.headword, ul.sense, ul.id)
                > (${cursor.tier}, ${-cursor.zipfKey}, ${cursor.createdAt}::timestamptz, ${cursor.headword}, ${cursor.sense}, ${cursor.id}::uuid)`
            : sql`TRUE`
        }
      ORDER BY ${newTermOrderSql()}
      LIMIT ${fetchLimit}
    `) as Array<Record<string, unknown>>

    const hasMore = rows.length > limit
    const sliced = hasMore ? rows.slice(0, limit) : rows
    const last = sliced[sliced.length - 1]
    const nextCursor: ChunksCursor | null =
      hasMore && last
        ? {
            sort: 'queue',
            tier: last.queue_tier as number,
            zipfKey: Number(last.queue_zipf_key),
            createdAt: last.created_at as string,
            headword: last.headword as string,
            sense: (last.sense as string) ?? '',
            id: last.id as string,
          }
        : null
    return { rows: sliced.map(mapChunkRow), nextCursor }
  }

  if (params.sort === 'recent') {
    const cursor = params.cursor && params.cursor.sort === 'recent' ? params.cursor : null
    const rows = (await sql`
      ${SELECT_CHUNK_ROW_SQL}
      WHERE ul.user_id = ${params.userId}
        AND ul.target_language = ${params.targetLanguage}
        AND ul.deleted_at IS NULL
        AND ul.count > 0
        ${searchClause}
        ${filterClause}
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
        AND rf.srs_due IS NOT NULL
        ${searchClause}
        ${filterClause}
        AND ${
          cursor && cursor.phase === 'scheduled'
            ? sql`(rf.srs_due, ul.id) > (${cursor.srsDue}::timestamptz, ${cursor.id}::uuid)`
            : sql`TRUE`
        }
      ORDER BY rf.srs_due ASC, ul.id ASC
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
        AND rf.srs_due IS NULL
        ${searchClause}
        ${filterClause}
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
      AND rf.srs_due IS NULL
      ${searchClause}
      ${filterClause}
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
    isProductionEnabled: boolean
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
      (pf.disabled_at IS NULL AND pf.id IS NOT NULL) AS is_production_enabled,
      c.study_session_id AS first_card_session_id
    FROM public.user_lookups ul
    LEFT JOIN public.study_facets pf
      ON pf.user_lookup_id = ul.id AND pf.skill = 'meaning_production' AND pf.target_form = ''
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
    is_production_enabled: boolean
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
    isProductionEnabled: row.is_production_enabled,
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
  findOrCreate: (
    params: {
      userId: string
      targetLanguage: string
      headword: string
      sense: string
    },
    executor?: postgres.Sql
  ) => Promise<DbUserLookup>
  recordEncounter: (userLookupIds: string[], executor?: postgres.Sql) => Promise<void>
  listByHeadwords: (params: {
    userId: string
    targetLanguage: string
    headwords: string[]
  }) => Promise<Map<string, HeadwordMatch[]>>
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
    zipf?: number | null
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
    maxLearningTerms: number
    maxNewTerms: number
    maxOptInNewTerms: number
    excludeUserLookupIds?: string[]
  }) => Promise<DbUserLookupWithFacet[]>
  findByKey: (params: {
    userId: string
    targetLanguage: string
    headword: string
    sense: string
  }) => Promise<DbUserLookup | null>
  findByIdForUser: (id: string, userId: string) => Promise<DbUserLookup | null>
  findByIdForUserIncludingDeleted: (id: string, userId: string) => Promise<DbUserLookup | null>
  getFirstCardPointerForChunk: (params: {
    userLookupId: string
    userId: string
  }) => Promise<{ cardId: string | null; sessionId: string | null }>
  setFacetEnabled: (params: {
    userLookupId: string
    userId: string
    skill: FacetSkill
    targetForm: string
    enabled: boolean
    payload?: Record<string, unknown>
  }) => Promise<DbUserLookup | null>
  getChunkRowForUser: (userLookupId: string, userId: string) => Promise<ChunkRow | null>
  listFacetsForChunk: (userLookupId: string) => Promise<ChunkFacetSummary[]>
  setFacetPayload: (params: {
    userLookupId: string
    userId: string
    skill: FacetSkill
    targetForm: string
    payload: Record<string, unknown>
    generatedPayload?: Record<string, unknown>
  }) => Promise<void>
  listCandidateFormsForChunk: (userLookupId: string) => Promise<string[]>
  deleteFacet: (
    params: { userLookupId: string; skill: FacetSkill; targetForm: string },
    executor?: postgres.Sql
  ) => Promise<void>
  listParkedTerms: (params: {
    userId: string
    targetLanguage: string
    pool: PracticePool
    restrictToUserLookupIds?: string[]
    parkedOrigin?: 'onboarding' | 'leech'
    excludeCreditedToday?: boolean
  }) => Promise<DbUserLookupWithFacet[]>
  listEligibleNewCitationFacets: (params: {
    userId: string
    targetLanguage: string
    pool: PracticePool
  }) => Promise<string[]>
  listVocabularyForLanguage: (params: { userId: string; targetLanguage: string }) => Promise<VocabularyRow[]>
  listKeptChunksForExport: (params: { userId: string; targetLanguage: string }) => Promise<ExportChunkRow[]>
  listChunksForLanguage: (params: {
    userId: string
    targetLanguage: string
    sort: ChunksSort
    cursor: ChunksCursor | null
    limit: number
    q: string | null
    skills?: string | null
    status?: VocabStatus | null
    hasMultipleForms?: boolean | null
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
      isProductionEnabled: boolean
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
    recordEncounter,
    listByHeadwords,
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
    getFirstCardPointerForChunk,
    setFacetEnabled,
    getChunkRowForUser,
    listFacetsForChunk,
    setFacetPayload,
    listCandidateFormsForChunk,
    deleteFacet,
    listParkedTerms,
    listEligibleNewCitationFacets,
    listVocabularyForLanguage,
    listKeptChunksForExport,
    listChunksForLanguage,
    softDeleteChunk,
    restoreChunk,
    listChunkContentForKeys,
    listLanguagesForUser,
  }
}
