-- =========================================================================
-- coverage_snapshots + known_lemmas.sweep_batch_id — phase 3 of the
-- checkpoint-reviews rollout (docs/proposals/checkpoint-reviews-and-known-
-- vocabulary.md, rollout item 3).
--
-- coverage_snapshots: one row per (user, language, UTC day) recording the
-- whole-language coverage stat at compute time. Written lazily by the
-- coverage read (fire-and-forget upsert; same-day recomputes update the
-- row) so a future progress-over-time chart has history that a lemma_ranks
-- rebuild can never retroactively rewrite — the % is pinned to the
-- build_version it was computed against. No chart UI exists yet; this is
-- history-collection only. Backend-only (RLS enabled, no policies).
--
-- coverage_pct is the binary blended token-mass headline (studied ∪ known
-- count as P=1); verified_pct is the share backed by ≥1 live successful
-- explicit-or-checkpoint meaning review (never the known-assertion lane).
--
-- known_lemmas.sweep_batch_id: sweep-exact undo handle — every
-- mark-remaining-known press stamps one fresh uuid on the rows IT inserts.
-- Progressive sweeps of one session share source_id but not batch id, and
-- ON CONFLICT DO NOTHING means a batch only ever owns rows it actually
-- created — so delete-by-batch is exactly "undo that press", while
-- delete-by-source stays the session-wide correction. NULL on rows created
-- before this column (and on non-sweep sources).
-- =========================================================================

CREATE TABLE public.coverage_snapshots (
  user_id UUID NOT NULL,
  target_language TEXT NOT NULL,
  day DATE NOT NULL,
  build_version INT NOT NULL,
  denominator INT NOT NULL,
  studied_count INT NOT NULL,
  known_count INT NOT NULL,
  mwe_count INT NOT NULL,
  coverage_pct DOUBLE PRECISION NOT NULL,
  verified_pct DOUBLE PRECISION NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT coverage_snapshots_pkey PRIMARY KEY (user_id, target_language, day),
  CONSTRAINT coverage_snapshots_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users (id) ON DELETE CASCADE
);

ALTER TABLE public.coverage_snapshots ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.known_lemmas ADD COLUMN sweep_batch_id UUID NULL;
