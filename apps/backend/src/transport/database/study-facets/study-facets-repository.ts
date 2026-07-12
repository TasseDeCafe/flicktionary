import postgres from 'postgres'
import { beginTx, sql } from '../postgres-client'
import { Tables, Database } from '../database.public.types'

// One independently-scheduled card on a term. Identity is
// (user_lookup_id, skill, target_form); it owns its own FSRS + leech state.
export type DbStudyFacet = Tables<'study_facets'>
export type SrsState = Database['public']['Enums']['srs_state']

// Phase 1 ships the two meaning skills; 'pronunciation' (recognition-mode,
// citation-only) is added in Phase 4.
export type FacetSkill = 'meaning_recognition' | 'meaning_production' | 'pronunciation'

// The citation/lemma target. Every Phase-1 facet keys on this; specific
// inflected forms (non-empty strings) arrive in Phase 4.
export const CITATION_FORM = ''

// `pool` (the session queue / wire param) names which review queue a facet
// belongs to — the static per-skill property that also decides which per-pool
// budget/cap applies. Budgets and daily caps are per-pool, NOT per-skill (see
// the plan: no per-skill caps). This maps a pool to the citation card identity
// at the service boundary.
export type PracticePool = 'recognition' | 'production'
export const skillForPool = (pool: PracticePool): FacetSkill =>
  pool === 'production' ? 'meaning_production' : 'meaning_recognition'

// The skills that belong to each pool. Returned as raw strings (not
// FacetSkill) so 'pronunciation' is already covered for forward-compat: it has
// no rows until Phase 4 widens the CHECK, but a recognition-pool budget/queue
// filter that lists it is correct now and needs no change then.
export const skillsForPool = (pool: PracticePool): string[] =>
  pool === 'production' ? ['meaning_production'] : ['meaning_recognition', 'pronunciation']

// The inverse of skillsForPool: a skill's pool. Only meaning_production is in
// the production pool; meaning_recognition and pronunciation are in the
// recognition pool. Used for pool-specific FSRS rules (e.g. the next-day
// recognition floor) that apply to recognition skills as a class.
export const poolForSkill = (skill: string): PracticePool =>
  skill === 'meaning_production' ? 'production' : 'recognition'

// The daily-new-capped facets are the two CITATION cards — recognition and
// production share ONE combined introductions-per-day budget (a both-pools
// term consumes two slots). Pronunciation and every form facet toggled in the
// matrix bypass the cap — they're explicit opt-ins, born `new`, entered via
// "learn new" at the user's pace. `skill` is a raw string so a future
// 'pronunciation'/form facet routes correctly here too.
export const isDailyNewCappedFacet = (skill: string, targetForm: string): boolean =>
  (skill === 'meaning_recognition' || skill === 'meaning_production') && targetForm === CITATION_FORM

// `pool` (the session queue / wire param) names which queue you entered, not
// card identity. These are the legal (pool, skill) pairs — the recognition
// queue serves recognition skills, the production queue serves production.
// Validate server-side in rateTerm/undoRating so a crafted
// (production, pronunciation) 400s.
export const isLegalPoolSkill = (pool: PracticePool, skill: string): boolean =>
  pool === 'production' ? skill === 'meaning_production' : skillsForPool('recognition').includes(skill)

export type FacetAddress = {
  userLookupId: string
  skill: FacetSkill
  targetForm: string
}

// Get one facet by its full identity. Null when it doesn't exist yet.
const getFacet = async (params: FacetAddress, executor: postgres.Sql = sql): Promise<DbStudyFacet | null> => {
  const result = (await executor`
    SELECT *
    FROM public.study_facets
    WHERE user_lookup_id = ${params.userLookupId}
      AND skill = ${params.skill}
      AND target_form = ${params.targetForm}
  `) as DbStudyFacet[]
  return result[0] ?? null
}

