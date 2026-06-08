-- =========================================================================
-- study_facets: one independently-scheduled card ("facet") per term surface
--
-- Phase 1 of the two-axis (target x skill) study model. A "facet" is a
-- (skill, target_form) pair on a term (a user_lookups row). It owns its own
-- FSRS + leech-rehab state and replaces the two hand-rolled column families
-- that lived on user_lookups (srs_* / active_srs_* + the per-pool leech cols).
--
--   skill        meaning_recognition (passive pool, see surface -> meaning)
--                meaning_production  (active pool,  see meaning -> surface)
--                (pronunciation is added in Phase 4 via a widened CHECK)
--   target_form  '' = the citation/lemma; else a specific inflected form
--                string (Phase 4). Every singleton facet here is target_form=''.
--
-- `pool` stays on the wire/route params unchanged; it is the DERIVED review
-- mode of a skill (recognition -> passive, production -> active), mapped at the
-- service boundary, NOT a column here.
--
-- This migration is behaviour-preserving: it backfills exactly the state that
-- lived on user_lookups, asserts a full per-column parity BEFORE dropping the
-- source columns (RAISE EXCEPTION rolls back the whole transaction on any
-- mismatch), then drops them. learning_mode is intentionally KEPT for one more
-- phase so this cutover stays purely mechanical; it is dropped in Phase 3 once
-- the "active vocabulary" concept dissolves.
--
-- Membership vs existence: a DEMOTED active term keeps its active_srs_* history
-- so a re-promotion resumes the schedule. We preserve that by backfilling a
-- meaning_production facet from the history but marking it disabled_at = now()
-- when learning_mode <> 'active'. "In production study" therefore means an
-- ENABLED (disabled_at IS NULL) production facet, never mere row existence --
-- otherwise Phase 3 would silently resurrect every demoted term.
--
-- RLS on, no policies (service-role only -- repo convention).
-- =========================================================================

CREATE TABLE public.study_facets (
  id                          UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
  user_lookup_id              UUID NOT NULL,
  -- Denormalized from user_lookups (immutable there); lets due-summary/budget
  -- group without a join back to the term.
  user_id                     UUID NOT NULL,
  target_language             TEXT NOT NULL,

  -- Widened to add 'pronunciation' in Phase 4.
  skill                       TEXT NOT NULL CHECK (skill IN ('meaning_recognition', 'meaning_production')),
  -- '' = citation/lemma; else a normalized inflected form string (Phase 4).
  target_form                 TEXT NOT NULL DEFAULT '',

  -- FSRS state. NULL state = unseen (same semantics as the old srs_state).
  srs_state                   public.srs_state NULL,
  srs_due                     TIMESTAMP WITH TIME ZONE NULL,
  srs_stability               REAL NULL,
  srs_difficulty              REAL NULL,
  srs_last_review             TIMESTAMP WITH TIME ZONE NULL,
  srs_reps                    INT NOT NULL DEFAULT 0,
  srs_lapses                  INT NOT NULL DEFAULT 0,

  -- Leech-rehab state (per facet).
  leech_parked_at             TIMESTAMP WITH TIME ZONE NULL,
  leech_rehab_correct_days    INT NOT NULL DEFAULT 0,
  leech_rehab_last_correct_on DATE NULL,

  -- Replaces user_lookups.added_to_practice_at; the daily-new count reads this
  -- on the citation recognition facet.
  introduced_at               TIMESTAMP WITH TIME ZONE NULL,
  -- Form facets carry {form, translation}; citation/pronunciation carry {}.
  payload                     JSONB NOT NULL DEFAULT '{}',
  -- Phase 4 uses 'pending_data' for facets whose render data isn't generated
  -- yet (enabled but NOT queued). Default 'ready' preserves Phase 1 behaviour.
  data_status                 TEXT NOT NULL DEFAULT 'ready'
                                CHECK (data_status IN ('ready', 'pending_data')),
  -- Form provenance (Phase 4+). Backfilled facets are 'system'.
  source                      TEXT NOT NULL DEFAULT 'system'
                                CHECK (source IN ('system', 'highlight', 'paradigm', 'manual')),
  -- disable != delete: SRS history is kept on re-enable. The queue filters
  -- disabled_at IS NULL; this carries the membership bit, not row existence.
  disabled_at                 TIMESTAMP WITH TIME ZONE NULL,

  created_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  -- App writes NOW() in every UPDATE; no DB trigger (matches the
  -- processing-jobs / cards / prefs convention).
  updated_at                  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT study_facets_pkey PRIMARY KEY (id),
  CONSTRAINT study_facets_lookup_skill_form_unique UNIQUE (user_lookup_id, skill, target_form),
  CONSTRAINT study_facets_lookup_fkey FOREIGN KEY (user_lookup_id)
    REFERENCES public.user_lookups (id) ON DELETE CASCADE
);

