-- =========================================================================
-- user_lookups: per-pool leech-rehab state
--
-- A term whose FSRS lapses cross the leech threshold gets PARKED out of all
-- practice queues (flashcards and reading-text candidate selection both feed
-- from listReviewTerms). The parked flag must be explicit — lapses stay >= 4
-- after graduation, so a derived "lapses >= threshold" check would instantly
-- re-park a graduated term. Parking is per pool: the passive family uses the
-- unprefixed columns, the active family uses active_*.
--
--   *_leech_parked_at             NULL = in rotation; set = parked out
--   *_leech_rehab_correct_days    count of DISTINCT calendar days with a
--                                 correct gate-exercise answer (graduation at
--                                 3; also drives the exercise-difficulty tier)
--   *_leech_rehab_last_correct_on the server CURRENT_DATE of the last counted
--                                 correct answer — enforces one advance/day
-- =========================================================================

ALTER TABLE public.user_lookups
  ADD COLUMN leech_parked_at timestamptz,
  ADD COLUMN leech_rehab_correct_days int NOT NULL DEFAULT 0,
  ADD COLUMN leech_rehab_last_correct_on date,
  ADD COLUMN active_leech_parked_at timestamptz,
  ADD COLUMN active_leech_rehab_correct_days int NOT NULL DEFAULT 0,
  ADD COLUMN active_leech_rehab_last_correct_on date;

-- Parked terms are a small minority; partial indexes keep the
-- "list parked terms for (user, language)" queries cheap without taxing the
-- common fully-unparked case.
CREATE INDEX user_lookups_leech_parked_idx
  ON public.user_lookups (user_id, target_language)
  WHERE leech_parked_at IS NOT NULL;

CREATE INDEX user_lookups_active_leech_parked_idx
  ON public.user_lookups (user_id, target_language)
  WHERE active_leech_parked_at IS NOT NULL;