// Idempotently create the citation recognition facet for a kept term. The
// denormalized user_id / target_language are pulled from the term row so the
// caller only needs the lookup id. ON CONFLICT DO NOTHING makes a re-keep or a
// repair pass safe and never resurrects a disabled facet. Used inside the keep
// transaction (atomic count-bump + facet creation) and as the practice-fetch
// repair path for any count>0 term found lacking its recognition facet.
const ensureCitationFacet = async (userLookupId: string, executor: postgres.Sql = sql): Promise<void> => {
  await executor`
    INSERT INTO public.study_facets (user_lookup_id, user_id, target_language, skill, target_form)
    SELECT ul.id, ul.user_id, ul.target_language, 'meaning_recognition', ${CITATION_FORM}
    FROM public.user_lookups ul
    WHERE ul.id = ${userLookupId}
    ON CONFLICT (user_lookup_id, skill, target_form) DO NOTHING
  `
}

// Keep-time DEFAULT: create the citation recognition facet only when the term
// has NO study-facet rows at all. Any existing row — enabled, disabled, another
// skill or form — means the user already configured study targets pre-keep
// (e.g. pronunciation-only from the focus view), and Keep must respect
// that instead of force-adding recognition. The plain Keep path (selector never
// touched → zero rows) keeps its recognition default. Row-existence, not
// "no ENABLED facet", so a deliberately dormant (all-skills-off) term isn't
// resurrected by a re-keep. ON CONFLICT still guards the NOT-EXISTS race on
// concurrent keeps.
const ensureDefaultCitationFacetIfUnconfigured = async (
  userLookupId: string,
  executor: postgres.Sql = sql
): Promise<void> => {
  await executor`
    INSERT INTO public.study_facets (user_lookup_id, user_id, target_language, skill, target_form)
    SELECT ul.id, ul.user_id, ul.target_language, 'meaning_recognition', ${CITATION_FORM}
    FROM public.user_lookups ul
    WHERE ul.id = ${userLookupId}
      AND NOT EXISTS (SELECT 1 FROM public.study_facets f WHERE f.user_lookup_id = ul.id)
    ON CONFLICT (user_lookup_id, skill, target_form) DO NOTHING
  `
}

// Generic idempotent facet creation for an arbitrary (skill, target_form).
// Used when a facet is enabled (e.g. promote creates the production facet).
//
// `dataStatus`/`source`/`payload` apply ONLY to a freshly-inserted row (the
// column defaults are 'ready'/'system'/{}). ON CONFLICT DO NOTHING means an
// EXISTING facet keeps its stored data_status/source/payload — re-enabling a
// previously-disabled, history-bearing form facet must not revert it to
// pending_data or wipe its generated payload. Phase 4b passes
// dataStatus='pending_data', source='manual' when a NEW form facet is created
// from the term view (it needs Opus/manual data before it can be queued).
const ensureFacet = async (
  params: FacetAddress & {
    dataStatus?: 'ready' | 'pending_data'
    source?: 'system' | 'highlight' | 'paradigm' | 'manual'
    payload?: Record<string, unknown>
  },
  executor: postgres.Sql = sql
): Promise<void> => {
  const payloadJson = params.payload ? sql.json(params.payload as unknown as postgres.JSONValue) : null
  await executor`
    INSERT INTO public.study_facets (
      user_lookup_id, user_id, target_language, skill, target_form, data_status, source, payload
    )
    SELECT ul.id, ul.user_id, ul.target_language, ${params.skill}, ${params.targetForm},
      ${params.dataStatus ?? 'ready'}, ${params.source ?? 'system'},
      ${payloadJson ? sql`${payloadJson}::jsonb` : sql`'{}'::jsonb`}
    FROM public.user_lookups ul
    WHERE ul.id = ${params.userLookupId}
    ON CONFLICT (user_lookup_id, skill, target_form) DO NOTHING
  `
}

// Clear a facet's disabled_at (membership ON), merging `payload` into its
// JSONB when provided. A REAL re-enable (disabled_at was actually set) also
// resets the leech-rehab state — membership changed, so any in-flight rehab
// progress is stale; an idempotent re-enable never wipes progress. Shared by
// setFacetEnabled's enable branch and applyStudyIntentFacets; pass a
// transaction to commit atomically with the ensureFacet that precedes it.
const enableFacet = async (
  params: FacetAddress & { payload?: Record<string, unknown> },
  executor: postgres.Sql = sql
): Promise<void> => {
  const payloadJson = params.payload ? sql.json(params.payload as unknown as postgres.JSONValue) : null
  await executor`
    UPDATE public.study_facets
    SET disabled_at = NULL,
        payload = ${payloadJson ? sql`payload || ${payloadJson}::jsonb` : sql`payload`},
        leech_parked_at = CASE WHEN disabled_at IS DISTINCT FROM NULL THEN NULL ELSE leech_parked_at END,
        leech_rehab_correct_days = CASE WHEN disabled_at IS DISTINCT FROM NULL THEN 0 ELSE leech_rehab_correct_days END,
        leech_rehab_last_correct_on = CASE WHEN disabled_at IS DISTINCT FROM NULL THEN NULL ELSE leech_rehab_last_correct_on END,
        updated_at = NOW()
    WHERE user_lookup_id = ${params.userLookupId}
      AND skill = ${params.skill}
      AND target_form = ${params.targetForm}
  `
}

