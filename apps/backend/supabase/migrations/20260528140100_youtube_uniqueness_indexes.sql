-- Uniqueness indexes that support the YouTube ingestion flow.
--
-- 1. One content_source per (user, youtubeVideoId). YouTube videos have a
--    single audio language; the natural key is therefore the (user, videoId)
--    pair stored in metadata. Distinct from the existing adhoc uniqueness
--    pattern (which keys on language) — see plan.
--
-- 2. One study_session per (user, text_track_id, target_language).
--    This is intentionally cross-source: `study_sessions.text_track_id` is
--    single-valued, so two sessions for the same user+text_track+target_language
--    are already semantically redundant for every source type. The partial
--    index serializes concurrent inserters for the YouTube flow without an
--    advisory lock. Soft-deleted sessions are excluded so a user can re-create
--    a session over the same track after removing one.
--
-- A pre-check guards against legacy duplicates: if existing data violates the
-- session uniqueness invariant we abort here rather than half-creating the
-- index. (No production YouTube rows exist yet, so the content_sources index
-- is safe by construction.)

DO $$
DECLARE
  duplicate_count INT;
BEGIN
  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT 1
    FROM public.study_sessions
    WHERE deleted_at IS NULL
    GROUP BY user_id, text_track_id, target_language
    HAVING COUNT(*) > 1
  ) AS dups;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION
      'Cannot add study_sessions uniqueness index: % (user_id, text_track_id, target_language) groups violate it. Resolve duplicates and retry.',
      duplicate_count;
  END IF;
END $$;

CREATE UNIQUE INDEX content_sources_youtube_user_video_unique
  ON public.content_sources (created_by_user_id, (metadata ->> 'youtubeVideoId'))
  WHERE type = 'youtube';

CREATE UNIQUE INDEX study_sessions_user_track_target_lang_unique
  ON public.study_sessions (user_id, text_track_id, target_language)
  WHERE deleted_at IS NULL;
