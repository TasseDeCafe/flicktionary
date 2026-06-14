-- TV episodes captured via the TMDB + OpenSubtitles session flow store one
-- content_source per episode, distinguished from movies by this enum value.
-- A new enum value cannot be referenced as a literal in the same transaction it
-- is added, so the partial unique index that keys on type = 'tv' lives in the
-- next migration.
ALTER TYPE public.content_source_type ADD VALUE IF NOT EXISTS 'tv';
