-- =========================================================================
-- Checkpoint-review matching foundation (see
-- docs/proposals/checkpoint-reviews-and-known-vocabulary.md).
--
-- checkpoint_fold(input, lang) is the shared token/lemma fold applied to BOTH
-- sides of every checkpoint match (content tokens at query time, wiktionary
-- forms/headwords via the expression indexes below): strip combining acute
-- U+0301 → NFC → trim → lower, then per-language orthography folds (ru ё→е,
-- de ß→ss). Because both sides fold, ё/е spellings match in both directions.
--
-- The TS twin is packages/core/src/utils/checkpoint-fold.ts — the two
-- implementations MUST stay byte-for-byte equivalent (same discipline as
-- normalizeTargetForm); a parity test compares them over shared vectors.
-- =========================================================================

CREATE FUNCTION public.checkpoint_fold(input text, lang text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE lang
    WHEN 'ru' THEN replace(base.folded, 'ё', 'е')
    WHEN 'de' THEN replace(base.folded, 'ß', 'ss')
    ELSE base.folded
  END
  FROM (
    SELECT lower(trim(normalize(regexp_replace(input, U&'\0301', '', 'g'), NFC))) AS folded
  ) AS base
$$;

-- Folded point-lookup indexes for the checkpoint matcher. The loader
-- (apps/backend/scripts/load-kaikki.ts) TRUNCATEs and reloads these tables;
-- plain indexes survive that and rebuild during COPY.
CREATE INDEX idx_wiktionary_forms_checkpoint_fold
  ON public.wiktionary_forms (target_language, public.checkpoint_fold(form, target_language));

CREATE INDEX idx_wiktionary_entries_checkpoint_fold
  ON public.wiktionary_entries (target_language, public.checkpoint_fold(headword, target_language));

-- =========================================================================
-- wiktionary_form_redirects — precomputed resolution of kaikki stub entries
-- (form-of / alt-of pseudo-entries) to their final real lemma, followed up to
-- 2 hops (de "dies" → alt-of "dieses" → form-of "dieser"). Rows exist ONLY
-- when the final target is a real lemma; dead-end chains are dropped.
--
-- Built by apps/backend/scripts/build-wiktionary-redirects.ts, which runs
-- automatically at the end of load-kaikki.ts (the loader truncates/reloads
-- the source tables, so the redirects rebuild in the same lifecycle).
-- Backend reads only — RLS enabled with no policies, same posture as the
-- other wiktionary tables.
-- =========================================================================

CREATE TABLE public.wiktionary_form_redirects (
  target_language TEXT NOT NULL,
  folded_form TEXT NOT NULL,
  lemma TEXT NOT NULL,
  CONSTRAINT wiktionary_form_redirects_pkey PRIMARY KEY (target_language, folded_form, lemma)
);

ALTER TABLE public.wiktionary_form_redirects ENABLE ROW LEVEL SECURITY;