-- Due scans (the passive/active review queues), per (user, language, skill).
CREATE INDEX study_facets_due_idx
  ON public.study_facets (user_id, target_language, skill, srs_due)
  WHERE srs_state IS NOT NULL AND disabled_at IS NULL;

-- Vocabulary due-sort keyset cursor (NULLS LAST tail walked by user_lookup_id).
CREATE INDEX study_facets_due_sort_idx
  ON public.study_facets (user_id, target_language, skill, srs_due ASC NULLS LAST, user_lookup_id);

-- Parked-leech counts / the Strengthen gated track.
CREATE INDEX study_facets_leech_parked_idx
  ON public.study_facets (user_id, target_language, skill)
  WHERE leech_parked_at IS NOT NULL;

ALTER TABLE public.study_facets ENABLE ROW LEVEL SECURITY;

-- -------------------------------------------------------------------------
-- Backfill meaning_recognition (citation) facets from the passive srs_* /
-- leech_* / added_to_practice_at columns.
--
-- The predicate covers EVERY source column, not just count>0 / state-presence:
-- unkeep and soft-delete leave srs_* intact (recoverable history), so filtering
-- on count>0 / deleted_at would drop recoverable schedules. A row with only
-- srs_stability/difficulty/last_review set (theoretically decoupled from
-- srs_state) is still migrated.
-- -------------------------------------------------------------------------
INSERT INTO public.study_facets (
  user_lookup_id, user_id, target_language, skill, target_form,
  srs_state, srs_due, srs_stability, srs_difficulty, srs_last_review, srs_reps, srs_lapses,
  leech_parked_at, leech_rehab_correct_days, leech_rehab_last_correct_on,
  introduced_at, disabled_at
)
SELECT
  ul.id, ul.user_id, ul.target_language, 'meaning_recognition', '',
  ul.srs_state, ul.srs_due, ul.srs_stability, ul.srs_difficulty, ul.srs_last_review, ul.srs_reps, ul.srs_lapses,
  ul.leech_parked_at, ul.leech_rehab_correct_days, ul.leech_rehab_last_correct_on,
  ul.added_to_practice_at, NULL
FROM public.user_lookups ul
WHERE ul.count > 0
   OR ul.srs_state IS NOT NULL
   OR ul.srs_due IS NOT NULL
   OR ul.srs_stability IS NOT NULL
   OR ul.srs_difficulty IS NOT NULL
   OR ul.srs_last_review IS NOT NULL
   OR ul.srs_reps <> 0
   OR ul.srs_lapses <> 0
   OR ul.leech_parked_at IS NOT NULL
   OR ul.leech_rehab_correct_days <> 0
   OR ul.leech_rehab_last_correct_on IS NOT NULL
   OR ul.added_to_practice_at IS NOT NULL;

