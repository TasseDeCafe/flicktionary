-- =========================================================================
-- practice_rating_events: append-only rating-event log
--
-- One row per applied FSRS rating (flashcards AND reading-mode advances),
-- written in the same transaction as the FSRS column update so the log is a
-- trustworthy source of truth for the daily review budget:
--
--   reviewedToday = COUNT(DISTINCT user_lookup_id)
--                   WHERE pool = $pool AND was_introduction = false
--                     AND prev_srs_state IN ('new','review')
--                     AND reverted_at IS NULL
--                     AND rated_at within CURRENT_DATE
--
-- (learning/relearning-state ratings are exempt from the budget — intraday
-- follow-ups must never be stranded until tomorrow by a spent cap.)
--
-- The pre-rating snapshot columns (prev_srs_*) capture the rated pool's SRS
-- family AT RATING START so a future undo/re-rate can restore FSRS state.
-- Undo coverage, pool-aware via the `pool` column:
--   - was_introduction on a PASSIVE event -> undo clears srs_* +
--     added_to_practice_at (refunds the daily-new budget); on an ACTIVE event
--     -> clears active_srs_* only (added_to_practice_at is never stamped for
--     active introductions).
--   - caused_parking -> undo un-parks + zeroes the pool-prefixed rehab columns
--     (pre-rating parked/rehab values need no snapshot columns: the queue
--     excludes parked terms and parked no-op ratings don't log, so they are
--     constants NULL/0 at event time).
--   - prev_* -> restores the FSRS columns.
--   - reverted_at is the undo tombstone; budget counts exclude reverted rows
--     from day one.
--
-- No event is written for cap-refused introductions, parked no-ops, or
-- not-in-active-pool refusals — only applied ratings log.
--
-- rating is TEXT + CHECK, deliberately NOT an enum: the practice_rating enum
-- was dropped with the legacy session machinery (20260601131531) and the
-- contract's zod schema is the real boundary.
--
-- headword/sense are audit snapshots that survive renames (same rationale as
-- the dropped practice_ratings table). user_id carries no FK, matching that
-- table's convention; user_lookup_id cascades so a hard-deleted term takes
-- its history with it.
-- =========================================================================

CREATE TABLE public.practice_rating_events (
  id                  UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
  user_id             UUID NOT NULL,
  user_lookup_id      UUID NOT NULL,
  target_language     TEXT NOT NULL,
  pool                TEXT NOT NULL CHECK (pool IN ('passive', 'active')),
  rating              TEXT NOT NULL CHECK (rating IN ('again', 'hard', 'good', 'easy')),
  -- false = implicit 'good' applied on a reading-text advance.
  was_explicit        BOOLEAN NOT NULL,
  -- The term was state-NULL in this pool at rating time (this rating
  -- introduced it). Introductions consume the NEW budget, not the review one.
  was_introduction    BOOLEAN NOT NULL,
  -- This rating crossed the leech threshold and parked the term.
  caused_parking      BOOLEAN NOT NULL DEFAULT FALSE,
  -- Reading-mode context; NULL for flashcard ratings.
  practice_text_id    UUID NULL,
  headword            TEXT NOT NULL,
  sense               TEXT NOT NULL DEFAULT '',
  -- Pre-rating snapshot of the rated pool's SRS family (srs_* for passive,
  -- active_srs_* for active). All NULL for an introduction.
  prev_srs_state      public.srs_state NULL,
  prev_srs_due        TIMESTAMP WITH TIME ZONE NULL,
  prev_srs_stability  REAL NULL,
  prev_srs_difficulty REAL NULL,
  prev_srs_last_review TIMESTAMP WITH TIME ZONE NULL,
  prev_srs_reps       INT NULL,
  prev_srs_lapses     INT NULL,
  -- Task-6 undo tombstone. Reverted events stay (append-only) but leave every
  -- budget count.
  reverted_at         TIMESTAMP WITH TIME ZONE NULL,
  rated_at            TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT practice_rating_events_pkey PRIMARY KEY (id),
  CONSTRAINT practice_rating_events_lookup_fkey FOREIGN KEY (user_lookup_id)
    REFERENCES public.user_lookups (id) ON DELETE CASCADE,
  CONSTRAINT practice_rating_events_text_fkey FOREIGN KEY (practice_text_id)
    REFERENCES public.practice_texts (id) ON DELETE SET NULL
);

-- Daily review-budget count per (user, language, pool).
CREATE INDEX idx_practice_rating_events_budget
  ON public.practice_rating_events (user_id, target_language, pool, rated_at);

-- Future undo: latest events for a term, newest first.
CREATE INDEX idx_practice_rating_events_lookup
  ON public.practice_rating_events (user_lookup_id, rated_at DESC);

-- Service-role only (repo convention): RLS on, no policies.
ALTER TABLE public.practice_rating_events ENABLE ROW LEVEL SECURITY;
