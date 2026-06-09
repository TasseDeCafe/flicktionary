import type { Grammar, StudyFacetSummary } from '@flicktionary/api-client/orpc-contracts/common/flicktionary-schemas'

// Which study target the unified editor is focused on. Citation drills the lemma
// (content on user_lookups); a form drills one inflection (content in the form
// facet's payload, keyed by the normalized target_form).
export type SelectedTarget = { kind: 'citation' } | { kind: 'form'; targetForm: string }

// Minimal slice of a chunk the study-target controls need. `isProductionEnabled`
// is the wire's DERIVED flag (true iff the citation meaning_production facet is
// enabled). `grammar`/`targetLanguage` gate the citation pronunciation row (it
// renders its back from grammar.ipa, so it's only offerable with displayable IPA).
export type StudyTargetsChunk = {
  id: string
  headword: string
  isProductionEnabled: boolean
  grammar: Record<string, unknown>
  targetLanguage: string
}

// A form facet's display spelling — the payload `form` (stress/case intact),
// falling back to the normalized target_form key when the payload predates it.
export const formDisplay = (facet: StudyFacetSummary): string =>
  typeof facet.payload.form === 'string' && facet.payload.form.trim().length > 0
    ? (facet.payload.form as string)
    : facet.targetForm

// The form study targets, one per recognition facet (the base of a form target;
// production/pronunciation are sibling skills on the same target_form).
export const formRecognitionFacets = (facets: StudyFacetSummary[]): StudyFacetSummary[] =>
  facets
    .filter((f) => f.skill === 'meaning_recognition' && f.targetForm !== '')
    .sort((a, b) => formDisplay(a).localeCompare(formDisplay(b)))

// Defensive string read of a form payload field (legacy `{form,translation}`
// rows and partial bags must not crash the editor).
export const payloadString = (payload: Record<string, unknown>, key: string): string =>
  typeof payload[key] === 'string' ? (payload[key] as string) : ''

// The form payload's grammar sub-bag (empty when absent). Read defensively — the
// payload is a lenient record on the wire.
export const payloadGrammar = (payload: Record<string, unknown>): Grammar =>
  payload.grammar && typeof payload.grammar === 'object' && !Array.isArray(payload.grammar)
    ? (payload.grammar as Grammar)
    : {}

// How many skills are enabled across all facets sharing a target_form. Zero =
// the "dormant" state (in vocabulary, queued nowhere) — the chip renders muted.
export const enabledSkillCount = (facets: StudyFacetSummary[], targetForm: string): number =>
  facets.filter((f) => f.targetForm === targetForm && f.enabled).length
