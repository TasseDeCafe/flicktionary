-- Scope subtitle dedupe to the content source and language it belongs to.
ALTER TABLE public.text_tracks
  DROP CONSTRAINT IF EXISTS text_tracks_hash_unique;

ALTER TABLE public.text_tracks
  ADD CONSTRAINT text_tracks_content_source_language_hash_unique
  UNIQUE (content_source_id, language, hash);

ALTER TABLE public.text_tracks
  ADD CONSTRAINT text_tracks_content_source_id_id_unique
  UNIQUE (content_source_id, id);

ALTER TABLE public.study_sessions
  ADD CONSTRAINT study_sessions_content_source_text_track_fkey
  FOREIGN KEY (content_source_id, text_track_id)
  REFERENCES public.text_tracks (content_source_id, id)
  ON DELETE RESTRICT;
