ALTER TABLE public.user_target_language_prefs
  ADD COLUMN practice_max_new_terms INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN practice_max_review_terms INTEGER NOT NULL DEFAULT 100;

UPDATE public.user_target_language_prefs prefs
SET practice_max_new_terms = users.practice_max_new_terms,
    practice_max_review_terms = users.practice_max_review_terms
FROM public.users users
WHERE users.id = prefs.user_id;

ALTER TABLE public.users
  DROP COLUMN practice_max_new_terms,
  DROP COLUMN practice_max_review_terms;
