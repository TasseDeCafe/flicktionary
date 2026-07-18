-- =========================================================================
-- Checkpoint reviews (docs/proposals/checkpoint-reviews-and-known-vocabulary.md,
-- rollout phase 1): an explicit "I've followed up to here" press credits
-- implicit good ratings to saved due terms in the newly-read span.
-- =========================================================================

-- Monotonic reviewed-up-to pointer, parallel to furthest_read_segment_index
-- (which stays a pure scroll tracker). NULL = the session has never been
-- checkpointed. Each press credits only the span (reviewed_until, new point].
ALTER TABLE public.study_sessions
  ADD COLUMN reviewed_until_segment_index INTEGER NULL;

-- One row per checkpoint press. The row is the batch-undo handle (rating
-- events reference it via checkpoint_id) and carries the server-authoritative
-- backlog claim set for the known-assertion follow-up action.
CREATE TABLE public.study_session_checkpoints (
  id                    UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
  user_id               UUID NOT NULL,
  study_session_id      UUID NOT NULL,
  -- The reviewed_until pointer BEFORE this press; NULL = the pointer was NULL
  -- (undo restores NULL, not -1).
  from_segment_index    INTEGER NULL,
  to_segment_index      INTEGER NOT NULL,
  credited_count        INTEGER NOT NULL,
  -- user_lookup ids offered as backlog known-assertion candidates for THIS
  -- checkpoint. assert-known verifies membership here, so a client can never
  -- assert arbitrary ids.
  backlog_candidate_ids UUID[] NOT NULL DEFAULT '{}',
  created_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  reverted_at           TIMESTAMP WITH TIME ZONE NULL,
  CONSTRAINT study_session_checkpoints_pkey PRIMARY KEY (id),
  CONSTRAINT study_session_checkpoints_session_fkey FOREIGN KEY (study_session_id)
    REFERENCES public.study_sessions (id) ON DELETE CASCADE
);

-- Latest-live lookup per session (undo verifies "is this the latest live
-- checkpoint" before reverting).
CREATE INDEX idx_study_session_checkpoints_session
  ON public.study_session_checkpoints (study_session_id, created_at DESC);

-- Service-role only (repo convention): RLS on, no policies.
ALTER TABLE public.study_session_checkpoints ENABLE ROW LEVEL SECURITY;

-- Checkpoint provenance on rating events. study_session_id records where the
-- implicit credit came from (decision 4 — same pattern as practice_text_id /
-- import_batch_id); checkpoint_id is the batch-undo handle. import_batch_id
-- stays NULL on checkpoint credits, so they count toward the daily review
-- budget (completed review work replaces that day's flashcard load).
ALTER TABLE public.practice_rating_events
  ADD COLUMN study_session_id UUID NULL,
  ADD COLUMN checkpoint_id UUID NULL,
  ADD CONSTRAINT practice_rating_events_study_session_id_fkey FOREIGN KEY (study_session_id)
    REFERENCES public.study_sessions (id) ON DELETE SET NULL,
  ADD CONSTRAINT practice_rating_events_checkpoint_id_fkey FOREIGN KEY (checkpoint_id)
    REFERENCES public.study_session_checkpoints (id) ON DELETE SET NULL;

-- Batch undo lists a checkpoint's live events by checkpoint_id.
CREATE INDEX idx_practice_rating_events_checkpoint
  ON public.practice_rating_events (checkpoint_id)
  WHERE checkpoint_id IS NOT NULL;

-- Cheap aggregate evidence of a term passing in real content (decision 8).
-- recordContentEncounter bumps these (plus last_encountered_at, so the 90-day
-- new-term decay never shelves a term the user just read) but NEVER
-- encounter_count — tier-1 "revealed demand" stays reserved for deliberate
-- re-saves. No per-occurrence event log.
ALTER TABLE public.user_lookups
  ADD COLUMN content_encounter_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN last_content_encounter_at TIMESTAMP WITH TIME ZONE NULL;
