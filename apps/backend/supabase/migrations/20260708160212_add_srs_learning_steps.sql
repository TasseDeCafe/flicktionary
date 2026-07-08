-- ts-fsrs v5 tracks which intraday learning step a card is on via a per-card
-- `learning_steps` counter (default ladder: 1m -> 10m -> graduate to Review).
-- The scheduler wrapper used to rebuild every card with the counter hardcoded
-- to 0, so a Good on a learning-state card always recomputed "advance to step
-- 1, stay in Learning" and no card could ever graduate to Review through the
-- rating path. Persist the counter on the facet, and snapshot it on rating
-- events so undo restores it with the rest of the SRS family.

ALTER TABLE public.study_facets
  ADD COLUMN srs_learning_steps INT NOT NULL DEFAULT 0;

ALTER TABLE public.practice_rating_events
  ADD COLUMN prev_srs_learning_steps INT NULL;

-- Repair cards already stuck in learning state. Their true step is unknowable
-- retroactively; setting the counter to the last ladder step means the next
-- non-again rating graduates them to Review instead of restarting the ladder.
-- (Relearning cards need no repair: that ladder has a single step, so Good
-- already graduates from step 0.)
UPDATE public.study_facets
SET srs_learning_steps = 1
WHERE srs_state = 'learning';
