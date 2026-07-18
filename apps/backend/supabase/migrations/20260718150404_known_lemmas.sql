-- =========================================================================
-- known_lemmas — the stateless known-vocabulary assertion layer
-- (docs/proposals/vocab-coverage-visualization.md, decisions pinned in
-- docs/proposals/checkpoint-reviews-and-known-vocabulary.md Feature 2). One
-- row = "the user claims to know this lemma": no facets, no FSRS state, no
-- history — that statelessness is what keeps every correction path a trivial
-- write. `lemma` is checkpoint_fold-folded (the canonical lemma key).
--
-- Precedence is read-time, never write-time: a live saved lookup always wins
-- over a known mark (saving a marked-known word is the correction signal),
-- and rows are never deleted on save — the lemma key is sense-blind, so
-- marking one sense known stays true when another sense is saved.
--
-- Provenance is single-source: one row remembers the FIRST source that
-- claimed it (ON CONFLICT DO NOTHING); overlapping sweeps make the later
-- source's bulk un-mark best-effort — accepted tradeoff.
--
-- Consumers: the difficulty/coverage reads and the gloss-sheet chip ONLY.
-- Ghost nominations must never read this table (suppressed suggestions are
-- invisible errors; coverage miscounts are visible ones).
-- =========================================================================

CREATE TABLE public.known_lemmas (
  user_id UUID NOT NULL,
  target_language TEXT NOT NULL,
  lemma TEXT NOT NULL,
  source TEXT NOT NULL,
  source_id UUID NULL,
  marked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT known_lemmas_pkey PRIMARY KEY (user_id, target_language, lemma),
  CONSTRAINT known_lemmas_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users (id) ON DELETE CASCADE
);

ALTER TABLE public.known_lemmas ENABLE ROW LEVEL SECURITY;