// One facet of a gloss-save study intent, as prepared by the applyStudyIntent
// service (which owns the lemma-collapse / skill rules). dataStatus / source /
// payload only apply to a freshly-inserted row (ensureFacet semantics).
export type StudyIntentFacetSpec = FacetAddress & {
  dataStatus?: 'ready' | 'pending_data'
  source?: 'system' | 'highlight' | 'paradigm' | 'manual'
  payload?: Record<string, unknown>
}

// Apply a gloss-save study intent's facet set in ONE transaction: every spec is
// idempotently created (ensureFacet — an existing facet keeps its stored
// data_status/source/payload) and then enabled (enable-only, additive on term
// dedupe; an intent never disables anything). `guardHighlightId` is the
// double-application guard for the async enrichment path: the highlight's
// study_intent_applied_at is stamped IN THIS transaction, so a job retry or
// re-enqueue finds it set and no-ops — it can never re-enable facets the user
// has since disabled, nor cause generation to re-fire over an edited payload.
// Returns false when the guard lost (nothing was applied). The highlights
// UPDATE living in this repository is a deliberate layering exception: the
// stamp MUST be atomic with the facet writes or the guard is worthless.
const applyStudyIntentFacets = async (
  params: {
    userLookupId: string
    facets: StudyIntentFacetSpec[]
    guardHighlightId?: string
  },
  // When given, the writes join the caller's transaction instead of opening
  // their own (the lesson-import confirm applies intents inside its
  // all-or-nothing batch transaction).
  executor?: postgres.Sql
): Promise<boolean> => {
  const run = async (tx: postgres.Sql): Promise<boolean> => {
    if (params.guardHighlightId) {
      const stamped = (await tx`
        UPDATE public.highlights
        SET study_intent_applied_at = NOW()
        WHERE id = ${params.guardHighlightId}
          AND study_intent_applied_at IS NULL
        RETURNING id
      `) as Array<{ id: string }>
      if (!stamped[0]) return false
    }
    for (const facet of params.facets) {
      await ensureFacet(facet, tx)
      await enableFacet(facet, tx)
    }
    return true
  }
  return executor ? await run(executor) : await beginTx(run)
}

// Race-safe daily-new-cap guard for either citation meaning facet. Introduces
// the never-seen facet (srs_state='new', due now, introduced_at stamped) only
// when the combined citation count for this (user, language) is under the cap.
//
// The advisory transaction lock serializes flashcard introductions per
// (user, language); the count + update decision runs one-at-a-time. There is
// no cap bypass here — the explicit past-the-cap path (Learn extra) goes
// through the warm-up park guard below instead.

