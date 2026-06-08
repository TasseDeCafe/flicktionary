import postgres from 'postgres'
import { beginTx, sql } from '../postgres-client'
import { Tables, Database } from '../database.public.types'

// One independently-scheduled card on a term. Identity is
// (user_lookup_id, skill, target_form); it owns its own FSRS + leech state.
export type DbStudyFacet = Tables<'study_facets'>
export type SrsState = Database['public']['Enums']['srs_state']

// Phase 1 ships the two meaning skills; 'pronunciation' is added in Phase 4.
export type FacetSkill = 'meaning_recognition' | 'meaning_production'

// The citation/lemma target. Every Phase-1 facet keys on this; specific
// inflected forms (non-empty strings) arrive in Phase 4.
export const CITATION_FORM = ''

// `pool` (the session queue / wire param) is the DERIVED review mode of a
// skill. It stays on the wire unchanged; this maps it to card identity at the
// service boundary. recognition -> passive, production -> active.
export type PracticePool = 'passive' | 'active'
export const skillForPool = (pool: PracticePool): FacetSkill =>
  pool === 'active' ? 'meaning_production' : 'meaning_recognition'

// A skill's review MODE — the static property that decides which session queue
// (and which per-mode budget/cap) a facet belongs to. recognition skills are
// reviewed in the passive queue; production in the active queue. Budgets and
// daily caps are per-mode, NOT per-skill (see the plan: no per-skill caps).
export type ReviewMode = 'recognition' | 'production'

// The skills that belong to each review mode. Returned as raw strings (not
// FacetSkill) so 'pronunciation' is already covered for forward-compat: it has
// no rows until Phase 4 widens the CHECK, but a recognition-mode budget/queue
// filter that lists it is correct now and needs no change then.
export const skillsForReviewMode = (mode: ReviewMode): string[] =>
  mode === 'production' ? ['meaning_production'] : ['meaning_recognition', 'pronunciation']

// The ONLY daily-new-capped facet is the citation recognition card ("I'm
// starting to learn this word"). Pronunciation, production, and every
// form/skill toggled in the matrix bypass the daily-new cap — they're explicit
// opt-ins, born `new`, entered via "learn new" at the user's pace. `skill` is a
// raw string so a future 'pronunciation'/form facet routes correctly here too.
export const isDailyNewCappedFacet = (skill: string, targetForm: string): boolean =>
  skill === 'meaning_recognition' && targetForm === CITATION_FORM

// `pool` (the session queue / wire param) names which queue you entered, not
// card identity. These are the legal (pool, skill) pairs — the passive queue
// serves recognition skills, the active queue serves production. Validate
// server-side in rateTerm/undoRating so a crafted (active, pronunciation) 400s.
export const isLegalPoolSkill = (pool: PracticePool, skill: string): boolean =>
  pool === 'active' ? skill === 'meaning_production' : skillsForReviewMode('recognition').includes(skill)

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

// Generic idempotent facet creation for an arbitrary (skill, target_form).
// Used when a facet is enabled (e.g. promote creates the production facet).
const ensureFacet = async (params: FacetAddress, executor: postgres.Sql = sql): Promise<void> => {
  await executor`
    INSERT INTO public.study_facets (user_lookup_id, user_id, target_language, skill, target_form)
    SELECT ul.id, ul.user_id, ul.target_language, ${params.skill}, ${params.targetForm}
    FROM public.user_lookups ul
    WHERE ul.id = ${params.userLookupId}
    ON CONFLICT (user_lookup_id, skill, target_form) DO NOTHING
  `
}

// Race-safe daily-new-cap guard for the citation recognition facet — the ONLY
// daily-new-capped facet. Introduces the never-seen facet (srs_state='new', due
// now, introduced_at stamped) only when the day's introduced count for this
// (user, language) is still under maxNewTerms.
//
// The advisory transaction lock serializes flashcard introductions per
// (user, language); the count + update decision runs one-at-a-time. `bypassCap`
// (an explicit learn-new session) drops ONLY the < maxNewTerms predicate: the
// lock, the srs_state IS NULL guard and the introduced_at stamp all stay, so
// bypassed introductions still count toward today.
const initializeCitationFacetIfUnderDailyCap = async (params: {
  userLookupId: string
  userId: string
  targetLanguage: string
  maxNewTerms: number
  bypassCap?: boolean
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
        AND f.skill = 'meaning_recognition'
        AND f.target_form = ${CITATION_FORM}
        AND f.srs_state IS NULL
        AND ul.user_id = ${params.userId}
        AND ul.target_language = ${params.targetLanguage}
        AND ul.count > 0
        AND ul.deleted_at IS NULL
        AND (
          ${params.bypassCap ?? false}
          OR (
            SELECT COUNT(*)
            FROM public.study_facets f2
            JOIN public.user_lookups ul2 ON ul2.id = f2.user_lookup_id
            WHERE ul2.user_id = ${params.userId}
              AND ul2.target_language = ${params.targetLanguage}
              AND ul2.count > 0
              AND ul2.deleted_at IS NULL
              AND f2.skill = 'meaning_recognition'
              AND f2.target_form = ${CITATION_FORM}
              AND f2.introduced_at >= CURRENT_DATE
              AND f2.introduced_at < CURRENT_DATE + INTERVAL '1 day'
          ) < ${params.maxNewTerms}
        )
      RETURNING f.id
    `) as Array<{ id: string }>
    return rows.length > 0
  })
}

// Unconditional facet introduction (no daily-new cap) — the production-citation
// path. Mirrors the legacy active-pool initializer: it does NOT stamp
// introduced_at, because production was never daily-new-capped. No-op if the
// facet is already seen.
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
  ensureFacet: (params: FacetAddress, executor?: postgres.Sql) => Promise<void>
  initializeCitationFacetIfUnderDailyCap: (params: {
    userLookupId: string
    userId: string
    targetLanguage: string
    maxNewTerms: number
    bypassCap?: boolean
  }) => Promise<boolean>
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
      wasIntroduction: boolean
      causedParking: boolean
    },
    executor?: postgres.Sql
  ) => Promise<void>
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
// keep transaction calls ensureCitationFacet inside its tx, and setFacetEnabled
// calls ensureFacet to create the facet on enable).
export { ensureCitationFacet, ensureFacet }

export const StudyFacetsRepository = (): StudyFacetsRepositoryInterface => ({
  getFacet,
  ensureCitationFacet,
  ensureFacet,
  initializeCitationFacetIfUnderDailyCap,
  initializeFacet,
  applyFsrsResultForFacet,
  restoreSrsSnapshotForFacet,
  parkLeechFacet,
  advanceRehabDayFacet,
  unparkAndSoftReentryFacet,
})
