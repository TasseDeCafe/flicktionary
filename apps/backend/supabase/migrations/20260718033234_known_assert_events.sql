-- =========================================================================
-- Known-assertion events (docs/SRS.md §6c): the backlog "I already know
-- this" action seeds never-introduced recognition facets straight into
-- review state. For an ONBOARDING-PARKED facet the assertion also unparks
-- (exits onboarding) — and exact undo must restore the full prior park
-- state, including PARTIAL rehab progress (warm-up gates advance rehab days
-- while parked). These snapshot columns are the caused_parking mirror image:
-- caused_unparking events restore leech_parked_at + rehab columns on revert.
-- =========================================================================

ALTER TABLE public.practice_rating_events
  ADD COLUMN caused_unparking BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN prev_leech_parked_at TIMESTAMP WITH TIME ZONE NULL,
  ADD COLUMN prev_leech_rehab_correct_days INTEGER NULL,
  ADD COLUMN prev_leech_rehab_last_correct_on DATE NULL;
