import { sql } from '../postgres-client'

// Checkpoint-review lemma resolution over the loaded kaikki tables (see
// docs/proposals/checkpoint-reviews-and-known-vocabulary.md). Both sides of
// every comparison are folded through checkpoint_fold — the SQL twin of
// packages/core/src/utils/checkpoint-fold.ts — and the callers pass tokens
// already folded by the TS side. Kept separate from
// wiktionary-entries-repository.ts: that one serves grounding (row-per-lookup
// reads of the verbatim kaikki data); this one only maps folded tokens to
// folded lemma strings in batch.

// Resolves each folded token to the set of folded real-lemma headwords it can
// belong to, via three arms:
//   (a) inflected form: wiktionary_forms → real-lemma entry
//   (b) direct hit: the token IS a real-lemma headword
//   (c) precomputed stub redirects (form-of / alt-of chains, ≤2 hops)
// Ambiguous forms return ALL candidate lemmas — the checkpoint matcher
// credits every saved candidate rather than guessing which lemma the token
// realized. Tokens with no match are absent from the map.
export type ResolveFoldedLemmasParams = {
  targetLanguage: string
  foldedTokens: readonly string[]
}

const resolveFoldedLemmasForTokens = async (params: ResolveFoldedLemmasParams): Promise<Map<string, Set<string>>> => {
  const result = new Map<string, Set<string>>()
  if (params.foldedTokens.length === 0) return result

  const tokens = [...new Set(params.foldedTokens)]
  const rows = (await sql`
    SELECT
      checkpoint_fold(f.form, f.target_language) AS folded_token,
      checkpoint_fold(e.headword, e.target_language) AS folded_lemma
    FROM public.wiktionary_forms f
    JOIN public.wiktionary_entries e ON e.id = f.entry_id
    WHERE f.target_language = ${params.targetLanguage}
      AND checkpoint_fold(f.form, f.target_language) = ANY(${tokens})
      AND e.data ? 'head_templates'
      AND NOT (e.data->'senses'->0 ? 'form_of')
      AND NOT (e.data->'senses'->0 ? 'alt_of')
    UNION
    SELECT
      checkpoint_fold(e.headword, e.target_language) AS folded_token,
      checkpoint_fold(e.headword, e.target_language) AS folded_lemma
    FROM public.wiktionary_entries e
    WHERE e.target_language = ${params.targetLanguage}
      AND checkpoint_fold(e.headword, e.target_language) = ANY(${tokens})
      AND e.data ? 'head_templates'
      AND NOT (e.data->'senses'->0 ? 'form_of')
      AND NOT (e.data->'senses'->0 ? 'alt_of')
    UNION
    SELECT
      r.folded_form AS folded_token,
      checkpoint_fold(r.lemma, r.target_language) AS folded_lemma
    FROM public.wiktionary_form_redirects r
    WHERE r.target_language = ${params.targetLanguage}
      AND r.folded_form = ANY(${tokens})
  `) as Array<{ folded_token: string; folded_lemma: string }>

  for (const row of rows) {
    const existing = result.get(row.folded_token)
    if (existing) {
      existing.add(row.folded_lemma)
    } else {
      result.set(row.folded_token, new Set([row.folded_lemma]))
    }
  }
  return result
}

export interface WiktionaryMatchRepositoryInterface {
  resolveFoldedLemmasForTokens: (params: ResolveFoldedLemmasParams) => Promise<Map<string, Set<string>>>
}

export const WiktionaryMatchRepository = (): WiktionaryMatchRepositoryInterface => {
  return {
    resolveFoldedLemmasForTokens,
  }
}
