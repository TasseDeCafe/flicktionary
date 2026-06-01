-- Uniqueness index for the streaming-site ingestion flow.
--
-- One content_source per (user, subtitle contentHash). Streaming sites have no
-- stable per-site video id we parse (their URLs are volatile SPA state), so the
-- natural key is the SHA-256 of the rendered subtitle segments — the same value
-- the extension already sends as `subtitles.contentHash` and stores as the
-- text_track hash. Same subtitle content → same source/track/session (idempotent
-- re-open); a different subtitle track or language of the same episode becomes a
-- separate source, which is the accepted trade-off for not parsing per-site ids.
--
-- The study_sessions uniqueness index (user, text_track_id, target_language)
-- added with the YouTube flow already covers this flow — it is cross-source.
--
-- No production 'streaming' rows exist yet, so the index is safe by construction.
CREATE UNIQUE INDEX content_sources_streaming_user_content_hash_unique
  ON public.content_sources (created_by_user_id, (metadata ->> 'contentHash'))
  WHERE type = 'streaming';
