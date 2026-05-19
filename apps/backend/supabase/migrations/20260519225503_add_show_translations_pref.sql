ALTER TABLE public.users
  ADD COLUMN show_translations_enabled BOOLEAN NOT NULL DEFAULT TRUE;