// Citation introductions consumed today, counted across BOTH pools — the two
// citation skills share one combined daily budget, so every capped guard must
// compare against the same subquery (and take the same advisory lock, or two
// pools introducing concurrently could both pass the count).
const citationIntroductionsTodaySql = (userId: string, targetLanguage: string) => sql`
  SELECT COUNT(*)
  FROM public.study_facets f2
  JOIN public.user_lookups ul2 ON ul2.id = f2.user_lookup_id
  WHERE ul2.user_id = ${userId}
    AND ul2.target_language = ${targetLanguage}
    AND ul2.count > 0
    AND ul2.deleted_at IS NULL
    AND f2.skill IN ('meaning_recognition', 'meaning_production')
    AND f2.target_form = ${CITATION_FORM}
    AND f2.introduced_at >= CURRENT_DATE
    AND f2.introduced_at < CURRENT_DATE + INTERVAL '1 day'
`
const initializeCitationFacetIfUnderDailyCap = async (params: {
  userLookupId: string
  userId: string
  targetLanguage: string
  skill: 'meaning_recognition' | 'meaning_production'
  maxNewTerms: number
}): Promise<boolean> => {
  return await beginTx(async (tx) => {
    await tx`
      SELECT pg_advisory_xact_lock(hashtext(${`flashcards:${params.userId}:${params.targetLanguage}`}))
    `
    const rows = (await tx`
      UPDATE public.study_facets f
      SET srs_state = 'new',
          srs_due = NOW(),
          introduced_at = NOW(),
          updated_at = NOW()
      FROM public.user_lookups ul
      WHERE f.user_lookup_id = ul.id
        AND f.user_lookup_id = ${params.userLookupId}
        AND f.skill = ${params.skill}
        AND f.target_form = ${CITATION_FORM}
        AND f.srs_state IS NULL
        AND f.leech_parked_at IS NULL
        AND ul.user_id = ${params.userId}
        AND ul.target_language = ${params.targetLanguage}
        AND ul.count > 0
        AND ul.deleted_at IS NULL
        AND (${citationIntroductionsTodaySql(params.userId, params.targetLanguage)}) < ${params.maxNewTerms}
      RETURNING f.id
    `) as Array<{ id: string }>
    return rows.length > 0
  })
}

// Atomic "enter exercise-first warm-up" for a CITATION facet (either pool —
// both share the combined daily budget): stamp introduced_at (consuming
// today's budget, like a flashcard introduction) AND park the facet
// (leech_parked_at) in ONE transaction, so a crash can't leave the term
// introduced-and-in-the-flashcard-queue but unparked. Unlike
// initializeCitationFacetIfUnderDailyCap it deliberately leaves srs_state
// NULL — parked already keeps it out of the flashcard queue, and a NULL state
// keeps the onboarding (parked + never-reviewed) shape clean for derivation.
// Graduation's unparkAndSoftReentryFacet later overwrites srs_state and never
// touches introduced_at.
//
// SELECT-then-decide under the advisory lock so the 3-valued result is
// unambiguous (the UPDATE's row count can't say WHY it matched nothing):
//   'not_eligible' — facet missing/disabled, already introduced (srs_state not
//                    null), or already parked (covers a concurrent-park race).
//   'cap_reached'  — eligible but today's introduced count is already at/over
//                    maxNewTerms.
//   'scaffolded'   — introduced + parked.
//
// One lock key covers BOTH pools — required for a race-safe combined count.
// `bypassCap` (an explicit learn-extra request) skips ONLY the cap comparison:
// the lock, the eligibility checks and the introduced_at stamp all stay, so
// bypassed warm-up entries still count toward today's introductions.
const initializeAndParkCitationFacetIfUnderDailyCap = async (params: {
  userLookupId: string
  userId: string
  targetLanguage: string
  skill: 'meaning_recognition' | 'meaning_production'
  maxNewTerms: number
  bypassCap?: boolean
}): Promise<'scaffolded' | 'cap_reached' | 'not_eligible'> => {
  return await beginTx(async (tx) => {
    await tx`
      SELECT pg_advisory_xact_lock(hashtext(${`flashcards:${params.userId}:${params.targetLanguage}`}))
    `
    const facetRows = (await tx`
      SELECT f.srs_state, f.leech_parked_at, f.disabled_at
      FROM public.study_facets f
      JOIN public.user_lookups ul ON ul.id = f.user_lookup_id
      WHERE f.user_lookup_id = ${params.userLookupId}
        AND f.skill = ${params.skill}
        AND f.target_form = ${CITATION_FORM}
        AND ul.user_id = ${params.userId}
        AND ul.target_language = ${params.targetLanguage}
        AND ul.count > 0
        AND ul.deleted_at IS NULL
    `) as Array<{ srs_state: SrsState | null; leech_parked_at: string | null; disabled_at: string | null }>
    const facet = facetRows[0]
    if (!facet || facet.disabled_at !== null || facet.srs_state !== null || facet.leech_parked_at !== null) {
      return 'not_eligible' as const
    }

    if (!params.bypassCap) {
      const countRows = (await tx`
        SELECT (${citationIntroductionsTodaySql(params.userId, params.targetLanguage)})::int AS introduced_today
      `) as Array<{ introduced_today: number }>
      if ((countRows[0]?.introduced_today ?? 0) >= params.maxNewTerms) return 'cap_reached' as const
    }

    await tx`
      UPDATE public.study_facets
      SET introduced_at = NOW(),
          leech_parked_at = NOW(),
          leech_rehab_correct_days = 0,
          leech_rehab_last_correct_on = NULL,
          updated_at = NOW()
      WHERE user_lookup_id = ${params.userLookupId}
        AND skill = ${params.skill}
        AND target_form = ${CITATION_FORM}
    `
    return 'scaffolded' as const
  })
}

