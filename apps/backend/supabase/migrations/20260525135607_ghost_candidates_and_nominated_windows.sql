-- Phase 2: ghost candidates (passive LLM-suggested spans) + per-window nomination coverage.
--
-- Replaces the up-front whole-text discovery pass with reading-window nomination:
-- as the reader scrolls, small Opus passes over the window ahead nominate spans
-- worth learning, rendered as a passive outline layer. ghost_candidates holds those
-- spans; nominated_windows is the coverage set so a window (even one that yielded
-- nothing) is never re-requested and reloads resume where the reader left off.

-- New job kind for the Phase-1 worker to dispatch. ADD VALUE is transaction-safe in
-- PG12+; the new label is never referenced as a literal in this migration (the
-- widened highlight_id check uses <> against the existing label), so it is safe to
-- run alongside the rest of the file.
ALTER TYPE public.processing_job_kind ADD VALUE IF NOT EXISTS 'nominate_window';

-- A nominate_window job carries the segment-index window to nominate over (rather
-- than a highlight_id). Widen the kind/identity check accordingly: only
-- enrich_highlight carries a highlight_id; every other kind must leave it NULL.
ALTER TABLE public.processing_jobs
  ADD COLUMN window_start_index INTEGER NULL,
  ADD COLUMN window_end_index INTEGER NULL;

ALTER TABLE public.processing_jobs
  DROP CONSTRAINT processing_jobs_highlight_id_required;

ALTER TABLE public.processing_jobs
  ADD CONSTRAINT processing_jobs_highlight_id_required CHECK (
    (kind = 'enrich_highlight' AND highlight_id IS NOT NULL)
    OR (kind <> 'enrich_highlight' AND highlight_id IS NULL)
  );

-- Coverage set: one row per reading window we have requested nomination for, even
-- if it produced no candidates. UNIQUE(study_session_id, start_index, end_index)
-- makes the request idempotent — re-scrolling over a covered window inserts nothing
-- and so enqueues no duplicate job. start/end are segment indices (track-relative),
-- decoupled from the display layer.
CREATE TABLE public.nominated_windows (
  id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
  study_session_id UUID NOT NULL,
  start_index INTEGER NOT NULL,
  end_index INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT nominated_windows_pkey PRIMARY KEY (id),
  CONSTRAINT nominated_windows_study_session_id_fkey FOREIGN KEY (study_session_id)
    REFERENCES public.study_sessions (id) ON DELETE CASCADE,
  CONSTRAINT nominated_windows_status_check CHECK (status IN ('pending', 'done', 'failed')),
  CONSTRAINT nominated_windows_range_check CHECK (end_index >= start_index)
);

CREATE UNIQUE INDEX uq_nominated_windows_session_range
  ON public.nominated_windows (study_session_id, start_index, end_index);

ALTER TABLE public.nominated_windows ENABLE ROW LEVEL SECURITY;

-- LLM-nominated spans. char_start/char_end are character offsets into the segment's
-- stored text (already SRT-stripped at parse time), so they share the exact
-- coordinate space as highlights.start_offset/end_offset and the rendered word
-- spans — the reader's own selection can be compared against them directly.
-- dismissed_at is set when a ghost is adopted (swapped into a real highlight).
CREATE TABLE public.ghost_candidates (
  id UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
  study_session_id UUID NOT NULL,
  segment_id UUID NOT NULL,
  char_start INTEGER NOT NULL,
  char_end INTEGER NOT NULL,
  surface_form TEXT NOT NULL,
  dismissed_at TIMESTAMP WITH TIME ZONE NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT ghost_candidates_pkey PRIMARY KEY (id),
  CONSTRAINT ghost_candidates_study_session_id_fkey FOREIGN KEY (study_session_id)
    REFERENCES public.study_sessions (id) ON DELETE CASCADE,
  CONSTRAINT ghost_candidates_segment_id_fkey FOREIGN KEY (segment_id)
    REFERENCES public.text_segments (id) ON DELETE RESTRICT,
  CONSTRAINT ghost_candidates_range_check CHECK (char_end > char_start)
);

-- Read path: all live (non-dismissed) ghosts for a session, on each poll.
CREATE INDEX idx_ghost_candidates_session_live
  ON public.ghost_candidates (study_session_id)
  WHERE dismissed_at IS NULL;

ALTER TABLE public.ghost_candidates ENABLE ROW LEVEL SECURITY;
