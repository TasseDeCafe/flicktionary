-- =========================================================================
-- Word-family insights: the LLM layer over the reader's word-family line
-- (docs/proposals/word-family-hints.md, v2). Generated lazily on the first
-- tap of a lemma and shared by every user, so each lemma is paid for once.
--
-- word_family_insights — one row per (target_language, lemma, lemma_pos), the
-- native-language-independent half:
--   parts            — the learner-facing breakdown [{text, isAffix}], in
--                      order; [] when the word has no breakdown a learner can
--                      use (opaque roots).
--   missing_parents  — folded lemmas the word derives from that the kaikki
--                      edges lack (ожог ← жечь); each one was checked to be a
--                      real kaikki lemma before it was stored.
--   hidden_ancestors — folded kaikki ancestors a learner can't see in the
--                      word (понимать ← иметь); they never become anchors.
--
-- word_family_insight_explanations — per explanation language (the native
-- language, or the target language for translations-off learners): what each part
-- contributes in THIS word (aligned with parts by index) and cognates in that
-- language (none when it is the target language).
--
-- Lemmas are checkpoint_fold-folded, like wiktionary_word_family_edges.
-- Backend reads/writes only — RLS enabled with no policies.
-- =========================================================================

CREATE TABLE public.word_family_insights (
  target_language TEXT NOT NULL,
  lemma TEXT NOT NULL,
  lemma_pos TEXT NOT NULL,
  parts JSONB NOT NULL,
  missing_parents TEXT[] NOT NULL DEFAULT '{}',
  hidden_ancestors TEXT[] NOT NULL DEFAULT '{}',
  model TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT word_family_insights_pkey PRIMARY KEY (target_language, lemma, lemma_pos)
);

ALTER TABLE public.word_family_insights ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.word_family_insight_explanations (
  target_language TEXT NOT NULL,
  lemma TEXT NOT NULL,
  lemma_pos TEXT NOT NULL,
  explanation_language TEXT NOT NULL,
  part_meanings JSONB NOT NULL,
  cognates JSONB NOT NULL,
  model TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT word_family_insight_explanations_pkey PRIMARY KEY (target_language, lemma, lemma_pos, explanation_language),
  CONSTRAINT word_family_insight_explanations_insight_fkey FOREIGN KEY (target_language, lemma, lemma_pos)
    REFERENCES public.word_family_insights (target_language, lemma, lemma_pos) ON DELETE CASCADE
);

ALTER TABLE public.word_family_insight_explanations ENABLE ROW LEVEL SECURITY;