// The citation facet state (for `skill`, default meaning_recognition) of every
// distinct kept term in a study session. Resolves terms by the canonical
// cards.user_lookup_id FK (not by headword/sense); DISTINCT ON collapses
// multiple kept cards pointing at the same term. The LEFT JOIN tolerates a term
// with no facet row for that skill — hasFacet=false then. Feeds warm-up
// eligibility (enter scaffolding) and resume-serving (already onboarding-parked)
// decisions in one place; the `skill` arg lets the production warm-up read its
// own meaning_production facet from the same query.
export type SessionKeptCitationFacet = {
  userLookupId: string
  hasFacet: boolean
  srsState: SrsState | null
  leechParkedAt: string | null
  disabledAt: string | null
}

const listSessionKeptCitationFacets = async (
  studySessionId: string,
  skill: FacetSkill = 'meaning_recognition'
): Promise<SessionKeptCitationFacet[]> => {
  const rows = (await sql`
    SELECT DISTINCT ON (ul.id)
      ul.id AS user_lookup_id,
      (f.id IS NOT NULL) AS has_facet,
      f.srs_state,
      f.leech_parked_at,
      f.disabled_at
    FROM public.cards c
    JOIN public.user_lookups ul ON ul.id = c.user_lookup_id AND ul.deleted_at IS NULL
    LEFT JOIN public.study_facets f
      ON f.user_lookup_id = ul.id AND f.skill = ${skill} AND f.target_form = ${CITATION_FORM}
    WHERE c.study_session_id = ${studySessionId}
      AND c.status = 'kept'
    ORDER BY ul.id
  `) as Array<{
    user_lookup_id: string
    has_facet: boolean
    srs_state: SrsState | null
    leech_parked_at: string | null
    disabled_at: string | null
  }>
  return rows.map((row) => ({
    userLookupId: row.user_lookup_id,
    hasFacet: row.has_facet,
    srsState: row.srs_state,
    leechParkedAt: row.leech_parked_at,
    disabledAt: row.disabled_at,
  }))
}

// Unconditional facet introduction (no daily-new cap) — the OPT-IN facet path
// (pronunciation / specific forms): each was individually enabled, so the
// first rating must never be refused by the budget. It does NOT stamp
// introduced_at — only the two citation facets consume the combined daily
// budget. No-op if the facet is already seen.
const initializeFacet = async (params: FacetAddress): Promise<void> => {
  await sql`
    UPDATE public.study_facets
    SET srs_state = 'new',
        srs_due = NOW(),
        updated_at = NOW()
    WHERE user_lookup_id = ${params.userLookupId}
      AND skill = ${params.skill}
      AND target_form = ${params.targetForm}
      AND srs_state IS NULL
  `
}

// Patch a facet's FSRS columns from a ts-fsrs result. `executor` defaults to the
// pool; pass a transaction so the patch commits atomically with its
// practice_rating_events row.
const applyFsrsResultForFacet = async (
  params: FacetAddress & {
    state: SrsState
    due: Date
    stability: number
    difficulty: number
    lastReview: Date
    reps: number
    lapses: number
    learningSteps: number
  },
  executor: postgres.Sql = sql
): Promise<void> => {
  await executor`
    UPDATE public.study_facets
    SET srs_state = ${params.state},
        srs_due = ${params.due.toISOString()},
        srs_stability = ${params.stability},
        srs_difficulty = ${params.difficulty},
        srs_last_review = ${params.lastReview.toISOString()},
        srs_reps = ${params.reps},
        srs_lapses = ${params.lapses},
        srs_learning_steps = ${params.learningSteps},
        updated_at = NOW()
    WHERE user_lookup_id = ${params.userLookupId}
      AND skill = ${params.skill}
      AND target_form = ${params.targetForm}
  `
}

