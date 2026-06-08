-- =========================================================================
-- Facet identity on the rating-event log (study-facets Phase 2).
--
-- practice_rating_events carried only `pool` (the session queue) to address
-- the rated card. Once the passive queue serves more than one facet per term
-- (pronunciation, specific forms — Phase 4), `pool` no longer identifies WHICH
-- card was rated. Add the facet identity columns so undo targets the exact
-- facet and the daily review budget can count distinct facets, not terms.
--
--   - `skill` + `target_form` are the facet identity (matching study_facets);
--     `pool` STAYS and keeps its meaning: which session queue produced the
--     rating. (Do not overload `pool`.)
--   - skill CHECK is the 2-value meaning form here; Phase 4 widens it to add
--     'pronunciation' alongside study_facets.skill.
--   - Existing rows are backfilled from `pool` (the only identity they had):
--     active -> meaning_production, everything else -> meaning_recognition,
--     target_form '' (every pre-Phase-2 facet is the citation form).
-- =========================================================================

ALTER TABLE public.practice_rating_events
  ADD COLUMN skill TEXT NOT NULL DEFAULT 'meaning_recognition'
    CHECK (skill IN ('meaning_recognition', 'meaning_production')),
  ADD COLUMN target_form TEXT NOT NULL DEFAULT '';

-- Backfill skill from the session pool for pre-Phase-2 rows. target_form keeps
-- its '' default (all historical facets are the citation form).
UPDATE public.practice_rating_events
SET skill = CASE pool WHEN 'active' THEN 'meaning_production' ELSE 'meaning_recognition' END;

-- Undo lookup: latest live event for one facet identity, newest first. Partial
-- on the live rows (reverted events are never undo targets), matching the
-- findLatestLiveEventForUndo query shape.
CREATE INDEX idx_practice_rating_events_facet_undo
  ON public.practice_rating_events (user_lookup_id, skill, target_form, rated_at DESC)
  WHERE reverted_at IS NULL;
