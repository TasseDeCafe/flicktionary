-- Internal pool rename: 'passive'/'active' -> 'recognition'/'production'.
-- The public API already uses the new names (mapped at the router boundary);
-- this rewrites the stored values so the boundary mappers can be deleted.
-- The pool mapping is bijective, so the partial unique indexes on
-- (user_id, target_language, pool[, ord]) cannot collide during the rewrite,
-- and indexes reference the column (not values) so none need redefining.

-- practice_texts: named CHECK + the only pool column with a DEFAULT.
ALTER TABLE public.practice_texts
  DROP CONSTRAINT practice_texts_pool_check;

UPDATE public.practice_texts
SET pool = CASE pool WHEN 'passive' THEN 'recognition' WHEN 'active' THEN 'production' END;

ALTER TABLE public.practice_texts
  ADD CONSTRAINT practice_texts_pool_check CHECK (pool IN ('recognition', 'production')),
  ALTER COLUMN pool SET DEFAULT 'recognition';

-- practice_exercises
ALTER TABLE public.practice_exercises
  DROP CONSTRAINT practice_exercises_pool_check;

UPDATE public.practice_exercises
SET pool = CASE pool WHEN 'passive' THEN 'recognition' WHEN 'active' THEN 'production' END;

ALTER TABLE public.practice_exercises
  ADD CONSTRAINT practice_exercises_pool_check CHECK (pool IN ('recognition', 'production'));

-- practice_rating_events
ALTER TABLE public.practice_rating_events
  DROP CONSTRAINT practice_rating_events_pool_check;

UPDATE public.practice_rating_events
SET pool = CASE pool WHEN 'passive' THEN 'recognition' WHEN 'active' THEN 'production' END;

ALTER TABLE public.practice_rating_events
  ADD CONSTRAINT practice_rating_events_pool_check CHECK (pool IN ('recognition', 'production'));

-- The per-mode production review cap follows the rename (metadata-only).
ALTER TABLE public.user_target_language_prefs
  RENAME COLUMN practice_max_review_terms_active TO practice_max_review_terms_production;
