-- =========================================================================
-- Per-mode review cap: production (active) gets its own daily review limit
-- (study-facets Phase 2).
--
-- Today caps are passive-only: recognition uses practice_max_new_terms /
-- practice_max_review_terms, the active pool is uncapped (review-caps.ts
-- returns the hard ceiling). Phase 2 makes caps per-MODE (recognition vs
-- production), so production gets its own optional REVIEW cap.
--
--   - One append-only NULLABLE column. NULL = uncapped (hard ceiling), which
--     preserves today's active behavior exactly until the Phase-3 UI lets a
--     user set it.
--   - Production gets a REVIEW cap only — no production NEW cap: the citation
--     recognition card is the only daily-new-capped facet, production-new is
--     uncapped by design (opt-in bypass). A practice_max_new_terms_active
--     column would be a dead/contradictory knob, so it is deliberately absent.
--   - Recognition keeps reusing the existing practice_max_new_terms /
--     practice_max_review_terms columns.
-- =========================================================================

ALTER TABLE public.user_target_language_prefs
  ADD COLUMN practice_max_review_terms_active INTEGER NULL;
