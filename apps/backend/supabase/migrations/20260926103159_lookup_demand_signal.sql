-- =========================================================================
-- Lookup demand signal (#475, docs/proposals/book-aware-new-term-priority.md
-- "#475 B"). Repeated explicit gloss lookups of a word count as revealed
-- demand, like a re-save, so rare words that keep coming back reach tier 1.
--
-- lemma_lookups — one row per (user, language, folded lemma): collapsed
-- lookup episodes (a bump within an hour of the last one is the same
-- episode). credited_count is the watermark of episodes already folded into
-- some saved term's encounter_count, so crediting at save time is idempotent
-- across enrichment retries and re-saves.
--
-- user_lookups.last_demand_at — the collapse clock for explicit demand
-- (saves, lesson confirms, lookups). It is separate from last_encountered_at,
-- which checkpoint content encounters also bump: sharing that clock made a
-- lookup or re-save within an hour of a checkpoint collapse silently.
-- Defaults to NOW() because creation is the first demand episode.
--
-- user_headword_lemma_keys — SQL twin of foldUserHeadwordCandidates
-- (packages/core/src/utils/checkpoint-fold.ts): a saved headword's folded
-- lemma keys (en `to `, de `sich `, fr `se `, es/pt reflexive strips).
-- Enforced by the SQL-vs-TS parity test; change both sides in lockstep.
-- =========================================================================

CREATE TABLE public.lemma_lookups (
  user_id UUID NOT NULL,
  target_language TEXT NOT NULL,
  lemma TEXT NOT NULL,
  lookup_count INT NOT NULL DEFAULT 1,
  credited_count INT NOT NULL DEFAULT 0,
  last_looked_up_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lemma_lookups_pkey PRIMARY KEY (user_id, target_language, lemma),
  CONSTRAINT lemma_lookups_user_id_fkey FOREIGN KEY (user_id)
    REFERENCES auth.users (id) ON DELETE CASCADE,
  CONSTRAINT lemma_lookups_counts_check CHECK (lookup_count > 0 AND credited_count >= 0 AND credited_count <= lookup_count)
);

ALTER TABLE public.lemma_lookups ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.user_lookups
  ADD COLUMN last_demand_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE public.user_lookups SET last_demand_at = last_encountered_at;

CREATE FUNCTION public.user_headword_lemma_keys(headword text, lang text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY(
    SELECT DISTINCT key
    FROM (
      VALUES
        (f.folded),
        (CASE WHEN lang = 'en' AND f.folded LIKE 'to %' THEN substr(f.folded, 4) END),
        (CASE WHEN lang = 'de' AND f.folded LIKE 'sich %' THEN substr(f.folded, 6) END),
        (CASE WHEN lang = 'fr' AND f.folded LIKE 'se %' THEN substr(f.folded, 4) END),
        (CASE WHEN lang = 'es' AND f.folded ~ '(arse|erse|irse)$' THEN left(f.folded, -2) END),
        (CASE WHEN lang = 'pt' AND f.folded LIKE '%-se' AND length(f.folded) > 3 THEN left(f.folded, -3) END)
    ) AS keys(key)
    WHERE key IS NOT NULL AND key <> ''
    ORDER BY key
  )
  FROM (SELECT public.checkpoint_fold(headword, lang) AS folded) AS f
$$;
