-- Uniqueness index for the browser extension's text-import flow (article
-- extraction + arbitrary selection).
--
-- One content_source per (user, imported-content hash). Like the streaming flow,
-- there is no stable per-page id we can trust (article URLs carry tracking
-- params, live-blog URLs mutate), so the natural key is the SHA-256 of the
-- parsed text segments — the same value stored as the text_track hash. Same body
-- text → same source/track/session (idempotent re-import); an edited article
-- yields a different hash and therefore a new source, which is the accepted
-- trade-off (mirrors streaming subtitles).
--
-- Scope: `type IN ('article','text') AND metadata ? 'contentHash'` covers BOTH
-- 'article' (Readability) and 'text' (selection) imports with a single index,
-- while deliberately EXCLUDING:
--   * the web app's pasted 'text' sources (metadata '{}', no contentHash) — they
--     keep creating a fresh source per paste as before; and
--   * 'streaming' sources, which ALSO carry a `metadata.contentHash` but own a
--     separate typed index (content_sources_streaming_user_content_hash_unique).
-- The exclusion matters: a second unique index covering streaming rows would
-- make the streaming flow's `ON CONFLICT ... WHERE type='streaming'` upsert hit a
-- non-arbiter unique violation on re-import instead of DO UPDATE.
--
-- The study_sessions uniqueness index (user, text_track_id, target_language)
-- added with the YouTube flow already covers this flow — it is cross-source.
--
-- No production 'article'/'text' rows carry a `contentHash` yet, so this index is
-- safe by construction.
CREATE UNIQUE INDEX content_sources_imported_text_user_content_hash_unique
  ON public.content_sources (created_by_user_id, (metadata ->> 'contentHash'))
  WHERE type IN ('article', 'text') AND metadata ? 'contentHash';
