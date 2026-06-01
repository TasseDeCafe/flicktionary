-- =========================================================================
-- practice_texts: re-key from practice_session_id to (user_id, target_language,
-- pool)
--
-- Part 1 of 2 (ADDITIVE). This migration adds the new identity columns and the
-- (user_id, target_language, pool, ord) slot space so reading practice can
-- become sessionless — generated texts are kept per (user, language, pool) and
-- double as history. The practice_session_id column and the session subsystem
-- (practice_sessions / practice_session_chunks / practice_ratings) are left in
-- place here and dropped in the follow-up destructive migration once the new
-- code path is verified.
--
-- Existing texts are preserved as history. Because the legacy ord space was
-- per-session, several texts in the same (user, language, pool) collide on ord;
-- we renumber per group. In-flight slots (reading/ready/pending/generating) are
-- collapsed to terminal states so the new generator never resurfaces a slot
-- that was reserved under the old session model.
-- =========================================================================

ALTER TABLE public.practice_texts
  ADD COLUMN user_id UUID NULL,
  ADD COLUMN target_language TEXT NULL,
  ADD COLUMN pool TEXT NULL;

-- Backfill identity from the parent session.
UPDATE public.practice_texts pt
SET user_id = ps.user_id,
    target_language = ps.target_language,
    pool = ps.pool
FROM public.practice_sessions ps
WHERE ps.id = pt.practice_session_id;

-- Collapse in-flight slots to terminal history. A text that was being read is
-- now done; never-surfaced pre-gen slots become done when they hold a usable
-- body, otherwise failed. This guarantees no (user, language, pool) starts the
-- new sessionless flow with a leftover 'reading'/'ready' slot.
UPDATE public.practice_texts
SET status = 'done', read_at = COALESCE(read_at, NOW())
WHERE status = 'reading';

UPDATE public.practice_texts
SET status = (CASE
  WHEN body IS NOT NULL AND jsonb_array_length(annotations) > 0 THEN 'done'
  ELSE 'failed'
END)::practice_text_status
WHERE status IN ('ready', 'pending', 'generating');

-- Renumber ord densely within each (user, language, pool) group, chronological.
--
-- The legacy practice_texts_session_ord_unique (practice_session_id, ord) is
-- still live here, and Postgres checks UNIQUE per-row (immediately), not at
-- statement end. A direct renumber can therefore transiently collide: setting a
-- row to ord=k clashes with a not-yet-updated sibling in the same session that
-- still holds the old ord=k, even though the final per-group numbering is valid.
--
-- So bump every ord into a high, disjoint band first (adding a constant larger
-- than any existing ord is a bijection that can't collide with the small
-- originals or with already-bumped rows), then renumber down to dense values:
-- not-yet-updated rows sit in the high band while updated rows hold distinct
-- small ords, so every intermediate state is unique.
UPDATE public.practice_texts SET ord = ord + 1000000000;

WITH renum AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY user_id, target_language, pool
           ORDER BY created_at ASC, id ASC
         ) - 1 AS new_ord
  FROM public.practice_texts
)
UPDATE public.practice_texts pt
SET ord = renum.new_ord
FROM renum
WHERE renum.id = pt.id;

-- Every row had a parent session (FK was NOT NULL), so the backfill is total.
ALTER TABLE public.practice_texts
  ALTER COLUMN user_id SET NOT NULL,
  ALTER COLUMN target_language SET NOT NULL,
  ALTER COLUMN pool SET NOT NULL,
  ALTER COLUMN pool SET DEFAULT 'passive';

ALTER TABLE public.practice_texts
  ADD CONSTRAINT practice_texts_pool_check CHECK (pool IN ('passive', 'active'));

ALTER TABLE public.practice_texts
  ADD CONSTRAINT practice_texts_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users (id) ON DELETE CASCADE;

-- New slot space: one ord sequence per (user, language, pool). Also the index
-- backing history listing + next-slot reservation.
CREATE UNIQUE INDEX practice_texts_user_lang_pool_ord_unique
  ON public.practice_texts (user_id, target_language, pool, ord);

-- At most one in-progress 'reading' text per (user, language, pool) — the
-- sessionless analogue of at_most_one_reading_per_session.
CREATE UNIQUE INDEX at_most_one_reading_per_user_lang_pool
  ON public.practice_texts (user_id, target_language, pool)
  WHERE status = 'reading';
