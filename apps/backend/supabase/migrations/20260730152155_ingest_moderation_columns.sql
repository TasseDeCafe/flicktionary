-- Moderation verdicts for user-authored ingestion (paste, SRT upload,
-- extension text import, Telegram, lesson notes). The verdict lives on the
-- ingested document itself, not on content_sources: movie sources are shared
-- across users and can carry unmoderated sibling tracks (e.g. OpenSubtitles),
-- so a source-level verdict could cross users or mislabel other tracks.
--
-- Semantics:
--   NULL      → never checked (pre-feature rows, or the classifier failed open)
--   'clean'   → checked, nothing notable (category must be NULL)
--   'flagged' → checked, accepted, but carries a category for a future
--               content-sharing gate (category must be non-NULL)
-- There is no 'blocked' value: blocked content is rejected before insert.
--
-- The CHECK is wrapped in IS TRUE because the bare three-branch OR evaluates
-- to UNKNOWN for a (NULL, non-NULL) pair, and CHECK accepts UNKNOWN.

ALTER TABLE public.text_tracks
  ADD COLUMN moderation_status TEXT NULL,
  ADD COLUMN moderation_category TEXT NULL,
  ADD CONSTRAINT text_tracks_moderation_pair_check CHECK ((
    (moderation_status IS NULL AND moderation_category IS NULL)
    OR (moderation_status = 'clean' AND moderation_category IS NULL)
    OR (moderation_status = 'flagged' AND moderation_category IS NOT NULL)
  ) IS TRUE);

-- Lesson imports are moderated at batch-creation time, before any text_track
-- exists. The verdict is stored on the batch so the resume-dedupe path can
-- tell "already checked" from "never checked" (otherwise a pre-feature or
-- failed-open batch would bypass moderation forever), and is propagated to
-- the lesson track when the confirmed batch creates its session.
ALTER TABLE public.import_batches
  ADD COLUMN moderation_status TEXT NULL,
  ADD COLUMN moderation_category TEXT NULL,
  ADD CONSTRAINT import_batches_moderation_pair_check CHECK ((
    (moderation_status IS NULL AND moderation_category IS NULL)
    OR (moderation_status = 'clean' AND moderation_category IS NULL)
    OR (moderation_status = 'flagged' AND moderation_category IS NOT NULL)
  ) IS TRUE);
