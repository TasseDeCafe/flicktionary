-- Passive vs active vocabulary: every kept term still participates in passive
-- practice (existing srs_* columns), but the user can promote a deliberate
-- subset into a parallel "active" drill pool with independent SRS state.
--
-- The original srs_* columns on user_lookups continue to back the passive pool.
-- A parallel active_srs_* column set backs the active pool. practice_sessions
-- and practice_ratings carry a pool tag so rating events know which SRS state
-- to advance, and the per-language session uniqueness becomes per-pool so a
-- passive session and an active drill can coexist for the same target language.

ALTER TABLE public.user_lookups
  ADD COLUMN learning_mode TEXT NOT NULL DEFAULT 'passive'
    CHECK (learning_mode IN ('passive', 'active')),
  ADD COLUMN active_srs_state public.srs_state NULL,
  ADD COLUMN active_srs_due TIMESTAMP WITH TIME ZONE NULL,
  ADD COLUMN active_srs_stability REAL NULL,
  ADD COLUMN active_srs_difficulty REAL NULL,
  ADD COLUMN active_srs_last_review TIMESTAMP WITH TIME ZONE NULL,
  ADD COLUMN active_srs_reps INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN active_srs_lapses INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_user_lookups_active_due
  ON public.user_lookups (user_id, target_language, active_srs_due)
  WHERE learning_mode = 'active'
    AND active_srs_state IS NOT NULL
    AND deleted_at IS NULL;

CREATE INDEX idx_user_lookups_active_due_sort
  ON public.user_lookups (user_id, target_language, active_srs_due ASC NULLS LAST, id)
  WHERE learning_mode = 'active'
    AND deleted_at IS NULL;

ALTER TABLE public.practice_sessions
  ADD COLUMN pool TEXT NOT NULL DEFAULT 'passive'
    CHECK (pool IN ('passive', 'active'));

ALTER TABLE public.practice_ratings
  ADD COLUMN pool TEXT NOT NULL DEFAULT 'passive'
    CHECK (pool IN ('passive', 'active'));

-- Replace the single per-language active-session constraint with a per-pool
-- one so a passive session and an active drill can coexist for the same
-- (user_id, target_language).
DROP INDEX public.one_active_practice_session_per_user_lang;

CREATE UNIQUE INDEX one_active_practice_session_per_user_lang_pool
  ON public.practice_sessions (user_id, target_language, pool)
  WHERE status = 'active';
