import type postgres from 'postgres'
import { sql } from '../postgres-client'

// Explicit gloss lookups as a new-term demand signal (docs/SRS.md §4,
// "revealed demand"). One row per (user, language, folded lemma) holds
// collapsed lookup episodes; credited_count is the watermark of episodes
// already folded into a saved term's encounter_count, which is what makes
// crediting idempotent across enrichment retries and re-saves.

// Same collapse window as recordEncounter: re-tapping a word several times in
// one reading session is one episode.
const recordLookupEpisode = async (
  params: { userId: string; targetLanguage: string; lemmas: readonly string[] },
  executor: postgres.Sql = sql
): Promise<string[]> => {
  if (params.lemmas.length === 0) return []
  const rows = (await executor`
    INSERT INTO public.lemma_lookups (user_id, target_language, lemma)
    SELECT ${params.userId}, ${params.targetLanguage}, lemma
    FROM unnest(${executor.array([...params.lemmas])}::text[]) AS t(lemma)
    ON CONFLICT (user_id, target_language, lemma) DO UPDATE
      SET lookup_count = lemma_lookups.lookup_count + 1,
          last_looked_up_at = NOW()
      WHERE lemma_lookups.last_looked_up_at < NOW() - INTERVAL '1 hour'
    RETURNING lemma
  `) as Array<{ lemma: string }>
  return rows.map((row) => row.lemma)
}

// The lookup was credited to an existing term directly (recordLookup →
// recordEncounter), so no later save may count those episodes again.
const markCredited = async (
  params: { userId: string; targetLanguage: string; lemmas: readonly string[] },
  executor: postgres.Sql = sql
): Promise<void> => {
  if (params.lemmas.length === 0) return
  await executor`
    UPDATE public.lemma_lookups
    SET credited_count = lookup_count
    WHERE user_id = ${params.userId}
      AND target_language = ${params.targetLanguage}
      AND lemma = ANY(${executor.array([...params.lemmas])}::text[])
  `
}

// Save-time crediting: fold each term's uncredited lookup episodes into its
// encounter_count, then advance the watermark on every matched key. The
// credit is the max over the term's lemma keys (user_headword_lemma_keys —
// the reflexive strips are liberal, so summing would double-count), minus
// the latest episode when it sits inside the collapse window: that lookup is
// the one that led to this save, which the save itself already counts. Rows
// are locked so a concurrent save of the same lemma can't credit the same
// episodes twice.
const creditLookupDemand = async (userLookupIds: readonly string[], executor: postgres.Sql = sql): Promise<void> => {
  if (userLookupIds.length === 0) return
  await executor`
    WITH terms AS (
      SELECT id, user_id, target_language,
        public.user_headword_lemma_keys(headword, target_language) AS keys
      FROM public.user_lookups
      WHERE id = ANY(${executor.array([...userLookupIds])}::uuid[])
        AND count > 0 AND deleted_at IS NULL
    ),
    locked AS (
      SELECT t.id AS term_id, ll.user_id, ll.target_language, ll.lemma,
        GREATEST(
          ll.lookup_count - ll.credited_count
            - CASE WHEN ll.last_looked_up_at > NOW() - INTERVAL '1 hour' THEN 1 ELSE 0 END,
          0
        ) AS uncredited
      FROM public.lemma_lookups ll
      JOIN terms t
        ON ll.user_id = t.user_id
        AND ll.target_language = t.target_language
        AND ll.lemma = ANY(t.keys)
      WHERE ll.lookup_count > ll.credited_count
      FOR UPDATE OF ll
    ),
    credits AS (
      SELECT term_id, MAX(uncredited) AS credit FROM locked GROUP BY term_id
    ),
    bumped AS (
      UPDATE public.user_lookups ul
      SET encounter_count = ul.encounter_count + c.credit
      FROM credits c
      WHERE ul.id = c.term_id AND c.credit > 0
      RETURNING ul.id
    )
    UPDATE public.lemma_lookups ll
    SET credited_count = ll.lookup_count
    FROM locked l
    WHERE ll.user_id = l.user_id AND ll.target_language = l.target_language AND ll.lemma = l.lemma
  `
}

export interface LemmaLookupsRepositoryInterface {
  recordLookupEpisode: (
    params: { userId: string; targetLanguage: string; lemmas: readonly string[] },
    executor?: postgres.Sql
  ) => Promise<string[]>
  markCredited: (
    params: { userId: string; targetLanguage: string; lemmas: readonly string[] },
    executor?: postgres.Sql
  ) => Promise<void>
  creditLookupDemand: (userLookupIds: readonly string[], executor?: postgres.Sql) => Promise<void>
}

export const LemmaLookupsRepository = (): LemmaLookupsRepositoryInterface => {
  return {
    recordLookupEpisode,
    markCredited,
    creditLookupDemand,
  }
}
