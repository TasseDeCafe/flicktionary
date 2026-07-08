-- =========================================================================
-- user_lookups: new-term priority signals
--
-- The new-term buckets (listReviewTerms bucket 3/4, warm-up discovery via
-- listEligibleNewCitationFacets) order by a computed tier instead of pure
-- created_at FIFO:
--
--   tier 1  revealed demand  — encounter_count >= 2 (saved again, or a lesson
--                              import confirmed a duplicate)
--   tier 2  fresh saves      — last_encountered_at within the freshness window
--   tier 3  the backlog      — ordered by zipf_estimate DESC (common first)
--
--   zipf_estimate        LLM-estimated continuous Zipf frequency (one decimal,
--                         0-8; ~7 = "the", ~2 = genuinely rare). Emitted by the
--                         basic-data pass and the one-off backfill script.
--                         NULL = not yet estimated (sorts last within its tier).
--   last_encountered_at  refreshed by recordEncounter() at user-intent
--                         boundaries (highlight save enrichment, lesson-import
--                         confirm) — never by background reprocessing.
--   encounter_count      bumped by the same boundary, with a collapse window
--                         so retries can't inflate it.
--
-- Never-introduced terms whose last encounter is older than the decay window
-- fall off the new-term queue entirely (virtual shelf); any re-encounter
-- revives them.
-- =========================================================================

ALTER TABLE public.user_lookups
  ADD COLUMN zipf_estimate numeric(3, 1),
  ADD COLUMN last_encountered_at timestamptz NOT NULL DEFAULT NOW(),
  ADD COLUMN encounter_count int NOT NULL DEFAULT 1;

-- Existing rows: the save that created the row is the one known encounter.
-- count > 1 means the user kept cards for it more than once — the closest
-- existing proxy for repeat encounters.
UPDATE public.user_lookups
SET last_encountered_at = created_at,
    encounter_count = GREATEST(count, 1);

CREATE INDEX user_lookups_zipf_estimate_idx
  ON public.user_lookups (user_id, target_language, zipf_estimate DESC)
  WHERE deleted_at IS NULL;
