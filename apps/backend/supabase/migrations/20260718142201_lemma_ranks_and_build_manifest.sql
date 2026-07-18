-- =========================================================================
-- lemma_ranks — the per-language frequency-ranked lemma list backing the
-- personalized difficulty stat and (later) the vocabulary coverage grid
-- (docs/proposals/vocab-coverage-visualization.md,
-- docs/proposals/checkpoint-reviews-and-known-vocabulary.md Feature 3).
--
-- Built offline by apps/backend/scripts/build-lemma-ranks.ts (wordfreq
-- surface frequencies × the loaded kaikki tables). `lemma` stores the
-- checkpoint_fold-folded form — the canonical lemma key shared with the
-- runtime matcher, so user-side lemmas join by string equality with no
-- re-folding. Backend reads only — RLS enabled with no policies, same
-- posture as the wiktionary reference tables.
-- =========================================================================

CREATE TABLE public.lemma_ranks (
  target_language TEXT NOT NULL,
  lemma TEXT NOT NULL,
  rank INT NOT NULL,
  freq_mass DOUBLE PRECISION NOT NULL,
  CONSTRAINT lemma_ranks_pkey PRIMARY KEY (target_language, lemma)
);

CREATE INDEX idx_lemma_ranks_language_rank
  ON public.lemma_ranks (target_language, rank);

ALTER TABLE public.lemma_ranks ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- lemma_rank_builds — one manifest row per language, upserted inside the
-- same transaction as each successful build (per-language DELETE + insert;
-- the build is atomic per language). The manifest row is the "supported"
-- gate for difficulty: KAIKKI membership alone would report supported
-- against an empty ranks table between deploy and the one-off prod build.
-- It also makes data swaps explicit, versioned events (proposal decision
-- 21) and records the acceptance metrics the build script enforces.
-- =========================================================================

CREATE TABLE public.lemma_rank_builds (
  target_language TEXT NOT NULL,
  version INT NOT NULL,
  built_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  wordfreq_version TEXT NOT NULL,
  row_count INT NOT NULL,
  mass_matched_pct DOUBLE PRECISION NOT NULL,
  CONSTRAINT lemma_rank_builds_pkey PRIMARY KEY (target_language)
);

ALTER TABLE public.lemma_rank_builds ENABLE ROW LEVEL SECURITY;
