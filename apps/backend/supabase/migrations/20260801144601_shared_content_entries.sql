-- Community-shared content catalog ("Explore"). One row per published text
-- track. A row is publicly listed ("live") while both unshared_at and
-- removed_at are NULL; the row is kept (never deleted) after unshare/removal
-- so it doubles as an opt-out marker and an admin tombstone.
--
-- canonical_key is the cross-user identity of the shared content
-- ('youtube:{videoId}', 'hash:{contentHash}', or 'track:{trackId}' as a
-- fallback): YouTube/text sources are deduped per-user, so without it N users
-- sharing the same video would create N indistinguishable feed rows, and an
-- admin tombstone would only cover one of them.

CREATE TABLE public.shared_content_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_source_id UUID NOT NULL,
  text_track_id UUID NOT NULL,
  canonical_key TEXT NOT NULL,
  language TEXT NOT NULL,
  shared_by_user_id UUID NULL REFERENCES auth.users (id) ON DELETE SET NULL,
  featured BOOLEAN NOT NULL DEFAULT FALSE,
  unshared_at TIMESTAMPTZ NULL,
  removed_at TIMESTAMPTZ NULL,
  removed_reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT shared_content_entries_text_track_id_unique UNIQUE (text_track_id),
  -- Composite FK so the track is guaranteed to belong to the source, mirroring
  -- study_sessions_content_source_text_track_fkey.
  CONSTRAINT shared_content_entries_content_source_text_track_fkey
    FOREIGN KEY (content_source_id, text_track_id)
    REFERENCES public.text_tracks (content_source_id, id)
    ON DELETE CASCADE,
  -- An admin tombstone must keep its reason; a plain unshare has none.
  CONSTRAINT shared_content_entries_removed_pair_check CHECK ((
    (removed_at IS NULL AND removed_reason IS NULL)
    OR (removed_at IS NOT NULL AND removed_reason IS NOT NULL)
  ) IS TRUE)
);

-- The public feed: live entries filtered by language, newest first.
CREATE INDEX idx_shared_content_entries_live_language
  ON public.shared_content_entries (language, created_at DESC)
  WHERE unshared_at IS NULL AND removed_at IS NULL;

-- One live entry per canonical content across all users.
CREATE UNIQUE INDEX shared_content_entries_live_canonical_key_unique
  ON public.shared_content_entries (canonical_key)
  WHERE unshared_at IS NULL AND removed_at IS NULL;

-- Owner lookups (share toggle, account-deletion unpublish).
CREATE INDEX idx_shared_content_entries_shared_by_user
  ON public.shared_content_entries (shared_by_user_id);

ALTER TABLE public.shared_content_entries ENABLE ROW LEVEL SECURITY;

-- Publishing a YouTube track moderates it at share time (YouTube ingest is not
-- gated). Unlike the gated surfaces — where a hard-block verdict rejects the
-- content before any row exists — the track already exists here, so the
-- verdict needs a durable home: 'blocked' (category required) means the track
-- can never be published; private study is unaffected.
ALTER TABLE public.text_tracks
  DROP CONSTRAINT text_tracks_moderation_pair_check;
ALTER TABLE public.text_tracks
  ADD CONSTRAINT text_tracks_moderation_pair_check CHECK ((
    (moderation_status IS NULL AND moderation_category IS NULL)
    OR (moderation_status = 'clean' AND moderation_category IS NULL)
    OR (moderation_status = 'flagged' AND moderation_category IS NOT NULL)
    OR (moderation_status = 'blocked' AND moderation_category IS NOT NULL)
  ) IS TRUE);
