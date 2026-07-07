-- Wire the extract_lesson job kind into processing_jobs. Unlike every existing
-- kind, an extract job belongs to an import batch, not a study session (the
-- session is created at CONFIRM, not upload — no abandoned empty sessions), so
-- study_session_id becomes nullable and the kind/identity CHECK grows a branch.

ALTER TABLE public.processing_jobs
  ADD COLUMN import_batch_id UUID NULL,
  ADD CONSTRAINT processing_jobs_import_batch_id_fkey FOREIGN KEY (import_batch_id)
    REFERENCES public.import_batches (id) ON DELETE CASCADE;

ALTER TABLE public.processing_jobs
  ALTER COLUMN study_session_id DROP NOT NULL;

-- Kind/identity matrix: enrich_highlight + seed_card_chat carry a highlight
-- (and a session); extract_lesson carries ONLY an import batch; every other
-- kind carries a session and neither of the other two ids.
ALTER TABLE public.processing_jobs
  DROP CONSTRAINT processing_jobs_highlight_id_required;

ALTER TABLE public.processing_jobs
  ADD CONSTRAINT processing_jobs_highlight_id_required CHECK (
    (
      kind IN ('enrich_highlight', 'seed_card_chat')
      AND highlight_id IS NOT NULL
      AND study_session_id IS NOT NULL
      AND import_batch_id IS NULL
    )
    OR (
      kind = 'extract_lesson'
      AND import_batch_id IS NOT NULL
      AND highlight_id IS NULL
      AND study_session_id IS NULL
    )
    OR (
      kind NOT IN ('enrich_highlight', 'seed_card_chat', 'extract_lesson')
      AND highlight_id IS NULL
      AND study_session_id IS NOT NULL
      AND import_batch_id IS NULL
    )
  );

-- Enqueue idempotency for LIVE extraction jobs, mirroring
-- uq_processing_jobs_live_discover: one in-flight extraction per batch.
CREATE UNIQUE INDEX uq_processing_jobs_live_extract_lesson
  ON public.processing_jobs (import_batch_id)
  WHERE kind = 'extract_lesson' AND status IN ('pending', 'processing');
