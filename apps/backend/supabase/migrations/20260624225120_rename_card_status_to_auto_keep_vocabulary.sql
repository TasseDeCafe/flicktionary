-- Rename the card_status enum to match the auto-keep session-vocabulary model.
--
-- Saving a highlight is the explicit commit, so a card auto-keeps the moment it
-- has basic data — the triage-era status names no longer describe what the
-- values mean:
--   pending       -> needs_data   (a card with no basic flashcard data yet —
--                                   usually a note-only stub awaiting generation)
--   kept          -> kept         (contributes to user_lookups.count; in
--                                   Vocabulary/Practice)
--   rejected      -> removed      (removed from its session vocabulary list;
--                                   NOT a soft-delete of the term)
--   auto_rejected -> removed      (legacy below-CEFR auto-reject; user highlights
--                                   never produce these anymore)
--
-- Data-bearing `pending` cards were already backfilled to `kept` by
-- 20260624214904_backfill_auto_keep_pending_cards.sql, so the remaining
-- `pending` rows are genuine note-only stubs that map to `needs_data`.

CREATE TYPE public.card_status_new AS ENUM ('needs_data', 'kept', 'removed');

ALTER TABLE public.cards ALTER COLUMN status DROP DEFAULT;

ALTER TABLE public.cards
  ALTER COLUMN status TYPE public.card_status_new
  USING (
    CASE status::text
      WHEN 'pending' THEN 'needs_data'
      WHEN 'kept' THEN 'kept'
      WHEN 'rejected' THEN 'removed'
      WHEN 'auto_rejected' THEN 'removed'
    END
  )::public.card_status_new;

DROP TYPE public.card_status;

ALTER TYPE public.card_status_new RENAME TO card_status;

ALTER TABLE public.cards ALTER COLUMN status SET DEFAULT 'needs_data';