-- -------------------------------------------------------------------------
-- Backfill meaning_production (citation) facets from the active_srs_* /
-- active_leech_* columns. introduced_at stays NULL (active introductions never
-- stamped added_to_practice_at). disabled_at = now() for DEMOTED terms
-- (learning_mode <> 'active') so the preserved history exists but is not
-- queued; promote clears it in Phase 3.
-- -------------------------------------------------------------------------
INSERT INTO public.study_facets (
  user_lookup_id, user_id, target_language, skill, target_form,
  srs_state, srs_due, srs_stability, srs_difficulty, srs_last_review, srs_reps, srs_lapses,
  leech_parked_at, leech_rehab_correct_days, leech_rehab_last_correct_on,
  introduced_at, disabled_at
)
SELECT
  ul.id, ul.user_id, ul.target_language, 'meaning_production', '',
  ul.active_srs_state, ul.active_srs_due, ul.active_srs_stability, ul.active_srs_difficulty,
  ul.active_srs_last_review, ul.active_srs_reps, ul.active_srs_lapses,
  ul.active_leech_parked_at, ul.active_leech_rehab_correct_days, ul.active_leech_rehab_last_correct_on,
  NULL,
  CASE WHEN ul.learning_mode <> 'active' THEN NOW() ELSE NULL END
FROM public.user_lookups ul
WHERE ul.learning_mode = 'active'
   OR ul.active_srs_state IS NOT NULL
   OR ul.active_srs_due IS NOT NULL
   OR ul.active_srs_stability IS NOT NULL
   OR ul.active_srs_difficulty IS NOT NULL
   OR ul.active_srs_last_review IS NOT NULL
   OR ul.active_srs_reps <> 0
   OR ul.active_srs_lapses <> 0
   OR ul.active_leech_parked_at IS NOT NULL
   OR ul.active_leech_rehab_correct_days <> 0
   OR ul.active_leech_rehab_last_correct_on IS NOT NULL;

-- -------------------------------------------------------------------------
-- Parity assertion BEFORE the DROP. Full per-column diff (IS DISTINCT FROM),
-- both directions, per facet family. Any mismatch aborts the transaction so the
-- column drop never runs against bad data.
-- -------------------------------------------------------------------------
DO $$
DECLARE
  n int;
