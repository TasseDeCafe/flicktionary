-- Wire the build_track_lemma_profile job kind into processing_jobs. A profile
-- build belongs to a TEXT TRACK, not a session: SRT/paste imports create the
-- track before any session exists, and one track can back many sessions (TV
-- season, shared extension content) — so the job gets its own FK and a new
-- branch in the kind/identity CHECK.

ALTER TABLE public.processing_jobs
  ADD COLUMN text_track_id UUID NULL,
  ADD CONSTRAINT processing_jobs_text_track_id_fkey FOREIGN KEY (text_track_id)
    REFERENCES public.text_tracks (id) ON DELETE CASCADE;

-- Kind/identity matrix: enrich_highlight + seed_card_chat carry a highlight
-- (and a session); extract_lesson carries ONLY an import batch;
-- build_track_lemma_profile carries ONLY a text track; every other kind
-- carries a session and none of the other ids.
ALTER TABLE public.processing_jobs
  DROP CONSTRAINT processing_jobs_highlight_id_required;

ALTER TABLE public.processing_jobs
  ADD CONSTRAINT processing_jobs_highlight_id_required CHECK (
    (
      kind IN ('enrich_highlight', 'seed_card_chat')
      AND highlight_id IS NOT NULL
      AND study_session_id IS NOT NULL
      AND import_batch_id IS NULL
      AND text_track_id IS NULL
    )
    OR (
      kind = 'extract_lesson'
      AND import_batch_id IS NOT NULL
      AND highlight_id IS NULL
      AND study_session_id IS NULL
      AND text_track_id IS NULL
    )
    OR (
      kind = 'build_track_lemma_profile'
      AND text_track_id IS NOT NULL
      AND highlight_id IS NULL
      AND study_session_id IS NULL
      AND import_batch_id IS NULL
    )
    OR (
      kind NOT IN ('enrich_highlight', 'seed_card_chat', 'extract_lesson', 'build_track_lemma_profile')
      AND highlight_id IS NULL
      AND study_session_id IS NOT NULL
      AND import_batch_id IS NULL
      AND text_track_id IS NULL
    )
  );

-- Enqueue coalescing for LIVE profile builds, mirroring
-- uq_processing_jobs_live_extract_lesson: one in-flight build per track.
CREATE UNIQUE INDEX uq_processing_jobs_live_build_track_lemma_profile
  ON public.processing_jobs (text_track_id)
  WHERE kind = 'build_track_lemma_profile' AND status IN ('pending', 'processing');
