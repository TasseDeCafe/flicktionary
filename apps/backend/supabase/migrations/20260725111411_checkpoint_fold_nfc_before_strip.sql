-- =========================================================================
-- checkpoint_fold: NFC-compose BEFORE stripping combining acute U+0301.
--
-- The fold's U+0301 strip targets Russian stress marks (Cyrillic has no
-- precomposed accented letters, so a stress mark can only exist as a
-- combining acute — NFC never absorbs it). But languages whose orthography
-- uses the acute (es/pt/fr/vi/…, and English loanwords like café) CAN carry
-- it decomposed: with the old strip-first order, NFD `más` lost its accent
-- and folded to the different word `mas`. NFC-first composes those into
-- their precomposed forms so the strip only ever removes marks with no
-- precomposed form — i.e. genuine stress marks.
--
-- The TS twin is foldCheckpointToken in
-- packages/core/src/utils/checkpoint-fold.ts — byte-for-byte equivalent,
-- enforced by the SQL-vs-TS parity test. Change both sides in lockstep.
--
-- The two expression indexes precompute the fold per row, so they are
-- reindexed here. Stored wiktionary data is NFC in practice (kaikki emits
-- precomposed text), so old and new fold outputs agree on existing rows —
-- the REINDEX exists so the indexes are provably built with the current
-- function, not because values are expected to change. Same reasoning for
-- wiktionary_form_redirects.folded_form: its stored values are computed
-- from NFC kaikki data and rebuilt on every loader run, so no rebuild here.
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
    ELSE base.folded
  END
  FROM (
    SELECT lower(trim(regexp_replace(normalize(input, NFC), U&'\0301', '', 'g'))) AS folded
  ) AS base
$$;

REINDEX INDEX public.idx_wiktionary_forms_checkpoint_fold;
REINDEX INDEX public.idx_wiktionary_entries_checkpoint_fold;
