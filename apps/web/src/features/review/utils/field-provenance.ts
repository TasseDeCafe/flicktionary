import { KAIKKI_LANGUAGES, type GrammarFieldKey } from '@flicktionary/core/constants/language-grammar'

// Per-field provenance, computed at render by comparing the live value against
// a stored source snapshot (user_lookups.grounding_patch for citation grammar,
// study_facets.generated_payload for form facets). No per-field edit stamps
// exist anywhere — reverting an edit restores the source state automatically.
export type FieldProvenance =
  | { state: 'wiktionary' }
  | { state: 'edited'; sourceValue: unknown; sourceKind: 'wiktionary' | 'generated' }
  // IPA-only warning: the one field where a hallucinated value is both likely
  // and undetectable by the learner (you'd drill a wrong transcription as
  // truth). Other LLM fields fail visibly in normal use, so they stay 'llm'.
  | { state: 'unverified' }
  // The unmarked default — render nothing.
  | { state: 'llm' }

// "Absent" collapses null / undefined / blank string / empty array / objects
// whose every value is absent. Grounding writes only the keys kaikki had, the
// generate pass conditionally omits keys, and the grammar editors drop cleared
// keys — so absent-vs-absent must compare equal or untouched fields would show
// phantom "edited" pencils.
const isAbsent = (v: unknown): boolean => {
  if (v === null || v === undefined) return true
  if (typeof v === 'string') return v.trim().length === 0
  if (Array.isArray(v)) return v.length === 0
  if (typeof v === 'object') return Object.values(v as Record<string, unknown>).every(isAbsent)
  return false
}

export const deepEqualNormalized = (a: unknown, b: unknown): boolean => {
  const aAbsent = isAbsent(a)
  const bAbsent = isAbsent(b)
  if (aAbsent || bAbsent) return aAbsent === bAbsent
  if (typeof a === 'string' && typeof b === 'string') return a.trim() === b.trim()
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqualNormalized(item, b[i]))
  }
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    return [...keys].every((k) =>
      deepEqualNormalized((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
    )
  }
  return a === b
}

// Citation grammar fields: compared against the kaikki patch captured at
// grounding time. Keys the patch carries are Wiktionary-verified (or edited
// away from it); everything else is LLM-generated.
export const citationGrammarFieldProvenance = (params: {
  key: GrammarFieldKey
  currentValue: unknown
  groundingPatch: Record<string, unknown> | null
  groundedAt: string | null
  targetLanguage: string | undefined
}): FieldProvenance => {
  // No kaikki dump for this language: absence of grounding is the default
  // state — indicators (including the IPA warning) would be permanent noise.
  if (!params.targetLanguage || !KAIKKI_LANGUAGES.has(params.targetLanguage)) return { state: 'llm' }

  const patch = params.groundingPatch
  if (patch && params.key in patch) {
    const sourceValue = patch[params.key]
    if (deepEqualNormalized(params.currentValue, sourceValue)) return { state: 'wiktionary' }
    return { state: 'edited', sourceValue, sourceKind: 'wiktionary' }
  }

  if (params.key === 'ipa') {
    // Nothing displayed = nothing to mistrust.
    if (isAbsent(params.currentValue)) return { state: 'llm' }
    // Legacy grounded row without a snapshot: we can't tell whether the IPA
    // came from kaikki, so claim nothing until the runner re-grounds it.
    if (params.groundedAt && !patch) return { state: 'llm' }
    return { state: 'unverified' }
  }

  return { state: 'llm' }
}

// Form-facet fields: compared against the generated_payload snapshot the Opus
// pass wrote. `generated` is the record to index into — the payload snapshot
// for content fields, the snapshot's `grammar` sub-bag for grammar fields.
// Null snapshot = manually-entered or legacy facet: no claims, no icons.
// Forms have no 'wiktionary' state and no IPA warning (form pronunciation is
// never grounded, so the warning would sit on every form card permanently).
export const generatedFieldProvenance = (params: {
  key: string
  currentValue: unknown
  generated: Record<string, unknown> | null
}): FieldProvenance => {
  if (!params.generated) return { state: 'llm' }
  const sourceValue = params.generated[params.key]
  if (deepEqualNormalized(params.currentValue, sourceValue)) return { state: 'llm' }
  return { state: 'edited', sourceValue, sourceKind: 'generated' }
}
