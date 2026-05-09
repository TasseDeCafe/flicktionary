import type { GrammarPatch } from './extract'

// Kaikki wins on every field where it has a value; LLM keeps the field where
// kaikki is silent. Undefined kaikki keys are skipped (so we don't blow away
// a populated LLM value with an absence).
//
// Returned object is a *patch* — the patch the caller will pass to
// userLookupsRepository.updateContent's `grammarPatch`, which the SQL layer
// shallow-merges into the existing JSONB. We don't reach into existing LLM
// content here on purpose; the caller knows whether merge-with-existing is
// what's wanted.
export const buildGrammarPatchFromKaikki = (kaikki: GrammarPatch): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(kaikki)) {
    if (value === undefined || value === null) continue
    out[key] = value
  }
  return out
}