// Undo support: restore a facet's FSRS family from a practice_rating_events
// prev_srs_* snapshot. wasIntroduction additionally clears introduced_at
// (refunding the daily-new slot); causedParking un-parks and zeroes rehab
// progress. reps/lapses columns are NOT NULL; the snapshot's nulls only occur
// on the introduction path where 0 is the correct pre-introduction value.
const restoreSrsSnapshotForFacet = async (
  params: FacetAddress & {
    prevState: SrsState | null
    prevDue: string | null
    prevStability: number | null
    prevDifficulty: number | null
    prevLastReview: string | null
    prevReps: number | null
    prevLapses: number | null
    prevLearningSteps: number | null
    wasIntroduction: boolean
    causedParking: boolean
  },
  executor: postgres.Sql = sql
): Promise<void> => {
  await executor`
    UPDATE public.study_facets
    SET srs_state = ${params.prevState},
        srs_due = ${params.prevDue},
        srs_stability = ${params.prevStability},
        srs_difficulty = ${params.prevDifficulty},
        srs_last_review = ${params.prevLastReview},
        srs_reps = ${params.prevReps ?? 0},
        srs_lapses = ${params.prevLapses ?? 0},
        srs_learning_steps = ${params.prevLearningSteps ?? 0},
        introduced_at = CASE WHEN ${params.wasIntroduction} THEN NULL ELSE introduced_at END,
        leech_parked_at = CASE WHEN ${params.causedParking} THEN NULL ELSE leech_parked_at END,
        leech_rehab_correct_days = CASE WHEN ${params.causedParking} THEN 0 ELSE leech_rehab_correct_days END,
        leech_rehab_last_correct_on = CASE WHEN ${params.causedParking} THEN NULL ELSE leech_rehab_last_correct_on END,
        updated_at = NOW()
    WHERE user_lookup_id = ${params.userLookupId}
      AND skill = ${params.skill}
      AND target_form = ${params.targetForm}
  `
}

// Park a facet out of its review rotation. The parked_at IS NULL guard makes a
// double-park a no-op rather than a rehab-progress reset.
const parkLeechFacet = async (params: FacetAddress): Promise<void> => {
  await sql`
    UPDATE public.study_facets
    SET leech_parked_at = NOW(),
        leech_rehab_correct_days = 0,
        leech_rehab_last_correct_on = NULL,
        updated_at = NOW()
    WHERE user_lookup_id = ${params.userLookupId}
      AND skill = ${params.skill}
      AND target_form = ${params.targetForm}
      AND leech_parked_at IS NULL
  `
}

// One graduation-day credit for a correct gate-exercise answer. The
// IS DISTINCT FROM CURRENT_DATE guard enforces at most one advance per server
// calendar day. Returns the new correct-day count, or null when no advance
// happened (already credited today, or the facet isn't parked).
const advanceRehabDayFacet = async (params: FacetAddress): Promise<number | null> => {
  const rows = (await sql`
    UPDATE public.study_facets
    SET leech_rehab_correct_days = leech_rehab_correct_days + 1,
        leech_rehab_last_correct_on = CURRENT_DATE,
        updated_at = NOW()
    WHERE user_lookup_id = ${params.userLookupId}
      AND skill = ${params.skill}
      AND target_form = ${params.targetForm}
      AND leech_parked_at IS NOT NULL
      AND leech_rehab_last_correct_on IS DISTINCT FROM CURRENT_DATE
    RETURNING leech_rehab_correct_days
  `) as Array<{ leech_rehab_correct_days: number }>
  return rows[0]?.leech_rehab_correct_days ?? null
}

