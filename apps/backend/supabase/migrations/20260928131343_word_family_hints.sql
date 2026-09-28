-- =========================================================================
-- wiktionary_word_family_edges — precomputed word-family graph over the kaikki
-- entries, backing the reader gloss sheet's word-family line and its
-- guess-before-reveal hold (docs/proposals/word-family-hints.md).
--
-- One row per (entry, relative) link, both sides checkpoint_fold-folded so
-- they join straight against known_lemmas / user_headword_lemma_keys:
--   kind 'ancestor' — the entry derives from `relative` through form-of
--                     (participle / gerund / passive / verbal-noun senses) or
--                     structural etymology templates (af, surf, prefix, …),
--                     followed transitively up to depth 3.
--   kind 'related'  — `relative` appears in the entry's related/derived lists
--                     and shares a stem with it (depth is always 1).
-- Relatives are content words only (real noun/verb/adj/adv lemmas of at least
-- 3 letters); affixes never appear as relatives. The reverse index on
-- `relative` answers "which other words share this ancestor" (shared roots).
--
-- Built by apps/backend/scripts/build-word-family.ts, which runs at the end of
-- load-kaikki.ts for the word-family languages. Backend reads only — RLS
-- enabled with no policies, same posture as the other wiktionary tables.
-- =========================================================================

CREATE TABLE public.wiktionary_word_family_edges (
  target_language TEXT NOT NULL,
  lemma TEXT NOT NULL,
  lemma_pos TEXT NOT NULL,
  relative TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ancestor', 'related')),
  depth SMALLINT NOT NULL CHECK (depth BETWEEN 1 AND 3),
  CONSTRAINT wiktionary_word_family_edges_pkey PRIMARY KEY (target_language, lemma, lemma_pos, relative, kind)
);

CREATE INDEX idx_wiktionary_word_family_edges_relative
  ON public.wiktionary_word_family_edges (target_language, relative);

ALTER TABLE public.wiktionary_word_family_edges ENABLE ROW LEVEL SECURITY;

-- Per-language switch for the reader's word-family line + guess-first hold.
-- Default on; only offered for the word-family languages.
ALTER TABLE public.user_target_language_prefs
  ADD COLUMN word_family_hints_enabled BOOLEAN NOT NULL DEFAULT TRUE;
