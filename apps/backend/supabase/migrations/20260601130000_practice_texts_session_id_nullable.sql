-- =========================================================================
-- practice_texts.practice_session_id: drop NOT NULL (bridge migration)
--
-- Sits between the additive re-key (20260601122731) and the destructive drop
-- (20260601131531). Reading practice is now sessionless, so newly generated
-- texts are inserted without a practice_session_id. The column itself still
-- exists (and the session tables still reference it) until the destructive
-- migration drops it, but it must be nullable in the meantime so the new
-- generator can insert rows during the verification window.
-- =========================================================================

ALTER TABLE public.practice_texts
  ALTER COLUMN practice_session_id DROP NOT NULL;
