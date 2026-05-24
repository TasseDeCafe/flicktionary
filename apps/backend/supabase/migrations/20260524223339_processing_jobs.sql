-- Durable background-job queue for highlight enrichment + session discovery.
--
-- Replaces the single synchronous basicDataPass fired from the Process button
-- (which enriched every highlight AND discovered ~60 LLM terms in one ~8-minute
-- call) with small per-job units a polling worker drains. Postgres-backed (not
-- fire-and-forget) with leases so a crashed claim is reclaimed: a claimed row
-- carries locked_at/locked_by and is re-claimable once locked_at goes stale.

CREATE TYPE public.processing_job_kind AS ENUM ('enrich_highlight', 'discover_session');
CREATE TYPE public.processing_job_status AS ENUM ('pending', 'processing', 'done', 'failed');

CREATE TABLE public.processing_jobs (
  id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
  kind public.processing_job_kind NOT NULL,
  study_session_id UUID NOT NULL,
  highlight_id UUID NULL,
  user_id UUID NOT NULL,
  status public.processing_job_status NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  -- Debounce (absorb mis-selections) on enqueue and exponential backoff on retry.
  run_after TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  -- Lease: when a worker claims a row it stamps locked_at/locked_by; a row whose
  -- locked_at is older than the staleness window is reclaimable.
  locked_at TIMESTAMP WITH TIME ZONE NULL,
  locked_by TEXT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT processing_jobs_pkey PRIMARY KEY (id),
  CONSTRAINT processing_jobs_study_session_id_fkey FOREIGN KEY (study_session_id)
    REFERENCES public.study_sessions (id) ON DELETE CASCADE,
  -- Deleting a highlight cascades away its enrich job — the backstop for the
  -- delete-while-processing race (the worker also re-checks before writing).
  CONSTRAINT processing_jobs_highlight_id_fkey FOREIGN KEY (highlight_id)
    REFERENCES public.highlights (id) ON DELETE CASCADE,
  CONSTRAINT processing_jobs_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT processing_jobs_highlight_id_required CHECK (
    (kind = 'enrich_highlight' AND highlight_id IS NOT NULL)
    OR (kind = 'discover_session' AND highlight_id IS NULL)
  )
);

-- Poll path: claimBatch scans for due pending rows ordered by run_after.
CREATE INDEX idx_processing_jobs_poll ON public.processing_jobs (status, run_after);

-- Enqueue idempotency, scoped to LIVE jobs only (pending/processing) so a brand
-- new highlight after an old one completed/failed is re-runnable, and a fresh
-- discover after a finished one is allowed. enqueue uses ON CONFLICT DO NOTHING
-- against these so a job is never double-created while one is still in flight.
CREATE UNIQUE INDEX uq_processing_jobs_live_enrich
  ON public.processing_jobs (highlight_id)
  WHERE highlight_id IS NOT NULL AND status IN ('pending', 'processing');

CREATE UNIQUE INDEX uq_processing_jobs_live_discover
  ON public.processing_jobs (study_session_id)
  WHERE kind = 'discover_session' AND status IN ('pending', 'processing');

ALTER TABLE public.processing_jobs ENABLE ROW LEVEL SECURITY;
