ALTER TABLE public.users
  ADD COLUMN ui_theme TEXT CHECK (ui_theme IN ('light', 'dark', 'system')),
  ADD COLUMN ui_language TEXT;
