-- =========================================================================
-- Drop the practice_session subsystem (Part 2 of 2 — DESTRUCTIVE)
--
-- Follow-up to 20260601122731_practice_texts_user_keyed, which already moved
-- every practice_text onto the (user_id, target_language, pool, ord) slot space
-- and collapsed in-flight slots to terminal history. Reading practice is now
-- sessionless; nothing in the codebase references practice_sessions,
-- practice_session_chunks, or practice_ratings anymore.
--
-- This removes the legacy practice_session_id column + its session-scoped
-- indexes from practice_texts, then drops the three session tables and the two
-- now-unused enums. Run only after the sessionless flow has been verified on the
-- dev-tunnel.
-- =========================================================================

-- 1. Detach practice_texts from practice_sessions: drop the FK, the session
--    slot uniqueness/index, the session-scoped reading guard, then the column.
ALTER TABLE public.practice_texts
  DROP CONSTRAINT IF EXISTS practice_texts_session_fkey,
  DROP CONSTRAINT IF EXISTS practice_texts_session_ord_unique;

DROP INDEX IF EXISTS public.idx_practice_texts_session_ord;
DROP INDEX IF EXISTS public.at_most_one_reading_per_session;

ALTER TABLE public.practice_texts
  DROP COLUMN IF EXISTS practice_session_id;

-- 2. Drop the session tables. Order matters for the FKs:
--    practice_ratings -> practice_texts (kept) + user_lookups (kept)
--    practice_session_chunks -> practice_sessions
--    practice_texts no longer references practice_sessions (dropped above).
DROP TABLE IF EXISTS public.practice_ratings;
DROP TABLE IF EXISTS public.practice_session_chunks;
DROP TABLE IF EXISTS public.practice_sessions;

-- 3. Drop the enums that only the dropped tables used. practice_text_status is
--    still in use by practice_texts and is left intact.
DROP TYPE IF EXISTS public.practice_rating;
DROP TYPE IF EXISTS public.practice_session_status;
