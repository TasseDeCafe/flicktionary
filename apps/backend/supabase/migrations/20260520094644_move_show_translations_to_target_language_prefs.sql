ALTER TABLE public.user_target_language_prefs
  ADD COLUMN show_translations_enabled BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE public.user_target_language_prefs prefs
SET show_translations_enabled = users.show_translations_enabled
FROM public.users users
WHERE users.id = prefs.user_id;

ALTER TABLE public.users
  DROP COLUMN show_translations_enabled;
