-- =========================================================================
-- checkpoint_fold: French orthography fold + elision clitic strip.
--
-- French elision glues a clitic onto the next word with an apostrophe
-- (l'homme, j'arrive, jusqu'à) and the word segmenter keeps the pair as ONE
-- token, so without a strip the token l'homme could never match the lemma
-- homme. The fr branch, after the shared base fold:
--   1. curly → straight apostrophe (text uses ’, wiktionary lemmas use ')
--   2. œ→oe / æ→ae ligature unification (cœur / coeur)
--   3. strip exactly one leading elision clitic
--      (jusqu'|lorsqu'|puisqu'|quoiqu'|presqu'|qu'|c'|d'|j'|l'|m'|n'|s'|t')
-- Applied to BOTH sides of the match, so elided lemmas (s'appeler→appeler)
-- and elided tokens converge; interior apostrophes survive (aujourd'hui,
-- quelqu'un). regexp_replace without the 'g' flag replaces one match, and the
-- POSIX longest-match rule picks the qu-compounds over bare qu — same result
-- as the TS regex's ordered alternation.
--
-- The TS twin is foldCheckpointToken in
-- packages/core/src/utils/checkpoint-fold.ts — byte-for-byte equivalent,
-- enforced by the SQL-vs-TS parity test. Change both sides in lockstep.
--
-- The expression indexes precompute the fold per row, so they are reindexed.
-- Existing ru/en/de/es/pt rows fold identically before and after (the fr
-- branch is new); the REINDEX exists so the indexes are provably built with
-- the current function. wiktionary_form_redirects.folded_form is rebuilt by
-- every loader run, and the French load has to run after this migration
-- anyway, so no rebuild here.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.checkpoint_fold(input text, lang text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE lang
    WHEN 'ru' THEN replace(base.folded, 'ё', 'е')
    WHEN 'de' THEN replace(base.folded, 'ß', 'ss')
    WHEN 'fr' THEN regexp_replace(
      replace(replace(replace(base.folded, '’', ''''), 'œ', 'oe'), 'æ', 'ae'),
      '^(jusqu|lorsqu|puisqu|quoiqu|presqu|qu|[cdjlmnst])''',
      ''
    )
    ELSE base.folded
  END
  FROM (
    SELECT lower(trim(regexp_replace(normalize(input, NFC), U&'\0301', '', 'g'))) AS folded
  ) AS base
$$;

REINDEX INDEX public.idx_wiktionary_forms_checkpoint_fold;
REINDEX INDEX public.idx_wiktionary_entries_checkpoint_fold;
