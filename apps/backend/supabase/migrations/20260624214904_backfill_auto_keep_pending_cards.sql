-- Backfill: auto-keep existing data-bearing `pending` cards.
--
-- Saving a highlight while reading is already an explicit commit, so a card now
-- auto-keeps the moment it has basic flashcard data (translation / definition /
-- target_example) — the separate triage Keep step is gone. This migration
-- brings already-stored `pending` cards in line with that rule.
--
-- For each lookup that owns data-bearing pending cards, mirror the application
-- code's applyKeepTransition atomically:
--   * flip those cards `pending` -> `kept`
--   * user_lookups.count += number of cards flipped for that lookup
--   * first_card_id = COALESCE(first_card_id, earliest flipped card)
--   * deleted_at = NULL (re-keeping revives a soft-deleted chunk)
--   * create the default citation meaning_recognition facet, but ONLY when the
--     term has no study-facet rows yet — same NOT EXISTS guard as
--     ensureDefaultCitationFacetIfUnconfigured, so a historical study-intent
--     config (e.g. pronunciation-only) survives instead of gaining a stray
--     recognition facet.
--
-- Basic data lives on user_lookups, not on cards (cardHasBasicData reads the
-- joined chunk). `rejected`, `auto_rejected`, and data-less `pending`
-- (note-only stub) rows are left untouched.
--
-- All CTEs run against one snapshot, so the facet NOT EXISTS check sees the
-- pre-migration study_facets state and the unreferenced data-modifying CTEs
-- still execute to completion.

WITH eligible AS (
  SELECT c.id AS card_id, c.user_lookup_id, c.created_at
  FROM public.cards c
  JOIN public.user_lookups ul ON ul.id = c.user_lookup_id
  WHERE c.status = 'pending'
    AND (
      ul.translation IS NOT NULL
      OR ul.definition IS NOT NULL
      OR ul.target_example IS NOT NULL
    )
),
flipped AS (
  UPDATE public.cards c
  SET status = 'kept', updated_at = NOW()
  FROM eligible e
  WHERE c.id = e.card_id
  RETURNING c.id AS card_id, c.user_lookup_id, e.created_at
),
per_lookup AS (
  SELECT
    user_lookup_id,
    count(*)::int AS kept_count,
    (array_agg(card_id ORDER BY created_at, card_id))[1] AS earliest_card_id
  FROM flipped
  GROUP BY user_lookup_id
),
bumped AS (
  UPDATE public.user_lookups ul
  SET count = ul.count + pl.kept_count,
      first_card_id = COALESCE(ul.first_card_id, pl.earliest_card_id),
      deleted_at = NULL
  FROM per_lookup pl
  WHERE ul.id = pl.user_lookup_id
  RETURNING ul.id
)
INSERT INTO public.study_facets (user_lookup_id, user_id, target_language, skill, target_form)
SELECT ul.id, ul.user_id, ul.target_language, 'meaning_recognition', ''
FROM public.user_lookups ul
WHERE ul.id IN (SELECT user_lookup_id FROM per_lookup)
  AND NOT EXISTS (SELECT 1 FROM public.study_facets f WHERE f.user_lookup_id = ul.id)
ON CONFLICT (user_lookup_id, skill, target_form) DO NOTHING;