// Graduation: clear the facet's parked/rehab state and re-enter FSRS on a
// softened schedule in one update. reps/lapses stay UNCHANGED (history
// preserved; the parked_at flag is the re-park gate). Never touches
// introduced_at.
const unparkAndSoftReentryFacet = async (
  params: FacetAddress & {
    state: SrsState
    due: Date
    stability: number
    difficulty: number
    lastReview: Date
  }
): Promise<void> => {
  await sql`
    UPDATE public.study_facets
    SET srs_state = ${params.state},
        srs_due = ${params.due.toISOString()},
        srs_stability = ${params.stability},
        srs_difficulty = ${params.difficulty},
        srs_last_review = ${params.lastReview.toISOString()},
        srs_learning_steps = 0,
        leech_parked_at = NULL,
        leech_rehab_correct_days = 0,
        leech_rehab_last_correct_on = NULL,
        updated_at = NOW()
    WHERE user_lookup_id = ${params.userLookupId}
      AND skill = ${params.skill}
      AND target_form = ${params.targetForm}
      AND leech_parked_at IS NOT NULL
  `
}

export interface StudyFacetsRepositoryInterface {
  getFacet: (params: FacetAddress, executor?: postgres.Sql) => Promise<DbStudyFacet | null>
  ensureCitationFacet: (userLookupId: string, executor?: postgres.Sql) => Promise<void>
  ensureFacet: (
    params: FacetAddress & {
      dataStatus?: 'ready' | 'pending_data'
      source?: 'system' | 'highlight' | 'paradigm' | 'manual'
      payload?: Record<string, unknown>
    },
    executor?: postgres.Sql
  ) => Promise<void>
  initializeCitationFacetIfUnderDailyCap: (params: {
    userLookupId: string
    userId: string
    targetLanguage: string
    skill: 'meaning_recognition' | 'meaning_production'
    maxNewTerms: number
  }) => Promise<boolean>
  initializeAndParkCitationFacetIfUnderDailyCap: (params: {
    userLookupId: string
    userId: string
    targetLanguage: string
    skill: 'meaning_recognition' | 'meaning_production'
    maxNewTerms: number
    bypassCap?: boolean
  }) => Promise<'scaffolded' | 'cap_reached' | 'not_eligible'>
  listSessionKeptCitationFacets: (studySessionId: string, skill?: FacetSkill) => Promise<SessionKeptCitationFacet[]>
  initializeFacet: (params: FacetAddress) => Promise<void>
  applyFsrsResultForFacet: (
    params: FacetAddress & {
      state: SrsState
      due: Date
      stability: number
      difficulty: number
      lastReview: Date
      reps: number
      lapses: number
      learningSteps: number
    },
    executor?: postgres.Sql
  ) => Promise<void>
  restoreSrsSnapshotForFacet: (
    params: FacetAddress & {
      prevState: SrsState | null
      prevDue: string | null
      prevStability: number | null
      prevDifficulty: number | null
      prevLastReview: string | null
      prevReps: number | null
      prevLapses: number | null
      prevLearningSteps: number | null
      wasIntroduction: boolean
      causedParking: boolean
    },
    executor?: postgres.Sql
  ) => Promise<void>
  applyStudyIntentFacets: (
    params: {
      userLookupId: string
      facets: StudyIntentFacetSpec[]
      guardHighlightId?: string
    },
    executor?: postgres.Sql
  ) => Promise<boolean>
  parkLeechFacet: (params: FacetAddress) => Promise<void>
  advanceRehabDayFacet: (params: FacetAddress) => Promise<number | null>
  unparkAndSoftReentryFacet: (
    params: FacetAddress & {
      state: SrsState
      due: Date
      stability: number
      difficulty: number
      lastReview: Date
    }
  ) => Promise<void>
}

// Module-level functions importable directly (e.g. user-lookups-repository's
// keep transaction calls ensureDefaultCitationFacetIfUnconfigured inside its
// tx, and setFacetEnabled calls ensureFacet + enableFacet on enable).
export { ensureCitationFacet, ensureDefaultCitationFacetIfUnconfigured, ensureFacet, enableFacet }

export const StudyFacetsRepository = (): StudyFacetsRepositoryInterface => ({
  getFacet,
  ensureCitationFacet,
  ensureFacet,
  initializeCitationFacetIfUnderDailyCap,
  initializeAndParkCitationFacetIfUnderDailyCap,
  listSessionKeptCitationFacets,
  initializeFacet,
  applyFsrsResultForFacet,
  restoreSrsSnapshotForFacet,
  applyStudyIntentFacets,
  parkLeechFacet,
  advanceRehabDayFacet,
  unparkAndSoftReentryFacet,
})