BEGIN
  -- Recognition: every migrated column matches per source row.
  SELECT count(*) INTO n
  FROM public.user_lookups ul
  JOIN public.study_facets f
    ON f.user_lookup_id = ul.id AND f.skill = 'meaning_recognition' AND f.target_form = ''
  WHERE ul.srs_state IS DISTINCT FROM f.srs_state
     OR ul.srs_due IS DISTINCT FROM f.srs_due
     OR ul.srs_stability IS DISTINCT FROM f.srs_stability
     OR ul.srs_difficulty IS DISTINCT FROM f.srs_difficulty
     OR ul.srs_last_review IS DISTINCT FROM f.srs_last_review
     OR ul.srs_reps IS DISTINCT FROM f.srs_reps
     OR ul.srs_lapses IS DISTINCT FROM f.srs_lapses
     OR ul.leech_parked_at IS DISTINCT FROM f.leech_parked_at
     OR ul.leech_rehab_correct_days IS DISTINCT FROM f.leech_rehab_correct_days
     OR ul.leech_rehab_last_correct_on IS DISTINCT FROM f.leech_rehab_last_correct_on
     OR ul.added_to_practice_at IS DISTINCT FROM f.introduced_at;
  IF n <> 0 THEN
    RAISE EXCEPTION 'study_facets cutover: % recognition facet(s) mismatch a migrated column', n;
  END IF;

  -- Recognition: no qualifying source row lacks its facet.
  SELECT count(*) INTO n
  FROM public.user_lookups ul
  WHERE (ul.count > 0
      OR ul.srs_state IS NOT NULL
      OR ul.srs_due IS NOT NULL
      OR ul.srs_stability IS NOT NULL
      OR ul.srs_difficulty IS NOT NULL
      OR ul.srs_last_review IS NOT NULL
      OR ul.srs_reps <> 0
      OR ul.srs_lapses <> 0
      OR ul.leech_parked_at IS NOT NULL
      OR ul.leech_rehab_correct_days <> 0
      OR ul.leech_rehab_last_correct_on IS NOT NULL
      OR ul.added_to_practice_at IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1 FROM public.study_facets f
      WHERE f.user_lookup_id = ul.id AND f.skill = 'meaning_recognition' AND f.target_form = ''
    );
  IF n <> 0 THEN
    RAISE EXCEPTION 'study_facets cutover: % qualifying term(s) missing a recognition facet', n;
  END IF;

  -- Production: every migrated column matches, introduced_at stays NULL, and
  -- disabled_at is set iff the term is not an active member.
  SELECT count(*) INTO n
  FROM public.user_lookups ul
  JOIN public.study_facets f
    ON f.user_lookup_id = ul.id AND f.skill = 'meaning_production' AND f.target_form = ''
  WHERE ul.active_srs_state IS DISTINCT FROM f.srs_state
     OR ul.active_srs_due IS DISTINCT FROM f.srs_due
     OR ul.active_srs_stability IS DISTINCT FROM f.srs_stability
     OR ul.active_srs_difficulty IS DISTINCT FROM f.srs_difficulty
     OR ul.active_srs_last_review IS DISTINCT FROM f.srs_last_review
     OR ul.active_srs_reps IS DISTINCT FROM f.srs_reps
     OR ul.active_srs_lapses IS DISTINCT FROM f.srs_lapses
     OR ul.active_leech_parked_at IS DISTINCT FROM f.leech_parked_at
     OR ul.active_leech_rehab_correct_days IS DISTINCT FROM f.leech_rehab_correct_days
     OR ul.active_leech_rehab_last_correct_on IS DISTINCT FROM f.leech_rehab_last_correct_on
     OR f.introduced_at IS NOT NULL
     OR (ul.learning_mode <> 'active') IS DISTINCT FROM (f.disabled_at IS NOT NULL);
  IF n <> 0 THEN
    RAISE EXCEPTION 'study_facets cutover: % production facet(s) mismatch a migrated column', n;
  END IF;

  -- Production: no qualifying source row lacks its facet.
  SELECT count(*) INTO n
  FROM public.user_lookups ul
  WHERE (ul.learning_mode = 'active'
      OR ul.active_srs_state IS NOT NULL
      OR ul.active_srs_due IS NOT NULL
      OR ul.active_srs_stability IS NOT NULL
      OR ul.active_srs_difficulty IS NOT NULL
      OR ul.active_srs_last_review IS NOT NULL
      OR ul.active_srs_reps <> 0
      OR ul.active_srs_lapses <> 0
      OR ul.active_leech_parked_at IS NOT NULL
      OR ul.active_leech_rehab_correct_days <> 0
      OR ul.active_leech_rehab_last_correct_on IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1 FROM public.study_facets f
      WHERE f.user_lookup_id = ul.id AND f.skill = 'meaning_production' AND f.target_form = ''
    );
  IF n <> 0 THEN
    RAISE EXCEPTION 'study_facets cutover: % qualifying term(s) missing a production facet', n;
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- Drop the migrated source columns from user_lookups. Postgres auto-drops the
-- dependent partial indexes (idx_user_lookups_due, idx_user_lookups_due_sort,
-- idx_user_lookups_active_due, idx_user_lookups_active_due_sort,
-- user_lookups_leech_parked_idx, user_lookups_active_leech_parked_idx) with
-- their columns, so explicit DROP INDEX is redundant. learning_mode is KEPT
-- (dropped in Phase 3).
-- -------------------------------------------------------------------------
ALTER TABLE public.user_lookups
  DROP COLUMN srs_state,
  DROP COLUMN srs_due,
  DROP COLUMN srs_stability,
  DROP COLUMN srs_difficulty,
  DROP COLUMN srs_last_review,
  DROP COLUMN srs_reps,
  DROP COLUMN srs_lapses,
  DROP COLUMN active_srs_state,
  DROP COLUMN active_srs_due,
  DROP COLUMN active_srs_stability,
  DROP COLUMN active_srs_difficulty,
  DROP COLUMN active_srs_last_review,
  DROP COLUMN active_srs_reps,
  DROP COLUMN active_srs_lapses,
  DROP COLUMN leech_parked_at,
  DROP COLUMN leech_rehab_correct_days,
  DROP COLUMN leech_rehab_last_correct_on,
  DROP COLUMN active_leech_parked_at,
  DROP COLUMN active_leech_rehab_correct_days,
  DROP COLUMN active_leech_rehab_last_correct_on,
  DROP COLUMN added_to_practice_at;
