-- Constraints + dedup indexes for the seed_card_chat job kind, plus the
-- card-chat idempotency columns. Runs after the enum value has committed (see
-- 20260525140000) so 'seed_card_chat' can be referenced as a literal here.

-- 1. A seed_card_chat job reuses the highlight_id column (it answers a specific
-- highlight's note). Widen the kind/identity check: enrich_highlight and
-- seed_card_chat both carry a highlight_id; every other kind leaves it NULL.
ALTER TABLE public.processing_jobs
  DROP CONSTRAINT processing_jobs_highlight_id_required;

ALTER TABLE public.processing_jobs
  ADD CONSTRAINT processing_jobs_highlight_id_required CHECK (
    (kind IN ('enrich_highlight', 'seed_card_chat') AND highlight_id IS NOT NULL)
    OR (kind NOT IN ('enrich_highlight', 'seed_card_chat') AND highlight_id IS NULL)
  );

-- 2. The live-enrich uniqueness index was on (highlight_id) regardless of kind.
-- Now that seed jobs also carry highlight_id, a fresh highlight's pending
-- enrich_highlight job would collide with its seed_card_chat job. Rescope the
-- index to enrich_highlight only.
DROP INDEX public.uq_processing_jobs_live_enrich;

CREATE UNIQUE INDEX uq_processing_jobs_live_enrich
  ON public.processing_jobs (highlight_id)
  WHERE kind = 'enrich_highlight' AND highlight_id IS NOT NULL AND status IN ('pending', 'processing');

-- 3. Coalesce rapid Saves while a seed answer has not started yet: at most one
-- PENDING seed job per highlight. Scoped to status = 'pending' only (not
-- 'processing') on purpose — a Save that lands while an earlier answer is
-- already being generated should enqueue a fresh follow-up turn, not vanish.
CREATE UNIQUE INDEX uq_processing_jobs_live_seed_card_chat
  ON public.processing_jobs (highlight_id)
  WHERE kind = 'seed_card_chat' AND highlight_id IS NOT NULL AND status = 'pending';

-- 4. Card-chat idempotency. A seeded turn is produced by a background worker that
-- may retry after a partial insert (crash between inserting messages and
-- markDone). source marks how a row was created; source_turn_key is a
-- deterministic key per seed run (seed_card_chat:<job.id>). The unique index
-- includes role because a seeded turn stores two rows (one user, one assistant)
-- under the same key. Manual chat rows leave both columns NULL.
ALTER TABLE public.card_chat_messages
  ADD COLUMN source TEXT NULL,
  ADD COLUMN source_turn_key TEXT NULL;

CREATE UNIQUE INDEX uq_card_chat_messages_source_turn
  ON public.card_chat_messages (card_id, source_turn_key, role)
  WHERE source_turn_key IS NOT NULL;
