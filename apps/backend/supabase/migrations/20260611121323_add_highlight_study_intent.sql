-- Study intent on highlights: an optional facet configuration chosen in the
-- gloss-save popover, applied by the enrich_highlight job once the user_lookup
-- materializes. `study_intent_applied_at` is stamped in the same transaction as
-- the facet writes so a job retry can never re-apply (re-enabling facets the
-- user has since disabled, or re-firing generation over an edited payload).
-- The intent itself is kept after application as provenance.
ALTER TABLE public.highlights
  ADD COLUMN study_intent JSONB NULL,
  ADD COLUMN study_intent_applied_at TIMESTAMPTZ NULL;
