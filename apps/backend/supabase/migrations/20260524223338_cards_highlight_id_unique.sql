-- Idempotent card creation for the background per-highlight enrichment worker.
--
-- The worker retries on transient failure and the enrichment path may be
-- re-entered (e.g. a residual discovery run + an enrich job), so a single
-- highlight must never produce two cards. `cards.highlight_id` previously had
-- no uniqueness guard and inserts were plain INSERTs. A partial unique index
-- (NULL highlight_ids are LLM-discovered cards and must stay un-constrained)
-- lets the repository upsert with ON CONFLICT ... DO NOTHING.

CREATE UNIQUE INDEX cards_highlight_id_unique
  ON public.cards (highlight_id)
  WHERE highlight_id IS NOT NULL;
