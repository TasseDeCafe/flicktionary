-- =========================================================================
-- "Translate & add" as a practice signal.
--
-- study_facets.boosted_at / boost_prev_due — "Review tomorrow": the learner
-- pulled a reviewed card's next review forward to the start of the next day.
-- The boost is active while boosted_at > srs_last_review: every review or
-- credit stamps srs_last_review, so the first review after the boost ends it
-- with no extra write. boost_prev_due is the due date the boost replaced, for
-- its undo.
--
-- capture_demand_events — demand recorded from a capture search (or opening
-- a not-started term's card from it, or an explicit Move up). recordEncounter
-- collapses demand within an hour, so an event records whether it counted and
-- the timestamps it replaced; its undo reverts exactly what it wrote.
--
-- user_lookups.last_demand_attempt_at — stamped by every recordEncounter
-- call, collapsed or not. A capture event can be undone only while no later
-- demand (a lookup, re-save, lesson confirm) arrived: a collapsed later
-- demand left no trace in encounter_count, and undoing the event would erase
-- it.
-- =========================================================================

ALTER TABLE public.study_facets
  ADD COLUMN boosted_at TIMESTAMPTZ,
  ADD COLUMN boost_prev_due TIMESTAMPTZ;

ALTER TABLE public.user_lookups
  ADD COLUMN last_demand_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE public.capture_demand_events (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  user_lookup_id UUID NOT NULL,
  source TEXT NOT NULL,
  counted BOOLEAN NOT NULL,
  prev_last_demand_at TIMESTAMPTZ NOT NULL,
  prev_last_encountered_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reverted_at TIMESTAMPTZ,
  CONSTRAINT capture_demand_events_pkey PRIMARY KEY (id),
  CONSTRAINT capture_demand_events_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT capture_demand_events_user_lookup_id_fkey FOREIGN KEY (user_lookup_id)
    REFERENCES public.user_lookups (id) ON DELETE CASCADE,
  CONSTRAINT capture_demand_events_source_check CHECK (source IN ('search', 'edit_card', 'move_up'))
);

CREATE INDEX capture_demand_events_user_lookup_id_created_at_idx
  ON public.capture_demand_events (user_lookup_id, created_at DESC);

ALTER TABLE public.capture_demand_events ENABLE ROW LEVEL SECURITY;
